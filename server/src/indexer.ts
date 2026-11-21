/**
 * Reads Conclave's state and indexes its events (proposals, votes, activity) from the chain.
 * The chain stays the source of truth: the index only stores what the events published.
 */
import type { Address, Hex } from "viem";

import { conclaveAbi } from "./abi.js";
import { keyStatus, publicClient } from "./chain.js";
import { HttpError, requireDeployment } from "./config.js";

export const STATES = ["Unknown", "Active", "Defeated", "Queued", "Ready", "Executed", "Canceled", "Expired", "Stale"] as const;
export type StateName = (typeof STATES)[number];

export interface IndexedProposal {
  id: string;
  proposer: Address;
  proposalHash: Hex;
  targets: Address[];
  values: string[];
  calldatas: Hex[];
  description: string;
  voteEnd: string;
  epoch: number;
  block: string;
  tx: Hex;
}

export interface Activity {
  type: string;
  proposalId?: string;
  actor?: Address;
  detail?: Record<string, string | boolean>;
  block: string;
  tx: Hex;
  logIndex: number;
}

const proposals = new Map<string, IndexedProposal>();
const votes = new Map<string, { voter: Address; support: boolean; tx: Hex }[]>();
const activity: Activity[] = [];
let scannedTo: bigint | undefined;
let lastSync = 0;
let inflight: Promise<void> | undefined;

const CHUNK = 5_000n;

export async function read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  const { address } = requireDeployment();
  return (await publicClient.readContract({
    address,
    abi: conclaveAbi,
    functionName: functionName as never,
    args: args as never,
  })) as T;
}

/** Pulls new events since the last sync (at most every 4 s; concurrent callers share one sync). */
export function sync(): Promise<void> {
  if (Date.now() - lastSync < 4_000) return Promise.resolve();
  inflight ??= doSync().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

async function doSync(): Promise<void> {
  const { address, fromBlock } = requireDeployment();
  const latest = await publicClient.getBlockNumber();
  let from = (scannedTo ?? fromBlock - 1n) + 1n;
  while (from <= latest) {
    const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
    const logs = await publicClient.getContractEvents({ address, abi: conclaveAbi, fromBlock: from, toBlock: to });
    for (const log of logs) record(log as unknown as RawLog);
    scannedTo = to;
    from = to + 1n;
  }
  lastSync = Date.now();
}

interface RawLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

function record(log: RawLog): void {
  const a = log.args;
  const base = { block: log.blockNumber.toString(), tx: log.transactionHash, logIndex: log.logIndex };
  const id = a.proposalId !== undefined ? String(a.proposalId) : undefined;
  switch (log.eventName) {
    case "ProposalCreated":
      proposals.set(id!, {
        id: id!,
        proposer: a.proposer as Address,
        proposalHash: a.proposalHash as Hex,
        targets: a.targets as Address[],
        values: (a.values as bigint[]).map(String),
        calldatas: a.calldatas as Hex[],
        description: a.description as string,
        voteEnd: String(a.voteEnd),
        epoch: Number(a.epoch),
        ...base,
      });
      activity.push({ type: "ProposalCreated", proposalId: id, actor: a.proposer as Address, ...base });
      break;
    case "VoteCast": {
      const list = votes.get(id!) ?? [];
      list.push({ voter: a.voter as Address, support: a.support as boolean, tx: log.transactionHash });
      votes.set(id!, list);
      activity.push({ type: "VoteCast", proposalId: id, actor: a.voter as Address, detail: { support: a.support as boolean }, ...base });
      break;
    }
    default: {
      const detail: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(a)) {
        if (k === "proposalId") continue;
        detail[k] = typeof v === "boolean" ? v : String(v);
      }
      activity.push({ type: log.eventName, proposalId: id, detail, ...base });
    }
  }
}

export async function proposalActions(id: bigint) {
  await sync();
  const p = proposals.get(id.toString());
  if (!p) throw new HttpError(404, "UnknownProposal", `Proposal #${id} not found`);
  return p;
}

interface ChainProposal {
  proposalHash: Hex;
  proposer: Address;
  voteEnd: bigint;
  epoch: number;
  eta: bigint;
  forVotes: number;
  againstVotes: number;
  executed: boolean;
  canceled: boolean;
}

export async function getProposal(id: string) {
  await sync();
  const indexed = proposals.get(id);
  if (!indexed) throw new HttpError(404, "UnknownProposal", `Proposal #${id} not found`);
  const [state, chain] = await Promise.all([read<number>("state", [BigInt(id)]), read<ChainProposal>("getProposal", [BigInt(id)])]);
  return {
    ...indexed,
    state: STATES[state],
    forVotes: chain.forVotes,
    againstVotes: chain.againstVotes,
    eta: chain.eta.toString(),
    votes: votes.get(id) ?? [],
  };
}

export async function listProposals() {
  await sync();
  const ids = [...proposals.keys()].sort((a, b) => Number(b) - Number(a));
  return Promise.all(ids.map(getProposal));
}

export async function recentActivity(limit = 30) {
  await sync();
  return activity.slice(-limit).reverse();
}

export async function getDao() {
  const { address } = requireDeployment();
  const [members, threshold, epoch, guardian, guardianArmed, pausedUntil, isPaused, proposalCount, nativeChainId, votingPeriod, timelockDelay, gracePeriod, pauseDuration, balance] =
    await Promise.all([
      read<Address[]>("members"),
      read<number>("threshold"),
      read<number>("epoch"),
      read<Address>("guardian"),
      read<boolean>("guardianArmed"),
      read<bigint>("pausedUntil"),
      read<boolean>("isPaused"),
      read<bigint>("proposalCount"),
      read<string>("nativeChainId"),
      read<bigint>("votingPeriod"),
      read<bigint>("timelockDelay"),
      read<bigint>("gracePeriod"),
      read<bigint>("pauseDuration"),
      publicClient.getBalance({ address }),
    ]);
  const keys = await Promise.all(members.map((m) => keyStatus(m)));
  return {
    address,
    nativeChainId,
    treasuryWei: balance.toString(),
    members: members.map((m, i) => ({ address: m, mlDsa87: keys[i]!.isMlDsa87 })),
    threshold,
    epoch,
    guardian,
    guardianArmed,
    paused: isPaused,
    pausedUntil: pausedUntil.toString(),
    proposalCount: proposalCount.toString(),
    timing: {
      votingPeriod: votingPeriod.toString(),
      timelockDelay: timelockDelay.toString(),
      gracePeriod: gracePeriod.toString(),
      pauseDuration: pauseDuration.toString(),
    },
  };
}
