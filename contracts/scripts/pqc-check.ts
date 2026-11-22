/**
 * pqc-check.ts - confirms on the live testnet that QoreChain's `pqcVerify` precompile accepts
 * exactly the bytes QoreX signs, with a throwaway ML-DSA-87 key. Needs no funds and no wallet:
 * every check is a read-only eth_call.
 *
 *   npm run pqc:check                 precompile checks
 *   npm run pqc:check -- <0x|qor1>    also show that account's registered key
 *
 * It also runs Conclave's Solidity wrappers (QorePQC) against the live precompiles, directly and
 * behind a real ConclaveProxy (the DELEGATECALL frames Conclave runs in), and with
 * CONCLAVE_ADDRESS set checks that the deployed contract builds the same bytes as QoreSign.
 */
import { randomBytes } from "node:crypto";

import { PRECOMPILE_ADDRESSES, pqcKeyStatus, pqcVerify, toEvmAddress } from "@qorechain/evm";
import { messagePqSignBytes, pqKeyFromSeed, pqSign } from "@qorechain/qoresign";
import {
  decodeAbiParameters,
  encodeDeployData,
  getAddress,
  keccak256,
  parseAbiParameters,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { conclaveArtifact, network, publicClient } from "./lib/qore.js";

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), `../out/${name}.sol/${name}.json`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const pub = publicClient();
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function verify(pubkey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  return pqcVerify(pub, { pubkey: toHex(pubkey), signature: toHex(signature), message: toHex(message) });
}

async function main(): Promise<void> {
  const net = network();
  console.log(`network ${net.chainId}, EVM chain id ${await pub.getChainId()}\n`);

  // 1. Are the precompiles switched on?
  const params = (await (await fetch(`${net.rest}/cosmos/evm/vm/v1/params`)).json()) as {
    params?: { active_static_precompiles?: string[] };
  };
  const active = (params.params?.active_static_precompiles ?? []).map((a) => a.toLowerCase());
  check("pqcVerify precompile active", active.includes(PRECOMPILE_ADDRESSES.pqcVerify.toLowerCase()));
  check("pqcKeyStatus precompile active", active.includes(PRECOMPILE_ADDRESSES.pqcKeyStatus.toLowerCase()));

  // 2. A throwaway ML-DSA-87 key signs a Conclave-style message the way QoreX does.
  const key = pqKeyFromSeed(randomBytes(32));
  const message = "Conclave v1\naction: vote\nsupport: for\nproposal: 1\npqc-check";
  const signed = messagePqSignBytes(net.chainId, message);
  const signature = pqSign(key.secretKey, signed);
  check("ML-DSA-87 sizes", key.publicKey.length === 2592 && signature.length === 4627);

  check("pqcVerify accepts the QoreX signing bytes", await verify(key.publicKey, signature, signed));
  const tampered = messagePqSignBytes(net.chainId, message.replace("for", "against"));
  check("pqcVerify rejects a changed message", !(await verify(key.publicKey, signature, tampered)));
  check(
    "pqcVerify rejects the bare message (no qorechain-msg-v1 prefix)",
    !(await verify(key.publicKey, signature, new TextEncoder().encode(message))),
  );
  const otherKey = pqKeyFromSeed(randomBytes(32));
  check("pqcVerify rejects another key", !(await verify(otherKey.publicKey, signature, signed)));

  // 3. Optional: an account's registered key.
  const who = process.argv[2];
  let registeredAccount: Address = zeroAddress;
  let registeredKey: Hex | undefined;
  if (who) {
    registeredAccount = getAddress(who.startsWith("qor1") ? toEvmAddress(who) : who);
    const status = await pqcKeyStatus(pub, registeredAccount);
    const length = (status.pubkey.length - 2) / 2;
    console.log(`\n${registeredAccount}: registered=${status.registered} algorithmId=${status.algorithmId} keyLength=${length}`);
    const ok = status.registered && status.algorithmId === 1 && length === 2592;
    check("account has an ML-DSA-87 key (algorithm 1, 2592 bytes)", ok);
    if (ok) registeredKey = status.pubkey;
    else registeredAccount = zeroAddress;
  }

  // 4. Conclave's own Solidity code (QorePQC) against the live precompiles, in an eth_call of
  //    creation code: nothing is deployed and no gas is paid.
  const probe = artifact("LivePqcProbe");
  const result = await pub.call({
    data: encodeDeployData({
      abi: probe.abi,
      bytecode: probe.bytecode,
      args: [toHex(key.publicKey), toHex(signed), toHex(tampered), toHex(signature), registeredAccount],
    }),
  });
  const [validAccepted, tamperedAccepted, keyLength, keyHash] = decodeAbiParameters(
    parseAbiParameters("bool, bool, uint256, bytes32"),
    result.data ?? "0x",
  );
  console.log("");
  check("QorePQC.accepts (Solidity) accepts a valid signature on chain", validAccepted);
  check("QorePQC.accepts (Solidity) rejects a changed message on chain", !tamperedAccepted);
  if (registeredKey) {
    check(
      "QorePQC.keyOf (Solidity) decodes the registered key on chain",
      keyLength === 2592n && keyHash === keccak256(registeredKey),
    );
  }

  // 5. Behind ConclaveProxy: every Conclave call, and initialize, runs in a DELEGATECALL frame.
  const proxyProbe = artifact("LiveProxyProbe");
  const proxyResult = await pub.call({
    data: encodeDeployData({
      abi: proxyProbe.abi,
      bytecode: proxyProbe.bytecode,
      args: [toHex(key.publicKey), toHex(signed), toHex(tampered), toHex(signature), registeredAccount],
    }),
  });
  const [deployed, adminOwnedByProxy, validViaProxy, tamperedViaProxy, keyViaProxy] = decodeAbiParameters(
    parseAbiParameters("bool, bool, bool, bool, uint256"),
    proxyResult.data ?? "0x",
  );
  console.log("");
  check("ConclaveProxy deploys with a ProxyAdmin owned by the proxy (as Conclave's is)", deployed && adminOwnedByProxy);
  check("pqcVerify behind ConclaveProxy (DELEGATECALL): valid signature accepted", validViaProxy);
  check("pqcVerify behind ConclaveProxy (DELEGATECALL): changed message rejected", !tamperedViaProxy);
  if (registeredKey) {
    check("pqcKeyStatus behind ConclaveProxy, in its constructor's init call and after", keyViaProxy === 2592n);
  }

  // 6. Optional: the deployed contract builds the same bytes as QoreSign.
  const dao = process.env.CONCLAVE_ADDRESS?.trim();
  if (dao) {
    const { abi } = conclaveArtifact();
    const fromContract = (await pub.readContract({
      address: getAddress(dao),
      abi,
      functionName: "signingBytes",
      args: [message],
    })) as Hex;
    check("deployed Conclave builds the QoreSign bytes", fromContract === toHex(signed));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
