#!/usr/bin/env node
/**
 * Builds Conclave for Vercel as one project: the web app as static files and the relayer API as
 * a Node.js function at /api/*, written in Vercel's Build Output API format (.vercel/output).
 *
 *   npm run build:vercel
 *
 * Vercel runs this (see vercel.json) and deploys .vercel/output as is. The relayer is bundled
 * with esbuild into a single file, so the function does not depend on how Vercel would compile
 * the server's TypeScript or resolve its node_modules.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel/output");
const fn = join(out, "functions/api.func");

const step = (msg) => console.log(`\n▸ ${msg}`);

rmSync(out, { recursive: true, force: true });

// 1. The web app. VITE_API_URL stays empty: the API is served from the same origin.
step("Building the web app");
execSync("npm --prefix app run build", { cwd: root, stdio: "inherit", env: { ...process.env, VITE_API_URL: "", BASE_PATH: "/" } });
cpSync(join(root, "app/dist"), join(out, "static"), { recursive: true });

// 2. The relayer API, bundled into one ES module.
step("Bundling the relayer API");
const esbuild = createRequire(join(root, "server/package.json"))("esbuild");
mkdirSync(fn, { recursive: true });
const result = await esbuild.build({
  entryPoints: [join(root, "server/src/vercel.ts")],
  outfile: join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  keepNames: true,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
  // Some dependencies are CommonJS and require() Node built-ins; give the ES module a require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const bytes = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].bytes;
console.log(`  api.func/index.mjs  ${(bytes / 1024 / 1024).toFixed(1)} MB`);

writeFileSync(
  join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 60,
    },
    null,
    2,
  ),
);

// 3. Routing: files first, /api/* to the function. The app uses hash routes, so no SPA fallback.
step("Writing the routing config");
writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        { src: "^/api(?:/.*)?$", dest: "/api" },
      ],
    },
    null,
    2,
  ),
);

console.log("\n✓ .vercel/output is ready: static app + /api function");
