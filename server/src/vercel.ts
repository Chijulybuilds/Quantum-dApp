/**
 * Vercel entry: the same Hono app as src/index.ts, as a Node.js serverless function.
 * scripts/vercel-build.mjs bundles this file into .vercel/output/functions/api.func.
 */
import { handle } from "@hono/node-server/vercel";

import { createApp } from "./app.js";

export default handle(createApp());
