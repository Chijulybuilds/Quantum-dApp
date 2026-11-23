/**
 * The member's identity from QoreX's native QoreChain connection (window.qorex.native).
 *
 * QoreX's EVM side (EIP-6963) is limited and may share no account: for example, a QoreChain
 * (qor1) account that is not an Ethereum-type (coin 60) account. Conclave doesn't need it: members
 * only sign messages, and they sign them through the native connection. So the native account is
 * the identity used for membership, the key lookup and signing.
 */
import { toEvmAddress } from "@qorechain/evm/window";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getQorexNative } from "@qorechain/qorex-types";
import { useSyncExternalStore } from "react";
import { getAddress, type Address } from "viem";

import { appConfig } from "./config";
import { explainQorexError } from "./qorex";

export interface QorexIdentity {
  /** 0x form of the qor1 account (same 20 bytes). */
  address: Address;
  bech32: string;
  /**
   * "cosmos": created in QoreX (address = RIPEMD160(SHA256(key))), QoreX signs Conclave messages.
   * "ethereum": imported from an Ethereum wallet such as MetaMask (address = Keccak(key)); QoreX
   * cannot sign Conclave messages with it. Undefined when QoreX shared no public key.
   */
  kind?: "cosmos" | "ethereum";
}

/** Tells the account type from QoreX's getKey: only QoreX-created accounts hash to their address. */
function kindOf(pubKey: number[] | undefined, address: Address): QorexIdentity["kind"] {
  if (!pubKey || pubKey.length !== 33) return undefined;
  const hashed = Array.from(ripemd160(sha256(Uint8Array.from(pubKey))), (b) => b.toString(16).padStart(2, "0")).join("");
  return hashed === address.slice(2).toLowerCase() ? "cosmos" : "ethereum";
}

const STORAGE_KEY = "conclave:qorex-identity";
const listeners = new Set<() => void>();
let current: QorexIdentity | undefined = restore();

function restore(): QorexIdentity | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as QorexIdentity;
    return { bech32: parsed.bech32, address: getAddress(toEvmAddress(parsed.bech32)), kind: parsed.kind };
  } catch {
    return undefined;
  }
}

function set(next: QorexIdentity | undefined) {
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify({ bech32: next.bech32, kind: next.kind }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the session still works */
  }
  listeners.forEach((l) => l());
}

/** Asks QoreX to connect this site on the native lane and reads the active account. */
export async function connectQorexNative(): Promise<QorexIdentity> {
  try {
    return await connectInner();
  } catch (err) {
    throw explainQorexError(err) ?? err;
  }
}

async function connectInner(): Promise<QorexIdentity> {
  const native = getQorexNative();
  if (!native) throw new Error("QoreX is not installed in this browser.");
  try {
    await native.enable(appConfig.nativeChainId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/unsupported chain/i.test(msg) ? "Switch QoreX to Testnet, then try again." : msg);
  }
  const key = await native.getKey(appConfig.nativeChainId);
  if (!key?.bech32Address) throw new Error("QoreX did not share an account. Unlock QoreX and approve the connection.");
  const address = getAddress(toEvmAddress(key.bech32Address));
  const identity = { bech32: key.bech32Address, address, kind: kindOf(key.pubKey, address) };
  set(identity);
  return identity;
}

export function disconnectQorexNative() {
  set(undefined);
}

export function useQorexIdentity(): QorexIdentity | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => undefined,
  );
}
