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
 */
import { toEvmAddress } from "@qorechain/evm";
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";

import { conclaveAbi } from "./abi.js";
import { account, keyStatus, txUrl } from "./chain.js";
import { config, requireDeployment } from "./config.js";
import { STATES, read } from "./indexer.js";
import { proposeMessage, relayExecute, relayPropose, relayVote } from "./relay.js";
import { signAs } from "./signatures.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

  // ---- 1. Demo A proposes ---------------------------------------------------------------------
  const input = {
    proposer: voting[0]!,
    targets: [dao, dao],
    values: [0n, 0n],
    calldatas,
    description,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const role = (who: Address) => (same(who, demoA.evm) ? "demoA" : "demoB") as "demoA" | "demoB";
  const proposed = await relayPropose({ ...input, signature: (await signAs(role(input.proposer), await proposeMessage(input))).signature });
  const id = BigInt(proposed.proposalId ?? "0");
  if (!id) throw new Error(`Proposal not created: ${proposed.url}`);
  console.log(`\n1. proposed #${id}  ${proposed.url}`);

  // ---- 2. The demo members vote FOR ------------------------------------------------------------
  for (const voter of voting.slice(0, threshold)) {
    const message = await read<string>("voteMessage", [id, voter, true]);
    const { signature } = await signAs(role(voter), message);
    const r = await relayVote({ proposalId: id, voter, support: true, signature });
    console.log(`2. ${role(voter)} voted FOR  ${r.url}`);
  }

  // ---- 3. Timelock -----------------------------------------------------------------------------
  const timelock = Number(await read<bigint>("timelockDelay"));
  process.stdout.write(`3. waiting out the ${timelock}s timelock`);
  for (let waited = 0; ; waited += 10) {
    const state = STATES[await read<number>("state", [id])];
    if (state === "Ready") break;
    if (state !== "Queued" || waited > timelock + 300) throw new Error(`\nProposal #${id} is ${state}`);
    process.stdout.write(".");
    await sleep(10_000);
  }

  // ---- 4. Execute ------------------------------------------------------------------------------
  const executed = await relayExecute(id);
  console.log(`\n4. executed  ${txUrl(executed.hash)}`);
  const [after, needed] = await Promise.all([read<Address[]>("members"), read<number>("threshold")]);
  console.log(`\nMembers now (${needed} of ${after.length} to pass):\n  ${after.join("\n  ")}`);
  if (same(config.founder, oldMember)) {
    console.log(`\nAlso set CONCLAVE_FOUNDER=${newMember} in server/.env, so a future redeploy uses the new account.`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
