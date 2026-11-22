import { motion } from "motion/react";

const WIRE = "M6 38 C 46 38, 58 12, 100 18 S 160 40, 196 24";

/**
 * The guardian's one-shot pause as a fuse. Armed: the tip sparks. Paused: the wire burns down
 * with the remaining pause. Spent: a cold, dashed wire.
 */
export function GuardianFuse({ state, remaining = 0 }: { state: "armed" | "paused" | "spent"; remaining?: number }) {
  return (
    <svg viewBox="0 0 206 56" className="h-14 w-full max-w-[220px] overflow-visible" aria-hidden>
      <path d={WIRE} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} strokeLinecap="round" strokeDasharray={state === "spent" ? "4 6" : undefined} />
      {state === "armed" && (
        <>
          <motion.path
            d={WIRE}
            fill="none"
            stroke="url(#fuse-armed)"
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          />
          <circle cx={196} cy={24} r={10} fill="#ffd34d" opacity={0.18} className="spark" />
          <circle cx={196} cy={24} r={4} fill="#ffd34d" className="spark" />
          {[
            [10, -16],
            [16, -4],
            [6, -20],
            [14, 8],
          ].map(([fx, fy], i) => (
            <circle
              key={i}
              cx={196}
              cy={24}
              r={1.6}
              fill="#ffd34d"
              className="ember-fly"
              style={{ ["--fx" as string]: `${fx}px`, ["--fy" as string]: `${fy}px`, animationDelay: `${i * 0.38}s` }}
            />
          ))}
        </>
      )}
      {state === "paused" && (
        <motion.path
          d={WIRE}
          fill="none"
          stroke="#ff5a36"
          strokeWidth={3}
          strokeLinecap="round"
          animate={{ pathLength: Math.max(0.02, Math.min(1, remaining)) }}
          transition={{ duration: 1, ease: "linear" }}
        />
      )}
      <defs>
        <linearGradient id="fuse-armed" x1="0" x2="1">
          <stop offset="0" stopColor="#ffd34d" stopOpacity={0.15} />
          <stop offset="1" stopColor="#ffd34d" stopOpacity={0.9} />
        </linearGradient>
      </defs>
    </svg>
  );
}
