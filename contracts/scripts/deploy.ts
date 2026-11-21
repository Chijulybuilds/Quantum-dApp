/**
 * deploy.ts - deploys Conclave to the QoreChain testnet after pre-flight checks.
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
 * Foundry's local EVM has no QoreChain precompiles, so `forge script` cannot simulate the
 * constructor (it checks every member's ML-DSA-87 key). This script sends the deployment
 * straight to the chain, where the real precompiles run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pqcKeyStatus, toEvmAddress } from "@qorechain/evm";
import { getAddress, zeroAddress, type Address } from "viem";

import {
  conclaveArtifact,
  explain,
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

  // ---- Deploy -----------------------------------------------------------------------------
  const { abi, bytecode } = conclaveArtifact();
  const hash = await walletClient(deployer).deployContract({
    abi,
    bytecode,
    args: [members, threshold, guardian, timing, net.chainId],
  });
  console.log(`sent:      ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${txLink(hash)}`);

  const out = {
    network: net.chainId,
    evmChainId,
    address: receipt.contractAddress,
    deployTx: hash,
    blockNumber: receipt.blockNumber.toString(),
    members,
    threshold,
    guardian,
    timing: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, v.toString()])),
  };
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../deployments/testnet.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

  console.log(`\nConclave:  ${receipt.contractAddress}\n${txLink(hash)}`);
  console.log(`Saved to deployments/testnet.json. Put CONCLAVE_ADDRESS=${receipt.contractAddress} in .env.`);
}

main().catch((err: unknown) => {
  console.error(explain(err));
  process.exitCode = 1;
});
