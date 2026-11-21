/**
 * Keeps the relayer's EVM window open and scoped to the Conclave contract.
 *
 * The window is the reason a leaked relayer key is harmless: it can only send transactions to
 * Conclave, which ignores msg.sender. Opening one needs the relayer's ML-DSA-87 key (hybrid
 * native-lane message), so the classical key alone can never widen it.
 */
import { evmWindowCost, evmWindowStatus, type EvmWindow } from "@qorechain/evm";
import { openEvmWindowMsg } from "@qorechain/sdk";
import type { Address } from "viem";

import { account, broadcastNative } from "./chain.js";
import { config } from "./config.js";

/** Budget per admitted transaction: a vote with a 4.6 KB signature, with headroom. */
const PER_TX_UQOR = evmWindowCost({ gas: 1_500_000n, maxFeePerGas: 250_000_000_000n });
const WINDOW_TXS = 40n;
const WINDOW_BLOCKS = 17_280n; // the chain's maximum

export async function relayerWindow(): Promise<EvmWindow> {
  const relayer = await account("relayer");
  return evmWindowStatus({ rest: config.rest, address: relayer.cosmos });
}

export function isScopedTo(w: EvmWindow, target: Address): boolean {
  return w.allowedTargets.length === 1 && w.allowedTargets[0]!.toLowerCase() === target.toLowerCase();
}

/** Opens a fresh scoped window when the current one is missing, unscoped or nearly used up. */
export async function ensureScopedWindow(target: Address): Promise<{ opened?: string; window: EvmWindow }> {
  const current = await relayerWindow();
  const healthy =
    current.found &&
    current.live &&
    isScopedTo(current, target) &&
    current.remainingTxs >= 1n &&
    current.remainingValue >= PER_TX_UQOR &&
    current.remainingBlocks > 30n;
  if (healthy) return { window: current };

  const relayer = await account("relayer");
  const msg = openEvmWindowMsg({
    sender: relayer.cosmos,
    blocks: WINDOW_BLOCKS,
    maxTxs: WINDOW_TXS,
    maxValue: PER_TX_UQOR * WINDOW_TXS,
    allowedTargets: [target],
  });
  const opened = await broadcastNative(relayer, "hybrid", [msg]);
  // The window is visible to the EVM lane in the next block.
  for (let i = 0; i < 20; i++) {
    const w = await relayerWindow();
    if (w.live && isScopedTo(w, target)) return { opened, window: w };
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Opened a scoped window but it did not become live in time");
}
