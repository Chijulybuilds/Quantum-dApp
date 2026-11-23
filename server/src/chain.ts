/**
 * Chain access: viem clients, the backend's accounts, native-lane broadcasting and the
 * post-quantum key registry.
 */
import { StargateClient } from "@cosmjs/stargate";
import { IQORE_PQC_ABI, qorechainTestnet } from "@qorechain/evm";
import { EthNativeSigner, deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { config } from "./config.js";

export const publicClient = createPublicClient({ chain: qorechainTestnet, transport: http(config.evmRpc) });

export function walletFor(acc: UnifiedAccount) {
  return createWalletClient({
    account: privateKeyToAccount(acc.privateKey as Hex),
    chain: qorechainTestnet,
    transport: http(config.evmRpc),
  });
}

// ---------------------------------------------------------------------------------------------
// Accounts derived from CONCLAVE_MNEMONIC
// ---------------------------------------------------------------------------------------------

export const ROLES = { relayer: 0, demoA: 1, demoB: 2, guardian: 3 } as const;
export type Role = keyof typeof ROLES;

const cache = new Map<Role, Promise<UnifiedAccount>>();
export function account(role: Role): Promise<UnifiedAccount> {
  let acc = cache.get(role);
  if (!acc) {
    acc = deriveUnifiedAccount(config.mnemonic, ROLES[role]);
    cache.set(role, acc);
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------
// One transaction at a time from the relayer (EVM and native share the nonce)
// ---------------------------------------------------------------------------------------------

let tail: Promise<unknown> = Promise.resolve();
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------------------------
// Native lane
// ---------------------------------------------------------------------------------------------

export const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

export async function nativeAccount(address: string) {
  const res = await fetch(`${config.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/**
 * Which kind of key an account signs with, from the public key the chain recorded at its first
 * transaction. "cosmos": a QoreX-created account (address = RIPEMD160(SHA256(key))). "ethereum":
 * an Ethereum-type account (address = Keccak(key)), e.g. imported from MetaMask. QoreX cannot sign
 * Conclave messages with Ethereum-type accounts, so they cannot vote from QoreX.
 */
export type AccountKind = "cosmos" | "ethereum" | "unknown";
export async function accountKind(cosmosAddress: string): Promise<AccountKind> {
  const res = await fetch(`${config.rest}/cosmos/auth/v1beta1/accounts/${cosmosAddress}`);
  if (!res.ok) return "unknown";
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as { pub_key?: { "@type"?: string } };
  const type = acc.pub_key?.["@type"] ?? "";
  if (/ethsecp256k1/i.test(type)) return "ethereum";
  if (/secp256k1/i.test(type)) return "cosmos";
  return "unknown";
}

export async function balanceUqor(address: string): Promise<bigint> {
  const res = await fetch(`${config.rest}/cosmos/bank/v1beta1/balances/${address}`);
  if (!res.ok) throw new Error(`balance query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { balances?: { denom: string; amount: string }[] };
  return BigInt(body.balances?.find((b) => b.denom === "uqor")?.amount ?? "0");
}

export async function broadcastNative(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
): Promise<string> {
  const info = await nativeAccount(acc.cosmos);
  if (!info) throw new Error(`${acc.cosmos} does not exist on chain yet: fund it first`);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: config.rest });
  const transport = await StargateClient.connect(config.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: config.chainId,
      accountNumber: info.accountNumber,
      sequence: info.sequence,
      fee: NATIVE_FEE,
      messages,
    });
    const code = (res as { code?: number }).code ?? 0;
    if (code !== 0) throw new Error(`native tx failed (code ${code}): ${(res as { rawLog?: string }).rawLog ?? ""}`);
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

// ---------------------------------------------------------------------------------------------
// Post-quantum key registry (pqcKeyStatus precompile)
// ---------------------------------------------------------------------------------------------

const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;

export interface KeyStatus {
  registered: boolean;
  algorithmId: number;
  pubkey: Hex;
  isMlDsa87: boolean;
}

export async function keyStatus(account: Address): Promise<KeyStatus> {
  const [registered, algorithmId, pubkey] = (await publicClient.readContract({
    address: PQC_KEY_STATUS,
    abi: IQORE_PQC_ABI,
    functionName: "pqcKeyStatus",
    args: [account],
  })) as readonly [boolean, number, Hex];
  return {
    registered,
    algorithmId,
    pubkey,
    isMlDsa87: registered && algorithmId === 1 && (pubkey.length - 2) / 2 === 2592,
  };
}

export function txUrl(hash: string): string {
  return `${config.explorer}/tx/${hash}`;
}
