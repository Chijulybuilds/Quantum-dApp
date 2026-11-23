/**
 * replace-member.ts - replaces one Conclave member with another through governance, for when a
 * member's account is lost. The two demo members (whose keys come from server/.env) propose and
 * vote; it works while they hold enough votes to pass (2 of 3 in the testnet DAO setup creates).
 *
 *   npm run replace-member -- <new 0x|qor1> [old 0x|qor1] [--dry-run]
 *
 * `old` defaults to CONCLAVE_FOUNDER. One proposal runs addMember(new) and removeMember(old), plus
 * setThreshold if the vote count had to change (it does not when one member replaces another).
 * Every step is an ordinary ML-DSA-87 signed action: propose, two votes, the timelock, execute.
 * Safe to re-run: it resumes an open proposal for the same change instead of creating another.
 */
import { toEvmAddress } from "@qorechain/evm";
import { encodeFunctionData, getAddress, isAddress, keccak256, toBytes, type Address, type Hex } from "viem";

import { conclaveAbi } from "./abi.js";
import { toQorAddress } from "@qorechain/evm";

import { account, accountKind, keyStatus, txUrl } from "./chain.js";
import { config, requireDeployment } from "./config.js";
import { STATES, read } from "./indexer.js";
import { ensureScopedWindow } from "./keeper.js";
import { proposeMessage, relayExecute, relayPropose, relayVote } from "./relay.js";
import { signAs } from "./signatures.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The real reason behind Node's generic "fetch failed" (connection reset, timeout, DNS, ...). */
function reason(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { message?: string; code?: string; hostname?: string };
    const text = [x.code, x.message?.split("\n")[0], x.hostname].filter(Boolean).join(" ");
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(" <- ") || String(err);
}
const isNetwork = (err: unknown) =>
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|UND_ERR|socket|timeout|network/i.test(reason(err));

