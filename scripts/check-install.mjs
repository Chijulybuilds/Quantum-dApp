// Friendly pre-flight for the root npm scripts: Node version and installed dependencies.
import { existsSync } from "node:fs";

// The strictest dependency (Vite / Tailwind tooling) needs Node 20.19.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error(`\nConclave needs Node.js 20.19 or newer; this is ${process.versions.node}. Install it (e.g. nvm install 22) and retry.\n`);
  process.exit(1);
}

const missing = ["node_modules", "server/node_modules", "app/node_modules"].filter((dir) => !existsSync(dir));
if (missing.length) {
  console.error(`\nDependencies are not installed yet (missing: ${missing.join(", ")}).\nRun this once from the repo root, then retry:\n\n  npm run install:all\n`);
  process.exit(1);
}
