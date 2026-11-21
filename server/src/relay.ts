/**
 * Relays ML-DSA-87 signed Conclave actions. Every signature is checked off-chain against the
 * signer's registered key first, then the call is simulated, then sent from the relayer's EVM
 * window scoped to Conclave. The relayer adds no authority: the contract checks everything again.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import { conclaveAbi } from "./abi.js";
import { account, publicClient, serialized, txUrl, walletFor } from "./chain.js";
import { HttpError, requireDeployment } from "./config.js";
import { STATES, proposalActions, read } from "./indexer.js";
import { ensureScopedWindow } from "./keeper.js";
import { normalizeSignature, verifyOffChain } from "./signatures.js";

export interface RelayResult {
  hash: Hex;
  url: string;
  status: "success" | "reverted";
  gasUsed: string;
  blockNumber: string;
  proposalId?: string;
}

/** Maps a contract revert to a 422 with the custom error's name (e.g. PqcInvalidSignature). */
export function contractError(err: unknown): unknown {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "Reverted";
      const args = revert.data?.args?.map((a) => (typeof a === "bigint" ? a.toString() : a));
      return new HttpError(422, name, revert.shortMessage, args);
    }
  }
  return err;
}

async function send(functionName: string, args: readonly unknown[]): Promise<RelayResult> {
  const { address } = requireDeployment();
  return serialized(async () => {
    await ensureScopedWindow(address);
    const wallet = walletFor(await account("relayer"));
    let hash: Hex;
    try {
      const { request } = await publicClient.simulateContract({
        address,
        abi: conclaveAbi,
        functionName: functionName as never,
        args: args as never,
        account: wallet.account,
      });
      hash = await wallet.writeContract(request as never);
    } catch (err) {
      throw contractError(err);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    let proposalId: string | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: conclaveAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "ProposalCreated") proposalId = String(ev.args.proposalId);
      } catch {
        // not a Conclave event
      }
    }
    return {
      hash,
      url: txUrl(hash),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber.toString(),
      proposalId,
    };
  });
}

async function stateOf(id: bigint) {
  return STATES[await read<number>("state", [id])];
}

async function requireMember(account: Address) {
  if (!(await read<boolean>("isMember", [account]))) throw new HttpError(403, "NotMember", `${account} is not a member`);
}

// ---------------------------------------------------------------------------------------------

export interface VoteInput {
  proposalId: bigint;
  voter: Address;
  support: boolean;
  signature: string;
}

async function checkedVote(v: VoteInput): Promise<Hex> {
  await requireMember(v.voter);
  if (await read<boolean>("hasVoted", [v.proposalId, v.voter])) {
    throw new HttpError(409, "AlreadyVoted", `${v.voter} already voted on #${v.proposalId}`);
  }
  const message = await read<string>("voteMessage", [v.proposalId, v.voter, v.support]);
  const signature = normalizeSignature(v.signature);
  await verifyOffChain(v.voter, message, signature);
  return signature;
}

export async function relayVote(v: VoteInput): Promise<RelayResult> {
  const state = await stateOf(v.proposalId);
  if (state !== "Active") throw new HttpError(409, "NotActive", `Proposal #${v.proposalId} is ${state}`);
  const signature = await checkedVote(v);
  return send("castVote", [v.proposalId, v.voter, v.support, signature]);
}

export async function relayVotes(proposalId: bigint, list: Omit<VoteInput, "proposalId">[]): Promise<RelayResult> {
  const state = await stateOf(proposalId);
  if (state !== "Active") throw new HttpError(409, "NotActive", `Proposal #${proposalId} is ${state}`);
  const signatures: Hex[] = [];
  for (const v of list) signatures.push(await checkedVote({ ...v, proposalId }));
  return send("castVotes", [proposalId, list.map((v) => v.voter), list.map((v) => v.support), signatures]);
}

export interface ProposeInput {
  proposer: Address;
  targets: Address[];
  values: bigint[];
  calldatas: Hex[];
  description: string;
  deadline: bigint;
  signature: string;
}

export async function proposeMessage(p: Omit<ProposeInput, "signature">): Promise<string> {
  const hash = await read<Hex>("hashProposal", [p.targets, p.values, p.calldatas, keccak256(toBytes(p.description))]);
  return read<string>("proposeMessage", [p.proposer, hash, p.deadline]);
}

export async function relayPropose(p: ProposeInput): Promise<RelayResult> {
  await requireMember(p.proposer);
  if (p.deadline < BigInt(Math.floor(Date.now() / 1000))) throw new HttpError(400, "SignatureExpired", "The signature's deadline has passed");
  const message = await proposeMessage(p);
  const signature = normalizeSignature(p.signature);
  await verifyOffChain(p.proposer, message, signature);
  return send("propose", [p.proposer, p.targets, p.values, p.calldatas, p.description, p.deadline, signature]);
}

export async function relayCancel(proposalId: bigint, rawSignature: string): Promise<RelayResult> {
  const { proposer } = await read<{ proposer: Address }>("getProposal", [proposalId]);
  const message = await read<string>("cancelMessage", [proposalId]);
  const signature = normalizeSignature(rawSignature);
  await verifyOffChain(proposer, message, signature);
  return send("cancel", [proposalId, signature]);
}

/** Execution needs no signature: the passed proposal is the authorisation. */
export async function relayExecute(proposalId: bigint): Promise<RelayResult> {
  const state = await stateOf(proposalId);
  if (state !== "Ready") throw new HttpError(409, "NotReady", `Proposal #${proposalId} is ${state}`);
  const p = await proposalActions(proposalId);
  return send("execute", [proposalId, p.targets, p.values.map(BigInt), p.calldatas, keccak256(toBytes(p.description))]);
}