/** Runs a read-or-idempotent step, retrying network failures with backoff. */
async function step<T>(label: string, run: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt > retries || !isNetwork(err)) throw new Error(`${label}: ${reason(err)}`);
      console.log(`   network error (${reason(err)}), retrying ${attempt}/${retries}…`);
      await sleep(3000 * attempt);
    }
  }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function parseAccount(raw: string | undefined, label: string): Address {
  const s = raw?.trim() ?? "";
  if (s.startsWith("qor1")) return getAddress(toEvmAddress(s));
  if (isAddress(s, { strict: false })) return getAddress(s);
  throw new Error(`${label}: "${s}" is not a 0x or qor1 address`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [rawNew, rawOld] = args.filter((a) => !a.startsWith("--"));
  if (!rawNew) throw new Error("Usage: npm run replace-member -- <new 0x|qor1> [old 0x|qor1] [--dry-run]");
  const newMember = parseAccount(rawNew, "new member");
  const oldMember = rawOld ? parseAccount(rawOld, "old member") : config.founder;

  const { address: dao } = requireDeployment();
  const [demoA, demoB] = await Promise.all([account("demoA"), account("demoB")]);
  const [members, threshold] = await Promise.all([read<Address[]>("members"), read<number>("threshold")]);
  const voters = [demoA.evm as Address, demoB.evm as Address];

  console.log(`Conclave ${dao} on ${config.chainId}: ${threshold} of ${members.length} to pass`);
  console.log(`  replace ${oldMember}`);
  console.log(`  with    ${newMember}\n`);

  // ---- Checks: fail before spending gas on a proposal that could not pass or execute ----------
  if (!members.some((m) => same(m, oldMember))) throw new Error(`${oldMember} is not a member`);
  if (members.some((m) => same(m, newMember))) throw new Error(`${newMember} is already a member`);
  if (!(await keyStatus(newMember)).isMlDsa87) {
    throw new Error(`${newMember} has no ML-DSA-87 key on chain yet: register it first (QoreX, or npm run window register)`);
  }
  if ((await accountKind(toQorAddress(newMember))) === "ethereum" && !args.includes("--allow-ethereum-account")) {
    throw new Error(
      `${newMember} is an Ethereum-type account (imported from MetaMask or similar). QoreX cannot sign Conclave ` +
        "messages with it, so it could never vote from QoreX. Use an account created in QoreX " +
        "(or pass --allow-ethereum-account if this member will sign with npm run sign-message).",
    );
  }
  const voting = voters.filter((v) => members.some((m) => same(m, v)) && !same(v, oldMember));
  if (voting.length < threshold) {
    throw new Error(`The demo members can cast ${voting.length} vote(s) but ${threshold} are needed: the remaining members must vote in the app`);
  }
  console.log(`  new member has an ML-DSA-87 key ✓`);
  console.log(`  demo members can pass it: ${voting.length} of ${threshold} votes ✓`);

  const calldatas: Hex[] = [
    encodeFunctionData({ abi: conclaveAbi, functionName: "addMember", args: [newMember] }),
    encodeFunctionData({ abi: conclaveAbi, functionName: "removeMember", args: [oldMember] }),
  ];
  // The member count does not change, so the threshold stays a strict majority; keep it.
  const description = `Replace member ${oldMember} with ${newMember} (account lost)`;
  if (dryRun) {
    console.log(`\nDry run: would propose "${description}" and have demo A and B vote for it. Nothing was sent.`);
    return;
  }

  const role = (who: Address) => (same(who, demoA.evm) ? "demoA" : "demoB") as "demoA" | "demoB";
  const targets = [dao, dao];
  const values = [0n, 0n];

  // ---- 0. The relayer's EVM window (it expires after about a day; renewing it is idempotent) ----
  const window = await step("renewing the relayer's EVM window", () => ensureScopedWindow(dao));
  console.log(`\n0. relayer window ${window.opened ? `renewed  ${txUrl(window.opened)}` : "open"}`);

  // ---- 1. Resume an open proposal for this exact change, or Demo A proposes it ------------------
  const proposalHash = await step("hashing the proposal", () =>
    read<Hex>("hashProposal", [targets, values, calldatas, keccak256(toBytes(description))]),
  );
  const count = await step("reading proposals", () => read<bigint>("proposalCount"));
  let id = 0n;
  for (let i = count; i > 0n && i > count - 20n; i--) {
    const p = await step("reading proposals", () => read<{ proposalHash: Hex }>("getProposal", [i]));
    const state = STATES[await step("reading proposals", () => read<number>("state", [i]))];
    if (same(p.proposalHash, proposalHash) && ["Active", "Queued", "Ready"].includes(state)) {
      id = i;
      console.log(`1. resuming proposal #${id} (${state})`);
      break;
    }
  }
  if (!id) {
    const input = { proposer: voting[0]!, targets, values, calldatas, description, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
    const message = await step("building the proposal message", () => proposeMessage(input));
    const { signature } = await signAs(role(input.proposer), message);
    // Not retried: it sends a transaction. If it fails, simply run the command again: it resumes.
    const proposed = await relayPropose({ ...input, signature }).catch((err) => {
      throw new Error(`proposing: ${reason(err)}`);
    });
    id = BigInt(proposed.proposalId ?? "0");
    if (!id) throw new Error(`Proposal not created: ${proposed.url}`);
    console.log(`1. proposed #${id}  ${proposed.url}`);
  }

  // ---- 2. The demo members vote FOR (skipping votes already cast) ------------------------------
  for (const voter of voting.slice(0, threshold)) {
    if (STATES[await step("reading the proposal", () => read<number>("state", [id]))] !== "Active") break;
    if (await step("reading votes", () => read<boolean>("hasVoted", [id, voter]))) {
      console.log(`2. ${role(voter)} already voted`);
      continue;
    }
    const message = await step("building the vote message", () => read<string>("voteMessage", [id, voter, true]));
    const { signature } = await signAs(role(voter), message);
    const r = await relayVote({ proposalId: id, voter, support: true, signature }).catch((err) => {
      throw new Error(`voting as ${role(voter)}: ${reason(err)} (run the command again to resume)`);
    });
    console.log(`2. ${role(voter)} voted FOR  ${r.url}`);
  }

  // ---- 3. Timelock -----------------------------------------------------------------------------
  const timelock = Number(await step("reading the timelock", () => read<bigint>("timelockDelay")));
  process.stdout.write(`3. waiting out the ${timelock}s timelock`);
  for (let waited = 0; ; waited += 10) {
    const state = STATES[await step("reading the proposal", () => read<number>("state", [id]))];
    if (state === "Ready") break;
    if (state !== "Queued" || waited > timelock + 300) throw new Error(`\nProposal #${id} is ${state}`);
    process.stdout.write(".");
    await sleep(10_000);
  }

  // ---- 4. Execute ------------------------------------------------------------------------------
  const executed = await relayExecute(id).catch((err) => {
    throw new Error(`executing: ${reason(err)} (run the command again to resume)`);
  });
  console.log(`\n4. executed  ${txUrl(executed.hash)}`);
  const [after, needed] = await Promise.all([read<Address[]>("members"), read<number>("threshold")]);
  console.log(`\nMembers now (${needed} of ${after.length} to pass):\n  ${after.join("\n  ")}`);
  if (same(config.founder, oldMember)) {
    console.log(`\nAlso set CONCLAVE_FOUNDER=${newMember} in server/.env, so a future redeploy uses the new account.`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : reason(err)}`);
  if (isNetwork(err)) {
    console.error("A network request to QoreChain failed. Nothing is lost: run the same command again and it picks up where it stopped.");
    console.error("If it keeps failing on WSL or a VPN, try first:  export NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  process.exitCode = 1;
});
