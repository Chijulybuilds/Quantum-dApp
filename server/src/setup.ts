/**
 * setup.ts - bootstraps the testnet demo DAO. Every step is idempotent, so it can be re-run.
 *
 *   1. registers the ML-DSA-87 key of the relayer, both demo members and the guardian
 *   2. funds the demo members and guardian from the relayer
 *   3. deploys Conclave behind a TransparentUpgradeableProxy (ConclaveProxy) whose ProxyAdmin is
 *      owned by the proxy itself, so only an executed post-quantum proposal can upgrade it:
 *      founder (your QoreX account) + demo A + demo B, 2-of-3, with a guardian
 *   4. seeds the treasury
 *   5. opens the relayer's EVM window scoped to Conclave
 *
 * Only the relayer needs test QOR from the faucet first.
 *
 *   npm run setup:testnet        set up, or finish an interrupted setup
 *   npm run redeploy:testnet     deploy a fresh Conclave (archives the current deployment file)
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evmWindowCost } from "@qorechain/evm";
import {
  buildRegisterPqcKeyMsg,
  fetchPqcStatus,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { encodeFunctionData, getContractAddress, parseEther, type Address, type Hex } from "viem";

import { conclaveAbi } from "./abi.js";
import { conclaveBytecode, conclaveProxyAbi, conclaveProxyBytecode } from "./bytecode.js";

import { account, balanceUqor, broadcastNative, keyStatus, publicClient, txUrl, walletFor } from "./chain.js";
import { config, deployment } from "./config.js";
import { ensureScopedWindow } from "./keeper.js";

const here = dirname(fileURLToPath(import.meta.url));
const QOR = 1_000_000n; // uqor
const fmt = (uqor: bigint) => `${(Number(uqor) / 1e6).toFixed(3)} QOR`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIMING = {
  votingPeriod: 86_400n, // 1 day
  timelockDelay: 120n, // 2 minutes: short for live demos
  gracePeriod: 604_800n, // 7 days
  pauseDuration: 1_800n, // 30 minutes
};
const TREASURY_SEED = process.env.TREASURY_SEED_QOR || "0.5";
const REDEPLOY = process.argv.includes("--redeploy");
const DEPLOYMENT_FILE = resolve(here, "../../contracts/deployments/testnet.json");

async function registerKey(label: string, acc: UnifiedAccount): Promise<void> {
  const status = await fetchPqcStatus({ rest: config.rest, address: acc.cosmos });
  if (status.registered) {
    const mine = isRegisteredPqcKey(status, acc.pqc.publicKey);
    console.log(`  ${label}: ML-DSA-87 key ${mine === false ? "registered, but NOT this key" : "registered"}`);
    return;
  }
  const pop = signProofOfPossession({ chainId: config.chainId, account: acc.cosmos, keypair: acc.pqc });
  const hash = await broadcastNative(acc, "classical", [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop })]);
  for (let i = 0; i < 20 && !(await keyStatus(acc.evm as Address)).isMlDsa87; i++) await sleep(1500);
  console.log(`  ${label}: registered ML-DSA-87 key  ${txUrl(hash)}`);
}

async function fund(from: UnifiedAccount, label: string, to: UnifiedAccount, min: bigint, amount: bigint): Promise<void> {
  const balance = await balanceUqor(to.cosmos);
  if (balance >= min) {
    console.log(`  ${label}: ${fmt(balance)}`);
    return;
  }
  const hash = await broadcastNative(from, "hybrid", [
    {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: { fromAddress: from.cosmos, toAddress: to.cosmos, amount: [{ denom: "uqor", amount: amount.toString() }] },
    },
  ]);
  console.log(`  ${label}: sent ${fmt(amount)}  ${txUrl(hash)}`);
}


/** True when `address` runs the upgradeable Conclave and only the DAO itself can upgrade it. */
async function isGovernedProxy(address: Address): Promise<boolean> {
  try {
    return await publicClient.readContract({ address, abi: conclaveAbi, functionName: "upgradesGovernedByDao" });
  } catch {
    return false; // the first, non-upgradeable Conclave has no such function
  }
}

