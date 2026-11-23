/**
 * ML-DSA-87 signatures from QoreX.
 *
 * QoreX connects to the page over EIP-6963 (RainbowKit / wagmi) for the account, but EVM signing
 * and sending are not supported by the wallet yet. Conclave does not need them: members sign a
 * plain-text message with `window.qorex.native.signArbitrary` (QoreSign message-signing-v1, the
 * ML-DSA-87 part covers "qorechain-msg-v1|<chain>|<message>") and the relayer submits it.
 */
import { getQorexNative, type QorexNativeProvider } from "@qorechain/qorex-types";
import { toEvmAddress } from "@qorechain/evm/window";
import { bytesToHex, getAddress, hexToBytes, type Address, type Hex } from "viem";

import { appConfig } from "./config";

export const ML_DSA_87_SIGNATURE_BYTES = 4627;

export type SignErrorCode =
  | "NoQorex"
  | "Unsupported"
  | "WrongAccount"
  | "Rejected"
  | "BadSignature"
  | "ExtensionReloaded"
  | "RequestDropped";

export class SignError extends Error {
  constructor(
    readonly code: SignErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The QoreSign `MessageSignature` shape QoreX returns. */
interface MessageSignature {
  signatureType?: string;
  pq?: { algorithmId: number; signature: string };
}

type SigningProvider = QorexNativeProvider & {
  signArbitrary(chainId: string, signer: string, data: string | Uint8Array): Promise<unknown>;
};

export function qorexInstalled(): boolean {
  return Boolean(getQorexNative());
}

export function canSignWithQorex(): boolean {
  const native = getQorexNative();
  return Boolean(native?.capabilities?.includes("signArbitrary"));
}

/** Decodes a signature given as 0x-hex or base64 and checks its ML-DSA-87 length. */
export function parseSignature(input: string): Hex {
  const raw = input.trim();
  let bytes: Uint8Array;
  if (/^0x[0-9a-fA-F]+$/.test(raw)) bytes = hexToBytes(raw as Hex);
  else if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  else {
    // A JSON line from `npm run conclave sign-vote`
    try {
      const parsed = JSON.parse(raw) as { signature?: string; pq?: { signature?: string } };
      const inner = parsed.signature ?? parsed.pq?.signature;
      if (inner) return parseSignature(inner);
    } catch {
      /* fall through */
    }
    throw new SignError("BadSignature", "Paste a 0x-hex or base64 ML-DSA-87 signature");
  }
  if (bytes.length !== ML_DSA_87_SIGNATURE_BYTES) {
    throw new SignError("BadSignature", `An ML-DSA-87 signature is ${ML_DSA_87_SIGNATURE_BYTES} bytes, this one is ${bytes.length}`);
  }
  return bytesToHex(bytes);
}

/** Asks QoreX to sign `message` with the ML-DSA-87 key of `expected` and returns the PQ signature. */
/**
 * Chrome's errors when QoreX was reloaded, updated or restarted while this page stayed open: the
 * script QoreX injected into the page can no longer reach the extension until the page reloads.
 */
const EXTENSION_GONE = /extension context invalidated|receiving end does not exist|message port closed|disconnected port/i;

export function isExtensionReloaded(err: unknown): boolean {
  return err instanceof SignError ? err.code === "ExtensionReloaded" : EXTENSION_GONE.test(err instanceof Error ? err.message : String(err));
}

/**
 * Chrome's error when QoreX's background worker stopped before answering a request: usually QoreX
 * was locked, asked for the password, and Chrome shut the idle worker down meanwhile.
 */
const REQUEST_DROPPED = /message channel closed|asynchronous response by returning true/i;

export const REQUEST_DROPPED_MESSAGE =
  "QoreX dropped the request before answering. Nothing was signed. Unlock QoreX first (click its icon in the toolbar) and try again; if it keeps happening, use “Sign with the Conclave CLI instead”.";

/** A friendly error for QoreX's extension lifecycle problems, or undefined for anything else. */
export function explainQorexError(err: unknown): SignError | undefined {
  if (err instanceof SignError && (err.code === "ExtensionReloaded" || err.code === "RequestDropped")) return err;
  const text = err instanceof Error ? err.message : String(err);
  if (REQUEST_DROPPED.test(text)) return new SignError("RequestDropped", REQUEST_DROPPED_MESSAGE);
  if (EXTENSION_GONE.test(text)) return new SignError("ExtensionReloaded", EXTENSION_RELOADED_MESSAGE);
  return undefined;
}

export const EXTENSION_RELOADED_MESSAGE =
  "QoreX was restarted or updated while this page was open, so the page lost its connection to it. Nothing was signed or sent. Refresh the page and try again.";

export async function signWithQorex(message: string, expected: Address): Promise<Hex> {
  try {
    return await signWithQorexInner(message, expected);
  } catch (err) {
    throw explainQorexError(err) ?? err;
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One QoreX request, retried once if QoreX dropped it (its background worker often survives the
 * second try, e.g. after the first one woke it or the user unlocked it). Says which step failed.
 */
async function qorexStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const known = explainQorexError(err);
      if (known?.code === "RequestDropped" && attempt === 1) {
        await pause(500);
        continue;
      }
      if (known) throw new SignError(known.code, `${known.message} (QoreX stopped while ${step}.)`);
      throw err;
    }
  }
}

async function signWithQorexInner(message: string, expected: Address): Promise<Hex> {
  const native = getQorexNative() as SigningProvider | undefined;
  if (!native) throw new SignError("NoQorex", "QoreX is not installed in this browser");
  if (!native.capabilities?.includes("signArbitrary")) {
    throw new SignError("Unsupported", "This QoreX version cannot sign messages yet: update QoreX, or use the Conclave CLI");
  }
  await qorexStep("connecting", () => native.enable(appConfig.nativeChainId));
  const key = await qorexStep("reading the account", () => native.getKey(appConfig.nativeChainId));
  if (getAddress(toEvmAddress(key.bech32Address)) !== getAddress(expected)) {
    throw new SignError("WrongAccount", `QoreX is on ${key.bech32Address}; switch to the account ${expected}`);
  }
  let result: MessageSignature;
  try {
    result = (await qorexStep("signing the message", () =>
      native.signArbitrary(appConfig.nativeChainId, key.bech32Address, message),
    )) as MessageSignature;
  } catch (err) {
    if (err instanceof SignError) throw err;
    throw new SignError("Rejected", err instanceof Error ? err.message : "Signing was rejected");
  }
  if (!result?.pq?.signature) throw new SignError("BadSignature", "QoreX returned no ML-DSA-87 signature");
  return parseSignature(result.pq.signature);
}
