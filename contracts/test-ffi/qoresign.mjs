// FFI helper for test-ffi/QoreSignDifferential.t.sol.
// Answers with ABI-encoded hex on stdout, which Foundry's vm.ffi decodes into bytes.
//
//   node test-ffi/qoresign.mjs signing-bytes <chainId> <0xmessage>
//       -> the bytes QoreX / QoreSign sign for a message (messagePqSignBytes)
//   node test-ffi/qoresign.mjs constants
//       -> abi.encode(algorithmId, publicKeyLength, signatureLength)
//   node test-ffi/qoresign.mjs roundtrip <chainId> <0xmessage> <0xsignedBytesFromContract>
//       -> abi.encode(valid, signatureLength): a real ML-DSA-87 signature made the QoreSign way
//          over <message>, checked against the bytes the contract says were signed.
import {
  ALGORITHM_ML_DSA_87,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  messagePqSignBytes,
  pqKeyFromSeed,
  pqSign,
  pqVerify,
} from "@qorechain/qoresign";

const fromHex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const toHex = (b) => "0x" + Buffer.from(b).toString("hex");
const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const encodeUints = (...values) => "0x" + values.map(word).join("");

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "signing-bytes") {
  const [chainId, message] = args;
  process.stdout.write(toHex(messagePqSignBytes(chainId, fromHex(message))));
} else if (cmd === "constants") {
  process.stdout.write(encodeUints(ALGORITHM_ML_DSA_87, ML_DSA_87_PUBLIC_KEY_LENGTH, ML_DSA_87_SIGNATURE_LENGTH));
} else if (cmd === "roundtrip") {
  const [chainId, message, contractSignedBytes] = args;
  // Deterministic test key: never use a fixed seed for a real account.
  const key = pqKeyFromSeed(new Uint8Array(32).fill(7));
  const signature = pqSign(key.secretKey, messagePqSignBytes(chainId, fromHex(message)));
  const valid = pqVerify(key.publicKey, fromHex(contractSignedBytes), signature);
  process.stdout.write(encodeUints(valid ? 1 : 0, signature.length));
} else {
  process.stderr.write(`unknown command ${cmd}\n`);
  process.exit(1);
}
