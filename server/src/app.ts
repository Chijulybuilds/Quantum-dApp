/**
 * HTTP API of the Conclave relayer and indexer.
 *
 * Reads:   GET  /api/health, /api/dao, /api/proposals, /api/proposals/:id, /api/activity, /api/relayer
 * Relay:   POST /api/relay/propose | vote | votes | cancel | execute   (ML-DSA-87 signed by members)
 * Helpers: POST /api/messages/propose  (the exact text a member signs for a new proposal)
 * Demo:    POST /api/demo/vote | propose-payout                       (DEMO_MODE only)
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getAddress, isAddress, parseEther, type Address, type Hex } from "viem";
import { z } from "zod";

import { account, balanceUqor, keyStatus } from "./chain.js";
import { HttpError, config, deployment } from "./config.js";
import { getDao, getProposal, listProposals, read, recentActivity } from "./indexer.js";
import { isScopedTo, relayerWindow } from "./keeper.js";
import {
  proposeMessage,
  relayCancel,
  relayExecute,
  relayPropose,
  relayVote,
  relayVotes,
} from "./relay.js";
import { signAs } from "./signatures.js";

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const address = z.string().refine((s) => isAddress(s, { strict: false }), "invalid address").transform((s) => getAddress(s) as Address);
const uint = z.union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const hexData = z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(20_000) as unknown as z.ZodType<Hex>;
const signature = z.string().min(64).max(13_000);

export const schemas = {
  vote: z.object({ proposalId: uint, voter: address, support: z.boolean(), signature }),
  votes: z.object({
    proposalId: uint,
    votes: z.array(z.object({ voter: address, support: z.boolean(), signature })).min(1).max(16),
  }),
  propose: z.object({
    proposer: address,
    targets: z.array(address).min(1).max(16),
    values: z.array(uint).min(1).max(16),
    calldatas: z.array(hexData).min(1).max(16),
    description: z.string().min(1).max(2_000),
    deadline: uint,
    signature,
  }),
  proposeMessage: z.object({
    proposer: address,
    targets: z.array(address).min(1).max(16),
    values: z.array(uint).min(1).max(16),
    calldatas: z.array(hexData).min(1).max(16),
    description: z.string().min(1).max(2_000),
    deadline: uint,
  }),
  cancel: z.object({ proposalId: uint, signature }),
  execute: z.object({ proposalId: uint }),
  demoVote: z.object({ proposalId: uint, member: z.enum(["A", "B"]), support: z.boolean() }),
  demoPropose: z.object({
    member: z.enum(["A", "B"]),
    to: address,
    amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
    description: z.string().min(1).max(500),
  }),
};

async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "BadJson", "Body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "BadRequest", "Invalid request", parsed.error.issues);
  return parsed.data;
}

/** JSON with bigints as strings. */
function json(c: Context, data: unknown, status = 200) {
  return c.newResponse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), status as 200, {
    "content-type": "application/json",
  });
}

// ---------------------------------------------------------------------------------------------
// Rate limiting (per IP, in memory): relays cost gas, so they are limited more tightly.
// ---------------------------------------------------------------------------------------------

const buckets = new Map<string, { count: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > max;
}

function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------

