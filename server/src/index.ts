import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { account } from "./chain.js";
import { config, deployment } from "./config.js";

const app = createApp();
const relayer = await account("relayer");
const d = deployment();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Conclave relayer on http://localhost:${info.port}`);
  console.log(`  network   ${config.chainId} (EVM ${config.evmChainId})`);
  console.log(`  relayer   ${relayer.evm} (${relayer.cosmos})`);
  console.log(`  conclave  ${d ? d.address : "not deployed yet (run npm run setup:testnet)"}`);
  console.log(`  origins   ${config.appOrigins.join(", ")}`);
  console.log(`  demo mode ${config.demoMode ? "ON (demo keys can sign on request)" : "off"}`);
});
