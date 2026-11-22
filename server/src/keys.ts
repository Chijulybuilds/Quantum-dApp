/**
 * keys.ts - creates server/.env with a fresh TESTNET recovery phrase (once) and prints the four
 * backend accounts. Only the relayer needs test QOR from the faucet; setup:testnet funds the rest.
 *
 *   npm run keys
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
const examplePath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.example");

function readMnemonic(): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, "utf8").match(/^CONCLAVE_MNEMONIC="?([^"\n]+)"?/m);
  return match?.[1]?.trim() || undefined;
}

let mnemonic = readMnemonic();
if (mnemonic) {
  console.log("server/.env already has a recovery phrase; keeping it.\n");
} else {
  mnemonic = generateMnemonic(256);
  const template = existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "CONCLAVE_MNEMONIC=\n";
  writeFileSync(envPath, template.replace(/^CONCLAVE_MNEMONIC=.*$/m, `CONCLAVE_MNEMONIC="${mnemonic}"`), { mode: 0o600 });
  console.log("Created server/.env with a new TESTNET recovery phrase. Never commit it or reuse it on mainnet.\n");
}

const roles = ["relayer (pays gas)", "demo member A", "demo member B", "guardian"];
for (const [i, role] of roles.entries()) {
  const acc = await deriveUnifiedAccount(mnemonic, i);
  console.log(`${String(i).padEnd(2)}${role.padEnd(20)}${acc.cosmos}   ${acc.evm}`);
}
const relayer = await deriveUnifiedAccount(mnemonic, 0);
console.log(`\nNext: claim test QOR (at least 2.5) from https://dashboard.qorechain.io/faucet, or send it from QoreX, to\n  ${relayer.cosmos}\nthen run: npm run setup:testnet`);
