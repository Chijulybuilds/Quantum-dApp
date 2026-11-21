import { describe, expect, it } from "vitest";

const { createApp, schemas } = await import("../src/app.js");
const app = createApp();
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("request validation", () => {
  it("rejects malformed votes before touching the chain", async () => {
    const res = await post("/api/relay/vote", { proposalId: "1", voter: "0x123", support: "yes", signature: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "BadRequest" });
  });

  it("rejects proposals with more than 16 actions", () => {
    const many = Array.from({ length: 17 }, () => "0x8cb8f8C8aF2E98c4a952228344522126FA907c7F");
    const parsed = schemas.propose.safeParse({
      proposer: many[0],
      targets: many,
      values: many.map(() => "0"),
      calldatas: many.map(() => "0x"),
      description: "too many",
      deadline: "1",
      signature: "0x" + "00".repeat(4627),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects calldata that is not hex", () => {
    const parsed = schemas.proposeMessage.safeParse({
      proposer: "0x8cb8f8C8aF2E98c4a952228344522126FA907c7F",
      targets: ["0x8cb8f8C8aF2E98c4a952228344522126FA907c7F"],
      values: ["0"],
      calldatas: ["transfer"],
      description: "x",
      deadline: "1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-JSON bodies and oversized payloads", async () => {
    const bad = await app.request("/api/relay/execute", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(bad.status).toBe(400);
    const big = await post("/api/relay/execute", { proposalId: "1", pad: "x".repeat(70_000) });
    expect(big.status).toBe(413);
  });

  it("hides the demo endpoints when demo mode is off", async () => {
    const res = await post("/api/demo/vote", { proposalId: "1", member: "A", support: true });
    expect(res.status).toBe(404);
  });

  it("reports health without a deployment", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toMatchObject({ ok: true, chainId: "qorechain-diana", evmChainId: 9800 });
  });
});
