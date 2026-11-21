import { messagePqSignBytes, pqKeyFromSeed, pqSign } from "@qorechain/qoresign";
import { bytesToHex, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const key = pqKeyFromSeed(new Uint8Array(32).fill(9));
const status = { registered: true, algorithmId: 1, pubkey: bytesToHex(key.publicKey), isMlDsa87: true };

vi.mock("../src/chain.js", () => ({
  keyStatus: vi.fn(async () => status),
  account: vi.fn(),
}));

const { normalizeSignature, verifyOffChain } = await import("../src/signatures.js");
const chain = await import("../src/chain.js");

const signer = "0x8cb8f8C8aF2E98c4a952228344522126FA907c7F" as Address;
const message = "Conclave v1\naction: vote\nsupport: for\nproposal: 1";
const sign = (m: string) => pqSign(key.secretKey, messagePqSignBytes("qorechain-diana", m));

describe("normalizeSignature", () => {
  it("accepts 0x-hex and base64 of a 4627-byte signature", () => {
    const sig = sign(message);
    expect(normalizeSignature(bytesToHex(sig))).toBe(bytesToHex(sig));
    expect(normalizeSignature(Buffer.from(sig).toString("base64"))).toBe(bytesToHex(sig));
  });

  it("rejects other lengths and encodings", () => {
    expect(() => normalizeSignature("0x1234")).toThrowError(/4627 bytes/);
    expect(() => normalizeSignature("not a signature!")).toThrowError(/0x-hex or base64/);
  });
});

describe("verifyOffChain (real ML-DSA-87)", () => {
  beforeEach(() => vi.mocked(chain.keyStatus).mockResolvedValue(status));

  it("accepts a QoreX-style signature over the exact message", async () => {
    await expect(verifyOffChain(signer, message, bytesToHex(sign(message)))).resolves.toBeUndefined();
  });

  it("rejects a signature over a different message", async () => {
    const sig = bytesToHex(sign(message.replace("for", "against")));
    await expect(verifyOffChain(signer, message, sig)).rejects.toMatchObject({ status: 401, code: "InvalidSignature" });
  });

  it("rejects a signature made without the qorechain-msg-v1 domain", async () => {
    const bare = bytesToHex(pqSign(key.secretKey, new TextEncoder().encode(message)));
    await expect(verifyOffChain(signer, message, bare)).rejects.toMatchObject({ code: "InvalidSignature" });
  });

  it("rejects a signer without a registered ML-DSA-87 key", async () => {
    vi.mocked(chain.keyStatus).mockResolvedValue({ ...status, registered: false, isMlDsa87: false });
    await expect(verifyOffChain(signer, message, bytesToHex(sign(message)))).rejects.toMatchObject({ status: 409, code: "NoPqKey" });
  });
});
