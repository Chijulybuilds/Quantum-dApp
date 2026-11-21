import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getNetwork } from "@qorechain/sdk";
import { getAddress, type Address } from "viem";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));

const Env = z.object({
  CONCLAVE_MNEMONIC: z.string().min(1, "CONCLAVE_MNEMONIC is required (see .env.example)"),
  CONCLAVE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  CONCLAVE_DEPLOY_BLOCK: z.coerce.bigint().optional(),
  /** Founding member besides the demo keys (the team's QoreX account). */
  CONCLAVE_FOUNDER: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0x8cb8f8C8aF2E98c4a952228344522126FA907c7F"),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Comma-separated origins allowed to call the API (the app). */
  APP_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  /** Demo keys may sign votes on request. Never enable for a real DAO. */
  DEMO_MODE: z.enum(["true", "false"]).default("true"),
  QORE_REST_URL: z.string().url().optional(),
  QORE_RPC_URL: z.string().url().optional(),
  QORE_EVM_RPC_URL: z.string().url().optional(),
});

const env = Env.parse(process.env);
const preset = getNetwork("testnet");

interface DeploymentFile {
  address: Address;
  blockNumber: string;
}

function deploymentFile(): DeploymentFile | undefined {
  try {
    return JSON.parse(
      readFileSync(resolve(here, "../../contracts/deployments/testnet.json"), "utf8"),
    ) as DeploymentFile;
  } catch {
    return undefined;
  }
}

export const config = {
  mnemonic: env.CONCLAVE_MNEMONIC,
  founder: getAddress(env.CONCLAVE_FOUNDER),
  port: env.PORT,
  appOrigins: env.APP_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  demoMode: env.DEMO_MODE === "true",
  chainId: preset.chainId, // native chain id (qorechain-diana)
  evmChainId: 9800,
  rest: env.QORE_REST_URL ?? preset.endpoints.rest,
  rpc: env.QORE_RPC_URL ?? preset.endpoints.rpc,
  evmRpc: env.QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host",
  explorer: "https://explore.qore.network",
};

/** The deployed Conclave, from the env or contracts/deployments/testnet.json. */
export function deployment(): { address: Address; fromBlock: bigint } | undefined {
  const file = deploymentFile();
  const raw = env.CONCLAVE_ADDRESS ?? file?.address;
  if (!raw) return undefined;
  return {
    address: getAddress(raw),
    fromBlock: env.CONCLAVE_DEPLOY_BLOCK ?? BigInt(file?.blockNumber ?? "0"),
  };
}

export function requireDeployment() {
  const d = deployment();
  if (!d) throw new HttpError(503, "NotDeployed", "Conclave is not deployed yet");
  return d;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
