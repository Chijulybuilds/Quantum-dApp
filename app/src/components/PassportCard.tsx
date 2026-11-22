import { toQorAddress } from "@qorechain/evm/window";
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import type { PointerEvent } from "react";
import type { Address, Hex } from "viem";

import { fingerprint, short } from "../lib/format";

export interface PassportData {
  address?: Address;
  walletName?: string;
  mlDsa87: boolean;
  keyBytes: number;
  pubkey?: Hex;
  isMember: boolean;
  isGuardian: boolean;
}

/** Gradient "avatar" derived from the address, so every passport looks a little different. */
export function addressHue(address?: string): number {
  if (!address) return 260;
  return parseInt(address.slice(2, 8), 16) % 360;
}

/**
 * The Q-Passport: the connected wallet's identity in Conclave. It tilts with the pointer and a
 * holographic sheen follows it; the stamp says whether the account can sign post-quantum.
 */
export function PassportCard({ data, stamp = true }: { data: PassportData; stamp?: boolean }) {
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [10, -10]), { stiffness: 160, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-14, 14]), { stiffness: 160, damping: 18 });
  const sheen = useMotionTemplate`radial-gradient(60% 80% at ${useTransform(mx, (v) => v * 100)}% ${useTransform(my, (v) => v * 100)}%, rgba(255,255,255,0.22), transparent 60%)`;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };
  const reset = () => {
    mx.set(0.5);
    my.set(0.5);
  };

  const hue = addressHue(data.address);
  const role = data.isGuardian ? "GUARDIAN" : data.isMember ? "MEMBER" : "VISITOR";
  const qor = data.address ? toQorAddress(data.address) : undefined;
  const mrz = `P<CONCLAVE<<${(data.address ?? "0x").slice(2, 22).toUpperCase()}<<${role}<<<<`.padEnd(44, "<").slice(0, 44);

  return (
    <div style={{ perspective: 1200 }} className="w-full max-w-[420px]">
      <motion.div
        onPointerMove={onMove}
        onPointerLeave={reset}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="relative aspect-[1.58] w-full overflow-hidden rounded-[26px] border border-white/15 p-6 shadow-[0_40px_120px_-30px_rgba(123,92,255,0.45)]"
      >
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 70% 22%) 0%, #121216 45%, hsl(${(hue + 120) % 360} 70% 18%) 100%)`,
          }}
        />
        <div className="grid-lines absolute inset-0 opacity-60" />
        <motion.div className="absolute inset-0 mix-blend-overlay" style={{ background: sheen }} />

        <div className="relative flex h-full flex-col justify-between" style={{ transform: "translateZ(40px)" }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.65rem] tracking-[0.3em] text-white/55">Q-PASSPORT · QORECHAIN DIANA</p>
              <p className="mt-1 text-lg font-semibold">{data.walletName ?? "Wallet"}</p>
            </div>
            <div
              className="h-12 w-12 rounded-2xl border border-white/20"
              style={{ background: `conic-gradient(from 90deg, hsl(${hue} 90% 65%), hsl(${(hue + 90) % 360} 90% 60%), hsl(${(hue + 200) % 360} 90% 65%), hsl(${hue} 90% 65%))` }}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[0.72rem]">
            <div>
              <dt className="text-white/45">Holder</dt>
              <dd className="hash text-[0.8rem]">{short(data.address, 8, 6)}</dd>
            </div>
            <div>
              <dt className="text-white/45">Native</dt>
              <dd className="hash text-[0.8rem]">{short(qor, 8, 5)}</dd>
            </div>
            <div>
              <dt className="text-white/45">Post-quantum key</dt>
              <dd className="text-[0.8rem]">{data.mlDsa87 ? `ML-DSA-87 · ${data.keyBytes.toLocaleString()} B` : "Not registered"}</dd>
            </div>
            <div>
              <dt className="text-white/45">Fingerprint</dt>
              <dd className="hash text-[0.8rem]">{data.mlDsa87 ? fingerprint(data.pubkey) : "—"}</dd>
            </div>
          </dl>

          <p className="hash truncate text-[0.62rem] tracking-[0.12em] text-white/40">{mrz}</p>
        </div>

        {stamp && (
          <motion.div
            initial={{ scale: 2.4, opacity: 0, rotate: -24 }}
            animate={{ scale: 1, opacity: 1, rotate: -12 }}
            transition={{ delay: 0.55, type: "spring", stiffness: 260, damping: 14 }}
            className={`absolute right-5 bottom-3 rounded-xl border-2 px-3 py-1.5 text-[0.7rem] font-bold tracking-[0.18em] ${
              data.mlDsa87 ? "border-mint text-mint" : "border-ember text-ember"
            }`}
            style={{ transform: "translateZ(60px)" }}
          >
            {data.mlDsa87 ? "QUANTUM-SEALED" : "CLASSICAL ONLY"}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
