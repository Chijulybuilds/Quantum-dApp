/**
 * window.ts - post-quantum key registration and EVM windows for Conclave accounts.
 * Adapted from the create-qorechain-dapp `foundry` template (Apache-2.0), with scoped windows.
 *
 * On QoreChain an EVM transaction needs a registered ML-DSA-87 key and a live EVM window, opened
 * by a hybrid (secp256k1 + ML-DSA-87) native-lane message: the classical key alone can never
 * authorise EVM spending.
 *
 *   npm run window status                  account, PQC key, window
 *   npm run window register                register the account's ML-DSA-87 key (once)
 *   npm run window open                    unscoped window, for deploying (600 blocks, 5 txs)
 *   npm run window open-scoped             window that may ONLY call CONCLAVE_ADDRESS
 *   npm run window close                   revoke the window now
 *   npm run window recovery-code           print a new PQC recovery code (QRC1)
 *
 * Use `ACCOUNT=RELAYER` (or MEMBER) to act on RELAYER_* / MEMBER_* credentials from .env.
 */
import { evmWindowCost, evmWindowStatus, MAX_EVM_WINDOW_TARGETS } from "@qorechain/evm";
import {
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  fetchPqcStatus,
  generatePqcRecoveryCode,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  signProofOfPossession,
} from "@qorechain/sdk";

import { broadcastNative, conclaveAddress, loadAccount, network, txLink } from "./lib/qore.js";

const account = () => loadAccount(process.env.ACCOUNT?.trim() || undefined);

/** Each admitted transaction may consume value + gas limit x fee cap (in uqor). */
function windowBudget(maxTxs: bigint): bigint {
  // Votes carry a 4.6 KB ML-DSA-87 signature: size for 3,000,000 gas at a 250 gwei cap.
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  return BigInt(process.env.QORE_WINDOW_MAX_UQOR ?? (perTx * maxTxs).toString());
}

async function status(): Promise<void> {
  const net = network();
  const acc = await account();
  console.log(`account:  ${acc.evm}  (${acc.cosmos})`);
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  const mine = pqc.registered ? isRegisteredPqcKey(pqc, acc.pqc.publicKey) : false;
  console.log(
    `PQC key:  ${pqc.registered ? (mine === false ? "registered, but NOT this key" : "registered") : "not registered (run: npm run window register)"}`,
  );
  const w = await evmWindowStatus({ rest: net.rest, address: acc.cosmos });
  if (!w.found) {
    console.log("window:   none");
    return;
  }
  console.log(
    `window:   ${w.live ? "live" : "not usable"}; ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ` +
      `${w.remainingValue} uqor left; targets: ${w.allowedTargets.length ? w.allowedTargets.join(", ") : "any"}`,
  );
}

async function register(): Promise<void> {
  const net = network();
  const acc = await account();
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  if (pqc.registered) {
    console.log("The account already has a PQC key; nothing to do.");
    return;
  }
  // Registration is the one message the chain accepts signed classically; the proof of
  // possession shows the ML-DSA-87 key belongs to this account.
  const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
  const hash = await broadcastNative(acc, "classical", [msg]);
  console.log(`registered: ${hash}\n${txLink(hash)}`);
}

async function open(scoped: boolean): Promise<void> {
  const acc = await account();
  const blocks = BigInt(process.env.QORE_WINDOW_BLOCKS ?? "600");
  const maxTxs = BigInt(process.env.QORE_WINDOW_TXS ?? "5");
  const maxValue = windowBudget(maxTxs);
  const allowedTargets = scoped ? [conclaveAddress()] : undefined;
  if (allowedTargets && allowedTargets.length > MAX_EVM_WINDOW_TARGETS) throw new Error("too many targets");

  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue, allowedTargets });
  const hash = await broadcastNative(acc, "hybrid", [msg]);
  console.log(`opened: ${hash}\n${txLink(hash)}`);
  console.log(
    `window: ${blocks} blocks, ${maxTxs} txs, ${maxValue} uqor (value plus fees)` +
      (scoped ? `, only to ${allowedTargets![0]}` : ", any target"),
  );
  console.log("Opening advanced the account's nonce; send the EVM transactions now.");
}

async function close(): Promise<void> {
  const acc = await account();
  const hash = await broadcastNative(acc, "hybrid", [closeEvmWindowMsg(acc.cosmos)]);
  console.log(`closed: ${hash}\n${txLink(hash)}`);
}

async function recoveryCode(): Promise<void> {
  console.log(generatePqcRecoveryCode());
  console.log("Put it in .env as QORE_PQC_RECOVERY_CODE and keep a copy apart from PRIVATE_KEY.");
  console.log("Use the same code every time: a new code gives the account a different ML-DSA-87 key.");
}

const commands: Record<string, () => Promise<void>> = {
  status,
  register,
  open: () => open(false),
  "open-scoped": () => open(true),
  close,
  "recovery-code": recoveryCode,
};
const cmd = process.argv[2] ?? "status";
const run = commands[cmd];
if (!run) {
  console.error(`Unknown command "${cmd}". Use: ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