async function deploy(relayer: UnifiedAccount, demoA: UnifiedAccount, demoB: UnifiedAccount, guardian: UnifiedAccount) {
  if (REDEPLOY && existsSync(DEPLOYMENT_FILE)) {
    const archived = DEPLOYMENT_FILE.replace(/\.json$/, `.${Date.now()}.json`);
    renameSync(DEPLOYMENT_FILE, archived);
    console.log(`  archived the previous deployment to ${archived.split("/").slice(-2).join("/")}`);
  }
  const existing = REDEPLOY ? undefined : deployment();
  if (existing) {
    const upgradeable = await isGovernedProxy(existing.address);
    console.log(`  Conclave already deployed at ${existing.address}${upgradeable ? " (upgradeable, governed by the DAO)" : ""}`);
    if (!upgradeable) {
      console.log("  It is the earlier, non-upgradeable version. To deploy the upgradeable one: npm run redeploy:testnet");
    }
    return existing.address;
  }
  const members = [config.founder, demoA.evm as Address, demoB.evm as Address];
  for (const m of members) {
    if (!(await keyStatus(m)).isMlDsa87) throw new Error(`${m} has no ML-DSA-87 key yet: register it first`);
  }

  // An unscoped window is needed to create contracts (scoped windows refuse contract creation):
  // the implementation, the proxy and the treasury seed.
  const perTx = evmWindowCost({ gas: 5_000_000n, maxFeePerGas: 250_000_000_000n });
  const open = openEvmWindowMsg({
    sender: relayer.cosmos,
    blocks: 300n,
    maxTxs: 3n,
    maxValue: perTx * 3n + parseEther(TREASURY_SEED) / 1_000_000_000_000n,
  });
  console.log(`  opened deploy window  ${txUrl(await broadcastNative(relayer, "hybrid", [open]))}`);
  await sleep(4000);
  const wallet = walletFor(relayer);

  // 1. The implementation. Its constructor locks it: it can never be initialized itself.
  const implTx = await wallet.deployContract({ abi: conclaveAbi, bytecode: conclaveBytecode, args: [] });
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implTx, timeout: 120_000 });
  if (implReceipt.status !== "success" || !implReceipt.contractAddress) throw new Error(`Implementation deployment failed: ${txUrl(implTx)}`);
  const implementation = implReceipt.contractAddress;
  console.log(`  deployed the implementation ${implementation}  ${txUrl(implTx)}`);

  // 2. The proxy, initialized in the same transaction. Its ProxyAdmin's owner is the proxy's own
  //    address, predicted from the relayer's nonce; pinning the nonce makes the prediction exact
  //    (if the nonce moved, the transaction is rejected rather than deployed with another owner).
  const nonce = await publicClient.getTransactionCount({ address: relayer.evm as Address, blockTag: "pending" });
  const predicted = getContractAddress({ from: relayer.evm as Address, nonce: BigInt(nonce) });
  const init = encodeFunctionData({
    abi: conclaveAbi,
    functionName: "initialize",
    args: [members, 2, guardian.evm as Address, TIMING, config.chainId],
  });
  const hash = await wallet.deployContract({
    abi: conclaveProxyAbi,
    bytecode: conclaveProxyBytecode,
    args: [implementation, predicted, init as Hex],
    nonce,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Proxy deployment failed: ${txUrl(hash)}`);
  const address = receipt.contractAddress;
  if (address.toLowerCase() !== predicted.toLowerCase()) throw new Error(`Proxy landed at ${address}, expected ${predicted}`);

  // 3. Check the wiring on chain before anything else uses it.
  const read = <T>(functionName: "implementation" | "proxyAdmin" | "upgradesGovernedByDao" | "version") =>
    publicClient.readContract({ address, abi: conclaveAbi, functionName }) as Promise<T>;
  const [impl, proxyAdmin, governed, version] = await Promise.all([
    read<Address>("implementation"),
    read<Address>("proxyAdmin"),
    read<boolean>("upgradesGovernedByDao"),
    read<string>("version"),
  ]);
  if (impl.toLowerCase() !== implementation.toLowerCase() || !governed) {
    throw new Error(`Proxy wiring check failed (implementation ${impl}, governed by the DAO: ${governed})`);
  }
  console.log(`  deployed Conclave ${address}  ${txUrl(hash)}`);
  console.log(`    v${version} · ProxyAdmin ${proxyAdmin} owned by Conclave: upgrades need a post-quantum vote`);

  const seed = await wallet.sendTransaction({ to: address, value: parseEther(TREASURY_SEED) });
  await publicClient.waitForTransactionReceipt({ hash: seed });
  console.log(`  seeded treasury with ${TREASURY_SEED} QOR  ${txUrl(seed)}`);

  mkdirSync(dirname(DEPLOYMENT_FILE), { recursive: true });
  writeFileSync(
    DEPLOYMENT_FILE,
    JSON.stringify(
      {
        network: config.chainId,
        evmChainId: config.evmChainId,
        address,
        deployTx: hash,
        blockNumber: receipt.blockNumber.toString(),
        proxy: { kind: "TransparentUpgradeableProxy", implementation, proxyAdmin, proxyAdminOwner: address, version, implementationTx: implTx },
        members,
        threshold: 2,
        guardian: guardian.evm,
        timing: Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, v.toString()])),
        demo: { memberA: demoA.evm, memberB: demoB.evm, relayer: relayer.evm },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`  saved contracts/deployments/testnet.json`);
  if (process.env.CONCLAVE_ADDRESS) {
    console.log(`  server/.env sets CONCLAVE_ADDRESS: change it to ${address} (and CONCLAVE_DEPLOY_BLOCK to ${receipt.blockNumber})`);
  }
  return address;
}

async function main(): Promise<void> {
  const [relayer, demoA, demoB, guardian] = await Promise.all([
    account("relayer"),
    account("demoA"),
    account("demoB"),
    account("guardian"),
  ]);
  console.log(`network ${config.chainId} (EVM ${config.evmChainId})\n`);

  console.log("1. Relayer");
  const relayerBalance = await balanceUqor(relayer.cosmos);
  console.log(`  ${relayer.cosmos}  ${fmt(relayerBalance)}`);
  if (relayerBalance < 2_500_000n) {
    console.log(
      `\nThe relayer needs at least 2.5 test QOR (it has ${fmt(relayerBalance)}). Claim from https://dashboard.qorechain.io/faucet,` +
        ` or send test QOR from your QoreX wallet, to:\n  ${relayer.cosmos}`,
    );
    process.exitCode = 1;
    return;
  }
  await registerKey("relayer", relayer);

  console.log("2. Demo members and guardian");
  // Demo members only pay the key registration fee; the guardian also opens a window to pause.
  await fund(relayer, "demo A", demoA, 150_000n, 250_000n);
  await fund(relayer, "demo B", demoB, 150_000n, 250_000n);
  await fund(relayer, "guardian", guardian, 300_000n, 500_000n);
  await registerKey("demo A", demoA);
  await registerKey("demo B", demoB);
  await registerKey("guardian", guardian);
  const founder = await keyStatus(config.founder);
  console.log(`  founder ${config.founder}: ML-DSA-87 key ${founder.isMlDsa87 ? "registered" : "MISSING"}`);

  console.log("3. Conclave (upgradeable proxy)");
  const address = await deploy(relayer, demoA, demoB, guardian);

  console.log("4. Relayer window scoped to Conclave");
  const { opened, window } = await ensureScopedWindow(address);
  console.log(`  ${opened ? `opened  ${txUrl(opened)}` : "already open"}; ${window.remainingTxs} txs, targets ${window.allowedTargets.join(", ")}`);

  console.log(`\nDone. Conclave ${address} is live on ${config.chainId}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
