import { motion } from "motion/react";
import type { Address } from "viem";

/**
 * The members as nodes on a ring. The violet arc is the share of signatures needed to pass; a
 * signal orbits the ring and each node pings in turn, like keys answering a roll call.
 */
export function QuorumRing({
  members,
  threshold,
  me,
  size = 140,
}: {
  members: { address: Address; mlDsa87: boolean }[];
  threshold: number;
  me?: Address;
  size?: number;
}) {
  const c = size / 2;
  const r = size / 2 - 18;
  const n = Math.max(members.length, 1);
  const circumference = 2 * Math.PI * r;
  const share = Math.min(1, threshold / n);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="overflow-visible">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
        <motion.circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="#7b5cff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          whileInView={{ strokeDashoffset: circumference * (1 - share) }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          transform={`rotate(-90 ${c} ${c})`}
        />
        <g className="orbit" style={{ transformOrigin: `${c}px ${c}px` }}>
          <circle cx={c} cy={c - r} r={2.4} fill="#a28bff" />
          <circle cx={c} cy={c - r} r={6} fill="#a28bff" opacity={0.18} />
        </g>
        {members.map((m, i) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const x = c + r * Math.cos(a);
          const y = c + r * Math.sin(a);
          const mine = Boolean(me && m.address.toLowerCase() === me.toLowerCase());
          const color = m.mlDsa87 ? "#34f5c5" : "#ff5a36";
          return (
            <g key={m.address}>
              <title>{`${m.address}${mine ? " (you)" : ""} · ${m.mlDsa87 ? "ML-DSA-87 key" : "no post-quantum key"}`}</title>
              <circle cx={x} cy={y} r={7} fill={color} className="node-ping" style={{ animationDelay: `${i * 0.8}s` }} />
              <motion.circle
                cx={x}
                cy={y}
                r={mine ? 8 : 6.5}
                fill={color}
                stroke="#0e0e10"
                strokeWidth={3}
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.35 + i * 0.12, type: "spring", stiffness: 320, damping: 14 }}
              />
              {mine && <circle cx={x} cy={y} r={12.5} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.2} />}
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-medium tabular-nums">
            {threshold}
            <span className="text-fog">/{members.length || "–"}</span>
          </p>
          <p className="text-[0.65rem] tracking-[0.18em] text-fog uppercase">to pass</p>
        </div>
      </div>
    </div>
  );
}
