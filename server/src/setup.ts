/**
 * setup.ts - bootstraps the testnet demo DAO. Every step is idempotent, so it can be re-run.
 *
 *   1. registers the ML-DSA-87 key of the relayer, both demo members and the guardian
 *   2. funds the demo members and guardian from the relayer
 *   3. deploys Conclave: founder (your QoreX account) + demo A + demo B, 2-of-3, with a guardian
 *   4. seeds the treasury
 *   5. opens the relayer's EVM window scoped to Conclave
 *
 * Only the relayer needs test QOR from the faucet first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
import { parseEther, type Address } from "viem";

import { conclaveAbi } from "./abi.js";
import { conclaveBytecode } from "./bytecode.js";

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
const TREASURY_SEED = process.env.TREASURY_SEED_QOR ?? "1";

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


async function deploy(relayer: UnifiedAccount, demoA: UnifiedAccount, demoB: UnifiedAccount, guardian: UnifiedAccount) {
  const existing = deployment();
  if (existing) {
    console.log(`  Conclave already deployed at ${existing.address}`);
    return existing.address;
  }
  const members = [config.founder, demoA.evm as Address, demoB.evm as Address];
  for (const m of members) {
    if (!(await keyStatus(m)).isMlDsa87) throw new Error(`${m} has no ML-DSA-87 key yet: register it first`);
  }

  // An unscoped window is needed to create a contract (scoped windows refuse contract creation).
  const perTx = evmWindowCost({ gas: 5_000_000n, maxFeePerGas: 250_000_000_000n });
  const open = openEvmWindowMsg({
    sender: relayer.cosmos,
    blocks: 300n,
    maxTxs: 2n,
    maxValue: perTx * 2n + parseEther(TREASURY_SEED) / 1_000_000_000_000n,
  });
  console.log(`  opened deploy window  ${txUrl(await broadcastNative(relayer, "hybrid", [open]))}`);
  await sleep(4000);

  const wallet = walletFor(relayer);
  const hash = await wallet.deployContract({
    abi: conclaveAbi,
    bytecode: conclaveBytecode,
    args: [members, 2, guardian.evm as Address, TIMING, config.chainId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${txUrl(hash)}`);
  const address = receipt.contractAddress;
  console.log(`  deployed Conclave ${address}  ${txUrl(hash)}`);

  const seed = await wallet.sendTransaction({ to: address, value: parseEther(TREASURY_SEED) });
  await publicClient.waitForTransactionReceipt({ hash: seed });
  console.log(`  seeded treasury with ${TREASURY_SEED} QOR  ${txUrl(seed)}`);

  const file = resolve(here, "../../contracts/deployments/testnet.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        network: config.chainId,
        evmChainId: config.evmChainId,
        address,
        deployTx: hash,
        blockNumber: receipt.blockNumber.toString(),
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
  if (relayerBalance < 3n * QOR) {
    console.log(`\nThe relayer needs at least 3 test QOR. Claim from https://dashboard.qorechain.io/faucet to:\n  ${relayer.cosmos}`);
    process.exitCode = 1;
    return;
  }
  await registerKey("relayer", relayer);

  console.log("2. Demo members and guardian");
  await fund(relayer, "demo A", demoA, 200_000n, 500_000n);
  await fund(relayer, "demo B", demoB, 200_000n, 500_000n);
  await fund(relayer, "guardian", guardian, 300_000n, 800_000n);
  await registerKey("demo A", demoA);
  await registerKey("demo B", demoB);
  await registerKey("guardian", guardian);
  const founder = await keyStatus(config.founder);
  console.log(`  founder ${config.founder}: ML-DSA-87 key ${founder.isMlDsa87 ? "registered" : "MISSING"}`);

  console.log("3. Conclave");
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
