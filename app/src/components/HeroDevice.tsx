import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useLayoutEffect, useRef } from "react";

import { useDao, useProposals } from "../hooks/useConclave";
import { qor, short } from "../lib/format";
import { gsap, prefersReducedMotion } from "../lib/motion";

/**
 * The product in perspective: a live mini dashboard (real chain data) that straightens up as you
 * scroll, surrounded by floating widgets that drift with the pointer.
 */
export function HeroDevice() {
  const wrap = useRef<HTMLDivElement>(null);
  const device = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 20 });
  const sy = useSpring(py, { stiffness: 60, damping: 20 });

  useLayoutEffect(() => {
    if (!wrap.current || !device.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        device.current,
        { rotateX: 32, scale: 0.86, y: 40 },
        { rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: wrap.current, start: "top 85%", end: "top 15%", scrub: true } },
      );
    }, wrap);
    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={wrap}
      className="relative mx-auto mt-14 w-full max-w-5xl"
      style={{ perspective: 1400 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
    >
      <div ref={device} style={{ transformOrigin: "50% 100%" }} className="relative rounded-[30px] border border-white/10 bg-ink-2 p-2 shadow-[0_60px_160px_-40px_rgba(123,92,255,0.5)]">
        <DashboardPreview />
      </div>

      <Widget sx={sx} sy={sy} depth={40} className="-left-4 top-10 md:-left-16" delay={0.2}>
        <p className="text-[0.65rem] text-fog">Signature</p>
        <p className="hash text-lg">4,627 B</p>
        <p className="text-[0.65rem] text-mint">ML-DSA-87 · FIPS 204</p>
      </Widget>
      <Widget sx={sx} sy={sy} depth={-30} className="-right-4 top-24 md:-right-14" delay={0.35}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-mint text-sm font-bold text-ink">✓</span>
          <div>
            <p className="text-sm">pqcVerify</p>
            <p className="hash text-[0.65rem] text-fog">0x…0a01</p>
          </div>
        </div>
      </Widget>
      <Widget sx={sx} sy={sy} depth={55} className="-left-2 bottom-16 md:-left-20" delay={0.5}>
        <p className="text-[0.65rem] text-fog">Stolen ECDSA key can</p>
        <p className="text-sm">
          pause once <span className="text-ember">·</span> nothing else
        </p>
      </Widget>
      <Widget sx={sx} sy={sy} depth={-45} className="-right-2 bottom-6 md:-right-16" delay={0.65} round>
        <p className="text-2xl font-semibold">2/3</p>
        <p className="text-[0.6rem] opacity-80">PQ votes to pass</p>
      </Widget>
    </div>
  );
}

function Widget({
  children,
  className,
  sx,
  sy,
  depth,
  delay,
  round = false,
}: {
  children: React.ReactNode;
  className: string;
  sx: ReturnType<typeof useSpring>;
  sy: ReturnType<typeof useSpring>;
  depth: number;
  delay: number;
  round?: boolean;
}) {
  const x = useTransform(sx, (v) => v * depth);
  const y = useTransform(sy, (v) => v * depth);
  return (
    <motion.div
      style={{ x, y }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.2 + delay, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute z-10 hidden sm:block ${className}`}
    >
      <div
        className={`float ${round ? "grid h-28 w-28 place-items-center rounded-full bg-violet text-center shadow-[0_20px_60px_-10px_rgba(123,92,255,0.7)]" : "rounded-2xl border border-white/10 bg-panel/90 px-4 py-3 backdrop-blur-xl"}`}
        style={{ animationDelay: `${delay * 2}s` }}
      >
        {children}
      </div>
    </motion.div>
  );
}

const STATE_COLOR: Record<string, string> = {
  Active: "bg-violet/20 text-violet-2",
  Queued: "bg-sun/15 text-sun",
  Ready: "bg-mint/15 text-mint",
  Executed: "bg-white/10 text-white",
  Defeated: "bg-ember/15 text-ember",
  Canceled: "bg-white/5 text-fog",
  Expired: "bg-white/5 text-fog",
  Stale: "bg-white/5 text-fog",
};

export function stateClass(state: string) {
  return STATE_COLOR[state] ?? "bg-white/5 text-fog";
}

/** A compact, read-only Conclave dashboard with live data (placeholders when offline). */
function DashboardPreview() {
  const dao = useDao();
  const proposals = useProposals();
  const latest = proposals.data?.[0];
  const members = dao.data?.members ?? [];
  const need = dao.data?.threshold ?? 2;

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/5 bg-ink">
      <div className="flex items-center gap-2 border-b border-white/5 px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="hash ml-4 truncate text-xs text-mute">conclave · {dao.data ? short(dao.data.address, 8, 6) : "qorechain-diana"}</span>
        <span className={`ml-auto flex items-center gap-2 text-xs ${dao.data?.paused ? "text-ember" : "text-mint"}`}>
          <span className="relative h-1.5 w-1.5 rounded-full bg-current pulse-dot" />
          {dao.data ? (dao.data.paused ? "Paused" : "Live on testnet") : "Connecting…"}
        </span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-[1.2fr_1fr]">
        <div className="card p-5">
          <p className="text-xs text-fog">Treasury</p>
          <p className="mt-2 text-5xl font-medium tracking-tight">
            {qor(dao.data?.treasuryWei)} <span className="text-xl text-fog">QOR</span>
          </p>
          <div className="mt-5 flex items-end gap-1.5">
            {[38, 52, 46, 64, 58, 72, 66, 84, 78, 92].map((h, i) => (
              <motion.span
                key={i}
                initial={{ height: 0 }}
                animate={{ height: h * 0.7 }}
                transition={{ delay: 1.4 + i * 0.05, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className={`w-full rounded-md ${i === 9 ? "bg-violet" : "bg-white/10"}`}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-3">
          <div className="card p-5">
            <p className="text-xs text-fog">Members · ML-DSA-87</p>
            <div className="mt-3 space-y-2">
              {(members.length ? members : Array.from({ length: 3 }, () => undefined)).map((m, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="hash text-white/80">{m ? short(m.address) : "0x……"}</span>
                  <span className={`text-xs ${m?.mlDsa87 ? "text-mint" : "text-mute"}`}>{m?.mlDsa87 ? "● key on chain" : "○"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-fog">Latest proposal</p>
              {latest && <span className={`rounded-full px-2 py-0.5 text-[0.65rem] ${stateClass(latest.state)}`}>{latest.state}</span>}
            </div>
            <p className="mt-2 truncate text-sm">{latest ? `#${latest.id} · ${latest.description}` : "No proposals yet"}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-mint" initial={{ width: 0 }} animate={{ width: `${Math.min(100, ((latest?.forVotes ?? 0) / need) * 100)}%` }} transition={{ duration: 1, delay: 1.6 }} />
            </div>
            <p className="mt-2 text-xs text-fog">
              {latest?.forVotes ?? 0} of {need} post-quantum votes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
