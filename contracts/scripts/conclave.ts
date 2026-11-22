/**
 * conclave.ts - command line for Conclave members and relayers.
 *
 * Members sign with their ML-DSA-87 key (MEMBER_* or the default account in .env); the relayer
 * (RELAYER_* or the default account) only pays gas from an EVM window scoped to Conclave.
 *
 *   npm run conclave info
 *   npm run conclave status <id>
 *   npm run conclave propose-payout <to> <amountQOR> "<description>"
 *   npm run conclave propose-token-payout <token> <to> <amount> "<description>"   (base units)
 *   npm run conclave vote <id> <for|against>              sign and relay in one go
 *   npm run conclave sign-vote <id> <for|against>         print a signed vote (JSON) for someone else to relay
 *   npm run conclave relay-votes <id> <vote.json> [...]   relay several signed votes in one transaction
 *   npm run conclave execute <id>
 *   npm run conclave cancel <id>
 *   npm run conclave pause                                guardian only
 *
 * Upgrades (Conclave runs behind a TransparentUpgradeableProxy owned by itself):
 *   npm run conclave upgrade-info                         version, implementation, ProxyAdmin
 *   npm run conclave deploy-implementation                deploy the current build as a new implementation
 *   npm run conclave propose-upgrade <impl> ["<description>"] [--call <0x data>]
 *                                                         propose ProxyAdmin.upgradeAndCall; then vote and execute
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pqcKeyStatus, toEvmAddress } from "@qorechain/evm";
import type { UnifiedAccount } from "@qorechain/sdk";
import {
  encodeFunctionData,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import {
  conclaveArtifact,
  explain,
  loadAccount,
  loadMember,
  proxyAdminArtifact,
  loadRelayer,
  network,
  publicClient,
  requireLiveWindow,
  signMessagePq,
  txLink,
  walletClient,
} from "./lib/qore.js";

const STATES = ["Unknown", "Active", "Defeated", "Queued", "Ready", "Executed", "Canceled", "Expired", "Stale"];
const { abi } = conclaveArtifact();
const pub = publicClient();
const here = dirname(fileURLToPath(import.meta.url));

type Proposal = {
  proposalHash: Hex;
  proposer: Address;
  voteEnd: bigint;
  epoch: number;
  eta: bigint;
  forVotes: number;
  againstVotes: number;
  executed: boolean;
  canceled: boolean;
};

interface Deployment {
  address: Address;
  blockNumber: string;
}

function deployment(): Deployment | undefined {
  try {
    return JSON.parse(readFileSync(resolve(here, "../deployments/testnet.json"), "utf8")) as Deployment;
  } catch {
    return undefined;
  }
}

function dao(): Address {
  const raw = process.env.CONCLAVE_ADDRESS?.trim() || deployment()?.address;
  if (!raw) throw new Error("Set CONCLAVE_ADDRESS in .env or deploy first");
  return getAddress(raw);
}

const toAddress = (raw: string): Address => getAddress(raw.startsWith("qor1") ? toEvmAddress(raw) : raw);

async function read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  return (await pub.readContract({ address: dao(), abi, functionName, args })) as T;
}

/** Simulates first (so reverts show their decoded custom error), then sends from the relayer. */
async function send(functionName: string, args: readonly unknown[]): Promise<void> {
  const relayer = await loadRelayer();
  await requireLiveWindow(relayer);
  const wallet = walletClient(relayer);
  const { request } = await pub.simulateContract({ address: dao(), abi, functionName, args, account: wallet.account });
  const hash = await wallet.writeContract(request);
  console.log(`sent ${functionName}: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`${receipt.status} in block ${receipt.blockNumber} (gas ${receipt.gasUsed})\n${txLink(hash)}`);
}

/** Signs `message` with the member's ML-DSA-87 key after showing it, like QoreX does. */
async function signAs(member: UnifiedAccount, message: string): Promise<Hex> {
  const chainId = await read<string>("nativeChainId");
  console.log(`\n--- ${member.evm} signs (ML-DSA-87, ${chainId}) ---\n${message}\n---`);
  const status = await pqcKeyStatus(pub, member.evm as Address);
  if (!status.registered) throw new Error(`${member.evm} has no ML-DSA-87 key registered`);
  return signMessagePq(member, chainId, message, status.pubkey);
}

const parseSupport = (s: string | undefined): boolean => {
  if (s === "for") return true;
  if (s === "against") return false;
  throw new Error('support must be "for" or "against"');
};

async function proposeActions(targets: Address[], values: bigint[], calldatas: Hex[], description: string) {
  const member = await loadMember();
  const proposalHash = await read<Hex>("hashProposal", [targets, values, calldatas, keccak256(toBytes(description))]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const message = await read<string>("proposeMessage", [member.evm, proposalHash, deadline]);
  const signature = await signAs(member, message);
  await send("propose", [member.evm, targets, values, calldatas, description, deadline, signature]);
  console.log(`proposal #${await read<bigint>("proposalCount")} created`);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async info() {
    const [members, threshold, epoch, guardian, armed, paused, count, chainId] = await Promise.all([
      read<Address[]>("members"),
      read<number>("threshold"),
      read<number>("epoch"),
      read<Address>("guardian"),
      read<boolean>("guardianArmed"),
      read<boolean>("isPaused"),
      read<bigint>("proposalCount"),
      read<string>("nativeChainId"),
    ]);
    const balance = await pub.getBalance({ address: dao() });
    console.log(`Conclave ${dao()} on ${chainId}`);
    console.log(`treasury:  ${formatEther(balance)} QOR`);
    console.log(`members:   ${members.join(", ")}`);
    console.log(`threshold: ${threshold} of ${members.length} (epoch ${epoch})`);
    console.log(`guardian:  ${guardian} (${armed ? "armed" : "used"}), paused: ${paused}`);
    console.log(`proposals: ${count}`);
  },

  async status([id]) {
    const p = await read<Proposal>("getProposal", [BigInt(id)]);
    const state = await read<number>("state", [BigInt(id)]);
    console.log(`#${id}: ${STATES[state]}  for ${p.forVotes} / against ${p.againstVotes}`);
    console.log(`proposer ${p.proposer}, hash ${p.proposalHash}`);
    console.log(`voting ends ${new Date(Number(p.voteEnd) * 1000).toISOString()}`);
    if (p.eta > 0n) console.log(`executable from ${new Date(Number(p.eta) * 1000).toISOString()}`);
  },

  async "propose-payout"([to, amount, ...words]) {
    await proposeActions([toAddress(to)], [parseEther(amount)], ["0x"], words.join(" ") || "Payout");
  },

  async "propose-token-payout"([token, to, amount, ...words]) {
    const data = encodeFunctionData({ abi, functionName: "payERC20", args: [toAddress(token), toAddress(to), BigInt(amount)] });
    await proposeActions([dao()], [0n], [data], words.join(" ") || "Token payout");
  },

  async vote([id, support]) {
    const member = await loadMember();
    const message = await read<string>("voteMessage", [BigInt(id), member.evm, parseSupport(support)]);
    const signature = await signAs(member, message);
    await send("castVote", [BigInt(id), member.evm, parseSupport(support), signature]);
  },

  async "sign-vote"([id, support]) {
    const member = await loadMember();
    const message = await read<string>("voteMessage", [BigInt(id), member.evm, parseSupport(support)]);
    const signature = await signAs(member, message);
    console.log(JSON.stringify({ proposalId: id, voter: member.evm, support: parseSupport(support), signature }));
  },

  async "relay-votes"([id, ...files]) {
    const votes = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as { voter: Address; support: boolean; signature: Hex });
    await send("castVotes", [BigInt(id), votes.map((v) => v.voter), votes.map((v) => v.support), votes.map((v) => v.signature)]);
  },

  async execute([id]) {
    const logs = await pub.getContractEvents({
      address: dao(),
      abi,
      eventName: "ProposalCreated",
      args: { proposalId: BigInt(id) },
      fromBlock: BigInt(process.env.CONCLAVE_DEPLOY_BLOCK ?? deployment()?.blockNumber ?? "0"),
    });
    const created = logs[0] as unknown as { args: { targets: Address[]; values: bigint[]; calldatas: Hex[]; description: string } };
    if (!created) throw new Error(`ProposalCreated for #${id} not found (set CONCLAVE_DEPLOY_BLOCK)`);
    const { targets, values, calldatas, description } = created.args;
    await send("execute", [BigInt(id), targets, values, calldatas, keccak256(toBytes(description))]);
  },

  async cancel([id]) {
    const member = await loadMember();
    const message = await read<string>("cancelMessage", [BigInt(id)]);
    const signature = await signAs(member, message);
    await send("cancel", [BigInt(id), signature]);
  },

  async pause() {
    await send("pause", []);
  },

  async "upgrade-info"() {
    const [version, implementation, proxyAdmin, governed] = await Promise.all([
      read<string>("version"),
      read<Address>("implementation"),
      read<Address>("proxyAdmin"),
      read<boolean>("upgradesGovernedByDao"),
    ]);
    console.log(`Conclave ${dao()}  v${version}`);
    console.log(`implementation: ${implementation}`);
    console.log(`ProxyAdmin:     ${proxyAdmin}`);
    console.log(`upgrades:       ${governed ? "only by an executed post-quantum proposal (ProxyAdmin owned by Conclave)" : "NOT governed by Conclave"}`);
  },

  async "deploy-implementation"() {
    // Contract creation needs an unscoped EVM window: `npm run window open` first.
    const deployer = await loadAccount();
    await requireLiveWindow(deployer);
    const { bytecode } = conclaveArtifact();
    const hash = await walletClient(deployer).deployContract({ abi, bytecode, args: [] });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${txLink(hash)}`);
    const version = (await pub.readContract({ address: receipt.contractAddress, abi, functionName: "version" })) as string;
    console.log(`implementation v${version}: ${receipt.contractAddress}\n${txLink(hash)}`);
    console.log(`Next: npm run conclave propose-upgrade ${receipt.contractAddress} "Upgrade to v${version}"`);
  },

  async "propose-upgrade"(args) {
    const callAt = args.indexOf("--call");
    const call = (callAt >= 0 ? args[callAt + 1] : "0x") as Hex;
    const rest = callAt >= 0 ? args.slice(0, callAt).concat(args.slice(callAt + 2)) : args;
    const [impl, ...words] = rest;
    if (!impl) throw new Error("Usage: npm run conclave propose-upgrade <implementation> [\"<description>\"] [--call <0x data>]");
    const implementation = toAddress(impl);
    const code = await pub.getCode({ address: implementation });
    if (!code || code === "0x") throw new Error(`${implementation} has no code: deploy it first (deploy-implementation)`);
    const [current, next] = await Promise.all([
      read<string>("version"),
      pub.readContract({ address: implementation, abi, functionName: "version" }) as Promise<string>,
    ]);
    console.log(`upgrade v${current} -> v${next}`);
    const proxyAdmin = await read<Address>("proxyAdmin");
    const data = encodeFunctionData({
      abi: proxyAdminArtifact().abi,
      functionName: "upgradeAndCall",
      args: [dao(), implementation, call],
    });
    console.log(`ProxyAdmin ${proxyAdmin}.upgradeAndCall(${dao()}, ${implementation}, ${call})`);
    await proposeActions([proxyAdmin], [0n], [data], words.join(" ") || `Upgrade Conclave to ${implementation}`);
    console.log("Members now vote on it; after the timelock anyone can execute it: npm run conclave execute <id>");
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.error(`Usage: npm run conclave <${Object.keys(commands).join(" | ")}> ...`);
  process.exit(1);
}
console.log(`network ${network().chainId}`);
run(args).catch((err: unknown) => {
  console.error(explain(err));
  process.exitCode = 1;
});
