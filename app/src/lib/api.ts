import type { Address, Hex } from "viem";

import { appConfig } from "./config";

export type ProposalState =
  | "Unknown"
  | "Active"
  | "Defeated"
  | "Queued"
  | "Ready"
  | "Executed"
  | "Canceled"
  | "Expired"
  | "Stale";

export interface Dao {
  address: Address;
  nativeChainId: string;
  treasuryWei: string;
  members: { address: Address; mlDsa87: boolean }[];
  threshold: number;
  epoch: number;
  guardian: Address;
  guardianArmed: boolean;
  paused: boolean;
  pausedUntil: string;
  proposalCount: string;
  timing: { votingPeriod: string; timelockDelay: string; gracePeriod: string; pauseDuration: string };
  /** The proxy's upgrade wiring; null for the first, non-upgradeable Conclave. */
  upgrades: { version: string; implementation: Address; proxyAdmin: Address; governedByDao: boolean } | null;
}

export interface Proposal {
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
  state: ProposalState;
  forVotes: number;
  againstVotes: number;
  eta: string;
  votes: { voter: Address; support: boolean; tx: Hex }[];
}

export interface Activity {
  type: string;
  proposalId?: string;
  actor?: Address;
  detail?: Record<string, string | boolean>;
  block: string;
  tx: Hex;
}

export interface Relayer {
  address: Address;
  qor: string;
  balanceUqor: string;
  window: {
    live: boolean;
    scopedToConclave: boolean;
    allowedTargets: string[];
    remainingTxs: string;
    remainingBlocks: string;
    remainingValueUqor: string;
  };
}

export interface Health {
  ok: boolean;
  deployed: boolean;
  chainId: string;
  evmChainId: number;
  demoMode: boolean;
}

export interface RelayResult {
  hash: Hex;
  url: string;
  status: "success" | "reverted";
  gasUsed: string;
  blockNumber: string;
  proposalId?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${appConfig.apiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Offline", "The Conclave relayer is not reachable");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Error", body.message ?? `HTTP ${res.status}`);
  return body as T;
}

const post = <T>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  health: () => request<Health>("/api/health"),
  dao: () => request<Dao>("/api/dao"),
  proposals: () => request<Proposal[]>("/api/proposals"),
  proposal: (id: string) => request<Proposal>(`/api/proposals/${id}`),
  activity: () => request<Activity[]>("/api/activity"),
  relayer: () => request<Relayer>("/api/relayer"),
  keyInfo: (address: Address) =>
    request<{ address: Address; mlDsa87: boolean; accountType: "cosmos" | "ethereum" | "unknown" }>(`/api/keys/${address}`),
  proposeMessage: (p: { proposer: Address; targets: Address[]; values: string[]; calldatas: Hex[]; description: string; deadline: string }) =>
    post<{ message: string }>("/api/messages/propose", p),
  relayPropose: (p: { proposer: Address; targets: Address[]; values: string[]; calldatas: Hex[]; description: string; deadline: string; signature: string }) =>
    post<RelayResult>("/api/relay/propose", p),
  relayVote: (v: { proposalId: string; voter: Address; support: boolean; signature: string }) => post<RelayResult>("/api/relay/vote", v),
  relayCancel: (v: { proposalId: string; signature: string }) => post<RelayResult>("/api/relay/cancel", v),
  relayExecute: (proposalId: string) => post<RelayResult>("/api/relay/execute", { proposalId }),
  demoVote: (v: { proposalId: string; member: "A" | "B"; support: boolean }) => post<RelayResult>("/api/demo/vote", v),
  demoPropose: (v: { member: "A" | "B"; to: Address; amount: string; description: string }) => post<RelayResult>("/api/demo/propose-payout", v),
};
