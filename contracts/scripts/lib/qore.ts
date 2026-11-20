/**
 * Shared helpers for the Conclave scripts: network, accounts, the compiled contract and
 * ML-DSA-87 message signing exactly as QoreX does it.
 *
 * Accounts come from a BIP-39 mnemonic (its ML-DSA-87 key is derived from the same mnemonic,
 * like QoreX), or from PRIVATE_KEY plus a QRC1 PQC recovery code. See .env.example.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StargateClient } from "@cosmjs/stargate";
import { classifyEvmWindowRejection, evmWindowStatus, qorechainTestnet } from "@qorechain/evm";
import { messagePqSignBytes, pqSign, pqVerify } from "@qorechain/qoresign";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  getNetwork,
  isValidRecoveryCode,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------------------------

export function network() {
  const name = (process.env.QORE_NETWORK ?? "testnet").trim();
  if (name !== "testnet") {
    // pqcVerify and pqcKeyStatus are only active on the diana testnet today.
    throw new Error(`Conclave needs the PQC precompiles, which are only active on testnet (QORE_NETWORK=${name})`);
  }
  const preset = getNetwork("testnet");
  return {
    chainId: preset.chainId, // native chain id, e.g. qorechain-diana
    rest: process.env.QORE_REST_URL?.trim() || preset.endpoints.rest,
    rpc: process.env.QORE_RPC_URL?.trim() || preset.endpoints.rpc,
    evmRpc: process.env.QORE_EVM_RPC_URL?.trim() || "https://evm-testnet.qore.host",
    explorer: "https://explore.qore.network",
  };
}

export function publicClient() {
  return createPublicClient({ chain: qorechainTestnet, transport: http(network().evmRpc) });
}

export function walletClient(acc: UnifiedAccount) {
  return createWalletClient({
    account: privateKeyToAccount(acc.privateKey as Hex),
    chain: qorechainTestnet,
    transport: http(network().evmRpc),
  });
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

/**
 * Loads an account from `<prefix>_MNEMONIC`, or from `<prefix>_PRIVATE_KEY` +
 * `<prefix>_PQC_RECOVERY_CODE`. The default prefix reads QORE_MNEMONIC / PRIVATE_KEY /
 * QORE_PQC_RECOVERY_CODE, the variables of the create-qorechain-dapp template.
 */
export async function loadAccount(prefix?: string): Promise<UnifiedAccount> {
  const v = (name: string) => process.env[name]?.trim() || undefined;
  const mnemonic = prefix ? v(`${prefix}_MNEMONIC`) : v("QORE_MNEMONIC");
  const index = Number((prefix ? v(`${prefix}_INDEX`) : v("QORE_ACCOUNT_INDEX")) ?? "0");
  if (mnemonic) return deriveUnifiedAccount(mnemonic, index);

  const keyName = prefix ? `${prefix}_PRIVATE_KEY` : "PRIVATE_KEY";
  const codeName = prefix ? `${prefix}_PQC_RECOVERY_CODE` : "QORE_PQC_RECOVERY_CODE";
  const key = v(keyName);
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Set ${prefix ? `${prefix}_MNEMONIC` : "QORE_MNEMONIC"}, or ${keyName} (0x + 64 hex) in .env`);
  }
  const recoveryCode = v(codeName);
  if (!recoveryCode || !isValidRecoveryCode(recoveryCode)) {
    throw new Error(`${keyName} needs a valid QRC1 recovery code in ${codeName} (see \`npm run window recovery-code\`)`);
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
}

/** The relayer pays gas and needs a live EVM window; it carries no authority in Conclave. */
export async function loadRelayer(): Promise<UnifiedAccount> {
  return process.env.RELAYER_MNEMONIC || process.env.RELAYER_PRIVATE_KEY ? loadAccount("RELAYER") : loadAccount();
}

/** The member whose ML-DSA-87 key signs proposals, votes and cancellations. */
export async function loadMember(): Promise<UnifiedAccount> {
  return process.env.MEMBER_MNEMONIC || process.env.MEMBER_PRIVATE_KEY ? loadAccount("MEMBER") : loadAccount();
}

// ---------------------------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));

export function conclaveArtifact(): { abi: Abi; bytecode: Hex } {
  const path = resolve(here, "../../out/Conclave.sol/Conclave.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error("Compiled artifact not found: run `forge build` first");
  }
  const json = JSON.parse(raw) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export function conclaveAddress(): Address {
  const raw = process.env.CONCLAVE_ADDRESS?.trim();
  if (!raw) throw new Error("Set CONCLAVE_ADDRESS in .env (printed by `npm run deploy:testnet`)");
  return getAddress(raw);
}

// ---------------------------------------------------------------------------------------------
// ML-DSA-87 message signatures (what QoreX `signArbitrary` produces for the PQ part)
// ---------------------------------------------------------------------------------------------

/**
 * Signs `message` with the account's ML-DSA-87 key over
 * "qorechain-msg-v1|<chainId>|<message>" and checks it locally against `registeredKey`
 * (the key the chain holds for the account) before anything is sent.
 */
export function signMessagePq(acc: UnifiedAccount, chainId: string, message: string, registeredKey: Hex): Hex {
  const signedBytes = messagePqSignBytes(chainId, message);
  const signature = pqSign(acc.pqc.secretKey, signedBytes);
  const keyBytes = Uint8Array.from(Buffer.from(registeredKey.slice(2), "hex"));
  if (!pqVerify(keyBytes, signedBytes, signature)) {
    throw new Error(
      `The ML-DSA-87 key derived for ${acc.evm} is not the key registered on chain. ` +
        "Register it with `npm run window register`, or use the wallet that registered it.",
    );
  }
  return toHex(signature);
}

// ---------------------------------------------------------------------------------------------
// Native lane (window and key registration) and diagnostics
// ---------------------------------------------------------------------------------------------

/** A native-lane fee: hybrid transactions are large, so the gas limit is generous. */
export const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

export async function accountSequence(rest: string, address: string) {
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: get test QOR from the faucet`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

export async function broadcastNative(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
): Promise<string> {
  const net = network();
  const { accountNumber, sequence } = await accountSequence(net.rest, acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber,
      sequence,
      fee: NATIVE_FEE,
      messages,
    });
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

/** Fails early with a clear message when the account cannot send EVM transactions right now. */
export async function requireLiveWindow(acc: UnifiedAccount): Promise<void> {
  const w = await evmWindowStatus({ rest: network().rest, address: acc.cosmos });
  if (!w.found || !w.live) {
    throw new Error(
      `${acc.evm} has no usable EVM window (${w.found ? "expired or used up" : "none open"}). ` +
        "Open one with `npm run window open-scoped` (or `open` before deploying).",
    );
  }
}

/** Turns an EVM-lane refusal into an actionable message. */
export function explain(err: unknown): string {
  const reason = classifyEvmWindowRejection(err);
  if (reason === "no-pqc-key") return "The sender has no ML-DSA-87 key registered: run `npm run window register`.";
  if (reason === "no-window") return "The sender has no open EVM window: run `npm run window open-scoped`.";
  if (reason === "exhausted") return "The sender's EVM window is used up: open a new one.";
  if (reason === "invalid") return "The EVM window parameters were refused.";
  return err instanceof Error ? err.message : String(err);
}

export function txLink(hash: string): string {
  return `${network().explorer}/tx/${hash}`;
}
