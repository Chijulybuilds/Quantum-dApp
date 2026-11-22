import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";

const COLS = 24;
const ROWS = 4;
const CELLS = COLS * ROWS; // each cell ≈ 48 of the 4,627 bytes
const segmentOf = (i: number) => (i < 1 ? "c" : i >= CELLS - 2 ? "h" : "z");
const SEGMENT_COLOR = { c: "#a28bff", z: "#7b5cff", h: "#ffd34d" } as const;

const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * What happens while a member signs: the 4,627-byte ML-DSA-87 signature (c̃ ‖ z ‖ h) forms cell by
 * cell, then a scan sweeps it while the chain's pqcVerify checks it, then it seals mint.
 */
export function SignatureForge({ phase, signature }: { phase: "signing" | "relaying" | "done"; signature?: Hex }) {
  const delays = useMemo(() => Array.from({ length: CELLS }, () => Math.random() * 1.4), []);
  const [noise, setNoise] = useState(() => randomHex(32));
  const ref = useRef<HTMLDivElement>(null);

  // The drawer may be scrolled to the form: bring the forge into view once it starts.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (phase !== "signing") return;
    const t = setInterval(() => setNoise(randomHex(32)), 80);
    return () => clearInterval(t);
  }, [phase]);

  const caption =
    phase === "signing" ? "Waiting for QoreX to sign with ML-DSA-87…" : phase === "relaying" ? "Checking all 4,627 bytes on chain with pqcVerify…" : "Verified on chain";

  return (
    <div ref={ref} className="scroll-mb-8 rounded-2xl border border-white/10 bg-ink p-4">
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className={phase === "done" ? "text-mint" : "text-fog"}>{caption}</span>
        <span className="hash text-mute">4,627 B</span>
      </div>
      <div className="relative overflow-hidden rounded-lg">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {delays.map((d, i) => {
            const color = phase === "done" ? "#34f5c5" : SEGMENT_COLOR[segmentOf(i)];
            return (
              <motion.span
                key={i}
                className="h-2.5 rounded-[3px]"
                style={{ backgroundColor: color }}
                initial={{ opacity: 0.08 }}
                animate={phase === "signing" ? { opacity: [0.08, 0.95, 0.25] } : { opacity: 1 }}
                transition={
                  phase === "signing"
                    ? { duration: 1.4, delay: d, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
                    : { duration: 0.4, delay: phase === "done" ? (i % COLS) * 0.012 : d * 0.25 }
                }
              />
            );
          })}
        </div>
        {phase === "relaying" && <span className="scan pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/45 to-transparent" />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-fog">
        <Legend color={SEGMENT_COLOR.c} label="c̃ 64 B" />
        <Legend color={SEGMENT_COLOR.z} label="z 4,480 B" />
        <Legend color={SEGMENT_COLOR.h} label="h 83 B" />
      </div>
      <p className="hash mt-2 truncate text-[0.68rem] text-white/45">{phase === "signing" ? `0x${noise}…` : signature ? `${signature.slice(0, 66)}…` : " "}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
