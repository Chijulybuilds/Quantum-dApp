// Friendly pre-flight for the root npm scripts: Node version and installed dependencies.
import { existsSync } from "node:fs";

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`\nConclave needs Node.js 22 or newer; this is ${process.versions.node}. Install it (e.g. nvm install 22) and retry.\n`);
  process.exit(1);
}

const missing = ["node_modules", "server/node_modules", "app/node_modules"].filter((dir) => !existsSync(dir));
if (missing.length) {
  console.error(`\nDependencies are not installed yet (missing: ${missing.join(", ")}).\nRun this once from the repo root, then retry:\n\n  npm run install:all\n`);
  process.exit(1);
}
