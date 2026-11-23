/**
 * sign-message.ts - signs a Conclave message with a member's ML-DSA-87 key, for when the wallet
 * cannot (for example QoreX with an account imported from MetaMask): copy the text the app shows
 * under "You sign exactly this", run this, and paste the printed signature back into the app.
 *
 *   npm run sign-message                paste the message, then press Enter and Ctrl+D
 *   npm run sign-message -- msg.txt     or read it from a file
 *
 * The key is derived from MEMBER_MNEMONIC (or QORE_MNEMONIC) in contracts/.env, exactly like
 * QoreX and the SDK derive it. It is checked against the key registered on chain before anything
 * is printed, and the relayer checks the signature again before sending a transaction.
 */
import { readFileSync } from "node:fs";

import { pqcKeyStatus } from "@qorechain/evm";
import type { Address } from "viem";

import { explain, loadMember, network, publicClient, signMessagePq } from "./lib/qore.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) console.error("Paste the message from the app (it starts with \"Conclave v1\"), then press Enter and Ctrl+D:\n");
  const raw = readFileSync(file ?? 0, "utf8");
  // The app shows the message exactly; drop Windows line endings and the trailing newline of the paste.
  const message = raw.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
  if (!message.startsWith("Conclave v1\n")) throw new Error('That is not a Conclave message: copy the whole text, starting with "Conclave v1".');

  const member = await loadMember();
  const status = await pqcKeyStatus(publicClient(), member.evm as Address);
  if (!status.registered) throw new Error(`${member.evm} has no ML-DSA-87 key registered on chain (npm run window register).`);
  const memberLine = message.match(/^member: (0x[0-9a-f]{40})$/m)?.[1];
  if (memberLine && memberLine.toLowerCase() !== member.evm.toLowerCase()) {
    throw new Error(`The message is for member ${memberLine}, but contracts/.env holds ${member.evm}.`);
  }

  const signature = signMessagePq(member, network().chainId, message, status.pubkey);
  console.log(`\nSigned as ${member.evm} with its registered ML-DSA-87 key (4,627 bytes).`);
  console.log(`Paste this into the app ("Sign with the Conclave CLI instead"):\n\n${signature}\n`);
}

main().catch((err: unknown) => {
  console.error(explain(err));
  process.exitCode = 1;
});
