/**
 * A REAL ML-DSA-87 (FIPS 204) signature, made in the browser with a throwaway key, over a
 * Conclave vote message exactly as QoreX would sign it. The landing page reveals its parts
 * (c̃ ‖ z ‖ h) as the visitor scrolls. Uses QoreSign, the library QoreX itself uses.
 */
import { shake256 } from "@noble/hashes/sha3.js";
import { messagePqSignBytes, pqKeyFromSeed, pqSign, pqVerify } from "@qorechain/qoresign";

export const SIG_LAYOUT = {
  ctilde: [0, 64] as const, // c̃: commitment hash, λ/4 bytes
  z: [64, 4544] as const, // z: l = 7 polynomials × 256 coefficients × 20 bits
  h: [4544, 4627] as const, // h: hint, ω + k = 75 + 8 bytes
};

export const SAMPLE_MESSAGE =
  "Conclave v1\naction: vote\nsupport: for\nproposal: 7\nproposal hash: 0x9a1fd03c6e2b54f0a11ce7d9b5c08e42f6a3d1279c4b8e5f0a6d2c13b7e9c07e\nmember: 0x8cb8f8c8af2e98c4a952228344522126fa907c7f\ndao: 0x5fbdb2315678afecb367f032d93f642f64180aa3\nchain: 9800";

export interface LiveSignature {
  message: string;
  signedBytes: Uint8Array;
  publicKey: Uint8Array;
  /** μ = SHAKE256(tr ‖ 0x00 ‖ 0x00 ‖ M, 64), tr = SHAKE256(pk, 64): what ML-DSA actually signs. */
  mu: Uint8Array;
  signature: Uint8Array;
  verified: boolean;
  millis: number;
}

export function makeLiveSignature(message = SAMPLE_MESSAGE): LiveSignature {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const key = pqKeyFromSeed(seed);
  const signedBytes = messagePqSignBytes("qorechain-diana", message);
  const t0 = performance.now();
  const signature = pqSign(key.secretKey, signedBytes, { hedged: true });
  const millis = performance.now() - t0;
  const tr = shake256(key.publicKey, { dkLen: 64 });
  const framed = new Uint8Array(2 + signedBytes.length);
  framed.set(signedBytes, 2); // pure ML-DSA: 0x00 (no pre-hash) ‖ 0x00 (empty context) ‖ M
  const muInput = new Uint8Array(tr.length + framed.length);
  muInput.set(tr);
  muInput.set(framed, tr.length);
  return {
    message,
    signedBytes,
    publicKey: key.publicKey,
    mu: shake256(muInput, { dkLen: 64 }),
    signature,
    verified: pqVerify(key.publicKey, signedBytes, signature),
    millis,
  };
}

export const toHexRows = (bytes: Uint8Array, from: number, to: number, perRow = 16): string[] => {
  const rows: string[] = [];
  for (let i = from; i < to; i += perRow) {
    const slice = bytes.subarray(i, Math.min(i + perRow, to));
    rows.push(Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" "));
  }
  return rows;
};
