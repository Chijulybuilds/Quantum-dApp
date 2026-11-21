/**
 * ML-DSA-87 signatures: normalisation of what wallets return, off-chain verification against the
 * key registered on chain (so the relayer never pays gas for a signature that would revert), and
 * signing for the demo member keys.
 */
import { messagePqSignBytes, pqSign, pqVerify } from "@qorechain/qoresign";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

import { account, keyStatus, type Role } from "./chain.js";
import { HttpError, config } from "./config.js";

export const ML_DSA_87_SIGNATURE_LENGTH = 4627;

/** Accepts 0x-hex or base64 (QoreX `signArbitrary` returns base64 in `pq.signature`). */
export function normalizeSignature(input: string): Hex {
  const raw = input.trim();
  let bytes: Uint8Array;
  if (/^0x[0-9a-fA-F]*$/.test(raw)) bytes = hexToBytes(raw as Hex);
  else if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) bytes = Uint8Array.from(Buffer.from(raw, "base64"));
  else throw new HttpError(400, "BadSignatureEncoding", "Signature must be 0x-hex or base64");
  if (bytes.length !== ML_DSA_87_SIGNATURE_LENGTH) {
    throw new HttpError(400, "BadSignatureLength", `ML-DSA-87 signatures are ${ML_DSA_87_SIGNATURE_LENGTH} bytes, got ${bytes.length}`);
  }
  return bytesToHex(bytes);
}

/** Throws 4xx unless `signature` verifies over `message` under `signer`'s registered key. */
export async function verifyOffChain(signer: Address, message: string, signature: Hex): Promise<void> {
  const status = await keyStatus(signer);
  if (!status.isMlDsa87) {
    throw new HttpError(409, "NoPqKey", `${signer} has no ML-DSA-87 key registered on chain`);
  }
  const ok = pqVerify(hexToBytes(status.pubkey), messagePqSignBytes(config.chainId, message), hexToBytes(signature));
  if (!ok) throw new HttpError(401, "InvalidSignature", "The ML-DSA-87 signature does not match the message and the signer's registered key");
}

/** Signs `message` the way QoreX does, with one of the backend's (demo) keys. */
export async function signAs(role: Role, message: string): Promise<{ signer: Address; signature: Hex }> {
  const acc = await account(role);
  const signature = pqSign(acc.pqc.secretKey, messagePqSignBytes(config.chainId, message));
  return { signer: acc.evm as Address, signature: bytesToHex(signature) };
}