export function createApp() {
  const app = new Hono();

  app.use("*", secureHeaders());
  app.use("/api/*", cors({ origin: config.appOrigins, allowMethods: ["GET", "POST"], allowHeaders: ["content-type"], maxAge: 600 }));
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "PayloadTooLarge" }, 413) }));
  app.use("/api/*", async (c, next) => {
    const post = c.req.method === "POST";
    if (limited(`${post ? "w" : "r"}:${clientIp(c)}`, post ? 20 : 240, 60_000)) {
      return c.json({ error: "RateLimited", message: "Too many requests, slow down" }, 429);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return json(c, { error: err.code, message: err.message, details: err.details }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal", message: err instanceof Error ? err.message.split("\n")[0] : "Unexpected error" }, 500);
  });

  // ---- Reads -------------------------------------------------------------------------------

  app.get("/api/health", (c) =>
    json(c, { ok: true, deployed: Boolean(deployment()), chainId: config.chainId, evmChainId: config.evmChainId, demoMode: config.demoMode }),
  );
  app.get("/api/dao", async (c) => json(c, await getDao()));
  app.get("/api/proposals", async (c) => json(c, await listProposals()));
  app.get("/api/proposals/:id{[0-9]+}", async (c) => json(c, await getProposal(c.req.param("id"))));
  app.get("/api/activity", async (c) => json(c, await recentActivity(40)));
  app.get("/api/keys/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a, { strict: false })) throw new HttpError(400, "BadAddress", "Invalid address");
    const s = await keyStatus(getAddress(a));
    return json(c, { address: getAddress(a), registered: s.registered, algorithmId: s.algorithmId, mlDsa87: s.isMlDsa87, keyBytes: (s.pubkey.length - 2) / 2 });
  });
  app.get("/api/relayer", async (c) => {
    const relayer = await account("relayer");
    const [w, uqor] = await Promise.all([relayerWindow(), balanceUqor(relayer.cosmos)]);
    const d = deployment();
    return json(c, {
      address: relayer.evm,
      qor: relayer.cosmos,
      balanceUqor: uqor.toString(),
      window: {
        live: w.live,
        scopedToConclave: d ? isScopedTo(w, d.address) : false,
        allowedTargets: w.allowedTargets,
        remainingTxs: w.remainingTxs.toString(),
        remainingBlocks: w.remainingBlocks.toString(),
        remainingValueUqor: w.remainingValue.toString(),
      },
    });
  });

  // ---- Signed actions ------------------------------------------------------------------------

  app.post("/api/messages/propose", async (c) => {
    const p = await body(c, schemas.proposeMessage);
    return json(c, { message: await proposeMessage(p) });
  });
  app.post("/api/relay/vote", async (c) => json(c, await relayVote(await body(c, schemas.vote))));
  app.post("/api/relay/votes", async (c) => {
    const b = await body(c, schemas.votes);
    return json(c, await relayVotes(b.proposalId, b.votes));
  });
  app.post("/api/relay/propose", async (c) => json(c, await relayPropose(await body(c, schemas.propose))));
  app.post("/api/relay/cancel", async (c) => {
    const b = await body(c, schemas.cancel);
    return json(c, await relayCancel(b.proposalId, b.signature));
  });
  app.post("/api/relay/execute", async (c) => json(c, await relayExecute((await body(c, schemas.execute)).proposalId)));

  // ---- Demo members (testnet demo DAO only) ---------------------------------------------------

  app.post("/api/demo/vote", async (c) => {
    if (!config.demoMode) throw new HttpError(404, "NotFound", "Demo mode is off");
    const b = await body(c, schemas.demoVote);
    const role = b.member === "A" ? "demoA" : "demoB";
    const voter = (await account(role)).evm as Address;
    const message = await read<string>("voteMessage", [b.proposalId, voter, b.support]);
    const { signature } = await signAs(role, message);
    return json(c, { message, ...(await relayVote({ proposalId: b.proposalId, voter, support: b.support, signature })) });
  });
  app.post("/api/demo/propose-payout", async (c) => {
    if (!config.demoMode) throw new HttpError(404, "NotFound", "Demo mode is off");
    const b = await body(c, schemas.demoPropose);
    const role = b.member === "A" ? "demoA" : "demoB";
    const proposer = (await account(role)).evm as Address;
    const input = {
      proposer,
      targets: [b.to],
      values: [parseEther(b.amount)],
      calldatas: ["0x" as Hex],
      description: b.description,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const message = await proposeMessage(input);
    const { signature } = await signAs(role, message);
    return json(c, { message, ...(await relayPropose({ ...input, signature })) });
  });

  app.notFound((c) => c.json({ error: "NotFound" }, 404));
  return app;
}
