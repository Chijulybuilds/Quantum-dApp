import { formatEther, keccak256, type Hex } from "viem";

export const short = (a?: string, head = 6, tail = 4) => (a ? `${a.slice(0, head)}…${a.slice(-tail)}` : "—");

export function qor(wei: string | bigint | undefined, digits = 2): string {
  if (wei === undefined) return "—";
  const n = Number(formatEther(BigInt(wei)));
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: n > 0 && n < 1 ? 2 : 0 });
}

/** A short, human-checkable fingerprint of a public key (like an SSH key fingerprint). */
export function fingerprint(pubkey?: Hex): string {
  if (!pubkey || pubkey.length < 10) return "—";
  const h = keccak256(pubkey).slice(2, 18).toUpperCase();
  return h.match(/.{4}/g)!.join(" ");
}

export function duration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
