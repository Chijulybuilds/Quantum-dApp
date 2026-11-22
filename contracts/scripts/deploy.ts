/**
 * deploy.ts - deploys Conclave to the QoreChain testnet after pre-flight checks: the implementation,
 * then ConclaveProxy (an OpenZeppelin TransparentUpgradeableProxy) initialized in the same
 * transaction, whose ProxyAdmin is owned by the proxy itself. Only an executed post-quantum
 * proposal can upgrade it. The window must allow 2 transactions (`npm run window open`).
 *
 *   forge build && npm run window open && npm run deploy:testnet
 *
 * Reads from .env:
 *   CONCLAVE_MEMBERS          comma-separated member addresses (0x... or qor1...)
 *   CONCLAVE_THRESHOLD        FOR votes needed (a strict majority of the members)
 *   CONCLAVE_GUARDIAN         optional account allowed to pause once (0x... or qor1...)
 *   CONCLAVE_VOTING_PERIOD    seconds (default 86400 = 1 day)
 *   CONCLAVE_TIMELOCK         seconds (default 600 = 10 minutes, demo-friendly)
 *   CONCLAVE_GRACE_PERIOD     seconds (default 604800 = 7 days)
 *   CONCLAVE_PAUSE_DURATION   seconds (default 86400 = 1 day; must be below the grace period)
 *
 * Foundry's local EVM has no QoreChain precompiles, so `forge script` cannot simulate
 * `initialize` (it checks every member's ML-DSA-87 key). This script sends the deployment
 * straight to the chain, where the real precompiles run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pqcKeyStatus, toEvmAddress } from "@qorechain/evm";
import { encodeFunctionData, getAddress, getContractAddress, zeroAddress, type Address } from "viem";

import {
  conclaveArtifact,
  explain,
  proxyArtifact,
  loadAccount,
  network,
  publicClient,
  requireLiveWindow,
  txLink,
  walletClient,
} from "./lib/qore.js";

const toAddress = (raw: string): Address => getAddress(raw.startsWith("qor1") ? toEvmAddress(raw) : raw);
const seconds = (name: string, fallback: number) => BigInt(process.env[name]?.trim() || fallback);

async function main(): Promise<void> {
  const net = network();
  const pub = publicClient();
  const deployer = await loadAccount();

  const members = (process.env.CONCLAVE_MEMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toAddress);
  if (members.length === 0) throw new Error("Set CONCLAVE_MEMBERS in .env");
  const threshold = Number(process.env.CONCLAVE_THRESHOLD ?? Math.floor(members.length / 2) + 1);
  const guardianRaw = process.env.CONCLAVE_GUARDIAN?.trim();
  const guardian = guardianRaw ? toAddress(guardianRaw) : zeroAddress;
  const timing = {
    votingPeriod: seconds("CONCLAVE_VOTING_PERIOD", 86_400),
    timelockDelay: seconds("CONCLAVE_TIMELOCK", 600),
    gracePeriod: seconds("CONCLAVE_GRACE_PERIOD", 604_800),
    pauseDuration: seconds("CONCLAVE_PAUSE_DURATION", 86_400),
  };

  // ---- Pre-flight -------------------------------------------------------------------------
  const evmChainId = await pub.getChainId();
  console.log(`network:   ${net.chainId} (EVM chain id ${evmChainId})`);
  if (evmChainId !== 9800) throw new Error("Expected the diana testnet (EVM chain id 9800)");
  if (threshold < 1 || threshold > members.length || threshold * 2 <= members.length) {
    throw new Error(`Threshold ${threshold} is not a strict majority of ${members.length} members`);
  }
  for (const member of members) {
    const status = await pqcKeyStatus(pub, member);
    const ok = status.registered && status.algorithmId === 1 && (status.pubkey.length - 2) / 2 === 2592;
    console.log(`member:    ${member}  ML-DSA-87 key ${ok ? "registered" : "MISSING"}`);
    if (!ok) throw new Error(`${member} has no ML-DSA-87 key on chain: they must register it first (QoreX or \`npm run window register\`)`);
  }
  console.log(`threshold: ${threshold} of ${members.length}`);
  console.log(`guardian:  ${guardian === zeroAddress ? "none" : guardian}`);
  console.log(`timing:    vote ${timing.votingPeriod}s, timelock ${timing.timelockDelay}s, grace ${timing.gracePeriod}s, pause ${timing.pauseDuration}s`);
  console.log(`deployer:  ${deployer.evm}`);
  await requireLiveWindow(deployer);

  // ---- Deploy: implementation, then the proxy -------------------------------------------
  const wallet = walletClient(deployer);
  const { abi, bytecode } = conclaveArtifact();
  const implTx = await wallet.deployContract({ abi, bytecode, args: [] });
  console.log(`sent:      implementation ${implTx}`);
  const implReceipt = await pub.waitForTransactionReceipt({ hash: implTx });
  if (implReceipt.status !== "success" || !implReceipt.contractAddress) throw new Error(`Implementation deployment failed: ${txLink(implTx)}`);
  const implementation = implReceipt.contractAddress;

  // The ProxyAdmin's owner is the proxy's own address, predicted from the deployer's nonce. The
  // nonce is pinned, so the transaction either lands exactly there or is rejected.
  const nonce = await pub.getTransactionCount({ address: deployer.evm as Address, blockTag: "pending" });
  const predicted = getContractAddress({ from: deployer.evm as Address, nonce: BigInt(nonce) });
  const init = encodeFunctionData({ abi, functionName: "initialize", args: [members, threshold, guardian, timing, net.chainId] });
  const proxy = proxyArtifact();
  const hash = await wallet.deployContract({ abi: proxy.abi, bytecode: proxy.bytecode, args: [implementation, predicted, init], nonce });
  console.log(`sent:      proxy ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Proxy deployment failed: ${txLink(hash)}`);
  const address = receipt.contractAddress;

  const read = (functionName: string) => pub.readContract({ address, abi, functionName });
  const [impl, proxyAdmin, governed, version] = (await Promise.all([
    read("implementation"),
    read("proxyAdmin"),
    read("upgradesGovernedByDao"),
    read("version"),
  ])) as [Address, Address, boolean, string];
  if (address.toLowerCase() !== predicted.toLowerCase() || impl.toLowerCase() !== implementation.toLowerCase() || !governed) {
    throw new Error(`Proxy wiring check failed: proxy ${address}, implementation ${impl}, governed by the DAO: ${governed}`);
  }

  const out = {
    network: net.chainId,
    evmChainId,
    address,
    deployTx: hash,
    blockNumber: receipt.blockNumber.toString(),
    proxy: { kind: "TransparentUpgradeableProxy", implementation, proxyAdmin, proxyAdminOwner: address, version, implementationTx: implTx },
    members,
    threshold,
    guardian,
    timing: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, v.toString()])),
  };
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../deployments/testnet.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

  console.log(`\nConclave:  ${address}  (v${version})\n${txLink(hash)}`);
  console.log(`implementation ${implementation}, ProxyAdmin ${proxyAdmin} owned by Conclave`);
  console.log(`Saved to deployments/testnet.json. Put CONCLAVE_ADDRESS=${address} in .env.`);
}

main().catch((err: unknown) => {
  console.error(explain(err));
  process.exitCode = 1;
});
