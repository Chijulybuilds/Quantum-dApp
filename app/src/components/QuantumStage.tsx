import { AnimatePresence, motion, useInView, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";

import { SIG_LAYOUT, makeLiveSignature, toHexRows, type LiveSignature } from "../lib/mldsa";
import { SplitReveal } from "./SplitReveal";

const QuantumComputer = lazy(() => import("../three/QuantumComputer"));

/** Scroll progress → stage (-1 = intro). Shared with the 3D camera keyframes. */
const STAGE_START = 0.05;
const STAGE_SPAN = 0.18;
export function stageOf(p: number) {
  if (p < STAGE_START) return -1;
  return Math.min(4, Math.floor((p - STAGE_START) / STAGE_SPAN));
}
function localT(p: number, stage: number) {
  return Math.min(1, Math.max(0, (p - STAGE_START - stage * STAGE_SPAN) / STAGE_SPAN));
}

const STAGES = [
  {
    temp: "50 K",
    title: "The message",
    formula: "μ = SHAKE256(tr ‖ M)",
    text: "The vote is plain text. QoreX prefixes it with qorechain-msg-v1 and the chain id, then ML-DSA-87 hashes it with the signer's public key into a 64-byte representative μ.",
    chips: ["FIPS 204", "SHAKE-256", "64 B"],
  },
  {
    temp: "4 K",
    title: "The mask",
    formula: "w = A·y  (mod q)",
    text: "A random mask y of 7 polynomials × 256 coefficients is multiplied by the public matrix A in Z_q[X]/(X²⁵⁶+1). Finding short vectors in this lattice is hard even for quantum computers.",
    chips: ["q = 8,380,417", "n = 256", "(k, l) = (8, 7)"],
  },
  {
    temp: "800 mK",
    title: "The challenge",
    formula: "c̃ = H(μ ‖ w₁)",
    text: "The high bits of w are hashed with μ into a 64-byte commitment c̃. It expands into a sparse challenge c with exactly 60 coefficients of ±1.",
    chips: ["τ = 60", "c̃ = 64 B"],
  },
  {
    temp: "100 mK",
    title: "The response",
    formula: "z = y + c·s₁",
    text: "The secret key s₁ hides inside the mask. If z could leak anything about it (‖z‖∞ ≥ γ₁ − β), the signer throws it away and starts again: rejection sampling.",
    chips: ["γ₁ = 2¹⁹", "β = 120", "z = 4,480 B"],
  },
  {
    temp: "15 mK",
    title: "The seal",
    formula: "σ = (c̃, z, h) → pqcVerify ✓",
    text: "An 83-byte hint h lets the verifier rebuild w₁. 64 + 4,480 + 83 = 4,627 bytes. Conclave checks every one on chain with QoreChain's pqcVerify precompile.",
    chips: ["ω = 75", "h = 83 B", "σ = 4,627 B"],
  },
];

export function QuantumStage() {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const inView = useInView(section, { margin: "300px 0px 300px 0px" });
  const signals = useRef({
    progress: { current: 0 },
    pointer: { current: { x: 0, y: 0 } },
    dragVelocity: { current: 0 },
    pulses: { current: [] as number[] },
  }).current;
  const [stage, setStage] = useState(-1);
  const [sig, setSig] = useState<LiveSignature>();
  const dragging = useRef<{ x: number; moved: number } | null>(null);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    signals.progress.current = v;
    const s = stageOf(v);
    setStage((prev) => (prev === s ? prev : s));
  });

  // A real signature, computed off the critical path.
  useEffect(() => {
    const id = window.setTimeout(() => setSig(makeLiveSignature()), 400);
    return () => window.clearTimeout(id);
  }, []);

  // Function transforms: computed by motion on each scroll update (the array form may be handed to a
  // native scroll timeline, whose range does not match this pinned section).
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const introOpacity = useTransform(scrollYProgress, (v) => 1 - clamp01(v / 0.045));
  const introY = useTransform(scrollYProgress, (v) => -80 * clamp01(v / 0.045));
  const uiOpacity = useTransform(scrollYProgress, (v) => (v < 0.95 ? clamp01((v - 0.035) / 0.035) : clamp01((1 - v) / 0.05)));

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    signals.pointer.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    if (dragging.current) {
      const dx = e.clientX - dragging.current.x;
      dragging.current.x = e.clientX;
      dragging.current.moved += Math.abs(dx);
      signals.dragVelocity.current += dx * 0.0022;
    }
  };

  return (
    <section ref={section} className="relative" style={{ height: "640vh" }} aria-label="How an ML-DSA-87 signature is built">
      <div
        className="sticky top-0 h-[100svh] cursor-grab touch-pan-y overflow-hidden select-none active:cursor-grabbing"
        onPointerMove={onPointerMove}
        onPointerDown={(e) => {
          dragging.current = { x: e.clientX, moved: 0 };
        }}
        onPointerUp={() => {
          if (dragging.current && dragging.current.moved < 6) signals.pulses.current.push(performance.now() / 1000);
          dragging.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
          signals.pointer.current = { x: 0, y: 0 };
        }}
      >
        <div className="spotlight absolute inset-0" />
        <div className="grid-lines absolute inset-0 opacity-60" />
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><div className="h-40 w-40 animate-pulse rounded-full bg-violet/20 blur-3xl" /></div>}>
          <QuantumComputer signals={signals} stage={stage} active={inView} />
        </Suspense>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/10 to-transparent md:via-transparent" />
        {/* Phones: the text sits over the machine, so darken behind it */}
        <motion.div style={{ opacity: introOpacity }} className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/10 md:hidden" />

        {/* Intro (hero) */}
        <motion.div style={{ opacity: introOpacity, y: introY }} className="pointer-events-none absolute inset-0 flex items-center px-5 md:px-14">
          <div className="pointer-events-auto max-w-xl pt-16">
            <motion.p className="pill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
              <span className="relative h-1.5 w-1.5 rounded-full bg-mint pulse-dot text-mint" />
              Post-quantum DAO treasury · QoreChain
            </motion.p>
            <SplitReveal as="h1" onLoad delay={1.0} className="mt-6 text-[2.7rem] leading-[1.0] font-medium tracking-[-0.035em] md:text-[4.6rem]">
              The treasury Q-Day can't touch.
            </SplitReveal>
            <motion.p
              className="mt-6 max-w-md text-lg text-fog"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.5, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              Every vote, payout and rule change needs an ML-DSA-87 signature, checked on chain by QoreChain's pqcVerify. Scroll down the machine to watch one being built.
            </motion.p>
            <motion.div className="mt-8 flex flex-wrap gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.75 }}>
              <Link to="/app" className="btn btn-primary">
                Open the treasury →
              </Link>
              <a href="#qday" className="btn btn-ghost">
                Simulate Q-Day
              </a>
            </motion.div>
          </div>
        </motion.div>

        {/* Stage captions */}
        <motion.div style={{ opacity: uiOpacity }} className="pointer-events-none absolute inset-x-0 top-24 px-5 md:top-1/2 md:left-14 md:w-[400px] md:-translate-y-1/2 md:px-0">
          <AnimatePresence mode="wait">
            {stage >= 0 && (
              <motion.div
                key={stage}
                initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="hash text-sm text-mint">
                  0{stage + 1} · {STAGES[stage]!.temp}
                </p>
                <h2 className="mt-2 text-4xl font-medium tracking-[-0.03em] md:text-6xl">{STAGES[stage]!.title}</h2>
                <p className="hash mt-4 text-lg text-violet-2 md:text-xl">{STAGES[stage]!.formula}</p>
                <p className="mt-4 hidden text-[0.98rem] leading-relaxed text-fog md:block">{STAGES[stage]!.text}</p>
                <div className="mt-5 hidden flex-wrap gap-2 md:flex">
                  {STAGES[stage]!.chips.map((c) => (
                    <span key={c} className="pill hash text-[0.72rem]">
                      {c}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div style={{ opacity: uiOpacity }}>
          <SignaturePanel sig={sig} progress={signals.progress} onResign={() => setSig(makeLiveSignature())} />
          <TemperatureRail stage={stage} />
        </motion.div>

        <motion.p style={{ opacity: introOpacity }} className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-xs text-fog md:flex">
          <span className="pill">Scroll to descend</span>
          <span className="pill">Drag to spin</span>
          <span className="pill">Click to pulse</span>
        </motion.p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function TemperatureRail({ stage }: { stage: number }) {
  return (
    <ol className="pointer-events-none absolute top-1/2 right-5 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
      {STAGES.map((s, i) => (
        <li key={s.temp} className="flex items-center justify-end gap-3 text-xs">
          <span className={`hash transition-colors duration-500 ${i === stage ? "text-white" : "text-mute"}`}>{s.temp}</span>
          <span className={`h-px transition-all duration-500 ${i === stage ? "w-10 bg-mint" : i < stage ? "w-5 bg-white/40" : "w-5 bg-white/15"}`} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The signature as it is "built": μ during the message stage, mask coefficients during the mask
 * stage, then the real c̃, z and h bytes of a signature computed in this browser. Updated in a rAF
 * loop from the scroll progress, without React re-renders.
 */
function SignaturePanel({ sig, progress, onResign }: { sig?: LiveSignature; progress: { current: number }; onResign: () => void }) {
  const rowsRef = useRef<HTMLPreElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const verifiedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sig) return;
    let raf = 0;
    let lastKey = "";
    const [c0, c1] = SIG_LAYOUT.ctilde;
    const [z0, z1] = SIG_LAYOUT.z;
    const [h0, h1] = SIG_LAYOUT.h;
    const perRow = window.innerWidth < 520 ? 10 : 16;
    const loop = () => {
      const p = progress.current;
      const s = stageOf(p);
      const t = s >= 0 ? localT(p, s) : 0;
      const done = p > STAGE_START + 5 * STAGE_SPAN - 0.01;
      const cRev = done || s > 2 ? 64 : s === 2 ? Math.round(t * 64) : 0;
      const zRev = done || s > 3 ? 4480 : s === 3 ? Math.round(t * 4480) : 0;
      const hRev = done ? 83 : s === 4 ? Math.round(Math.min(1, t * 1.35) * 83) : 0;
      const total = cRev + zRev + hRev;

      let label = "waiting";
      let rows: string[] = [];
      if (s === 0) {
        label = "μ · real, from this message and key";
        rows = toHexRows(sig.mu, 0, Math.max(16, Math.round(t * 64)), perRow);
      } else if (s === 1) {
        label = "w = A·y · coefficients mod q (illustrative)";
        const seed = Math.floor(performance.now() / 90);
        const mix = (n: number) => {
          let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
          h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
          return ((h ^ (h >>> 16)) >>> 0) % 8380417;
        };
        rows = Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: perRow > 10 ? 6 : 4 }, (_, c) => String(mix(seed * 131 + r * 17 + c)).padStart(7, " ")).join(" "),
        );
      } else if (s === 2) {
        label = "c̃ · commitment hash";
        rows = toHexRows(sig.signature, c0, c0 + Math.max(1, cRev), perRow);
      } else if (s === 3) {
        label = "z · response vector";
        const end = z0 + Math.max(16, zRev);
        rows = toHexRows(sig.signature, Math.max(z0, end - perRow * 6), end, perRow);
      } else if (s === 4) {
        label = "h · hint";
        rows = toHexRows(sig.signature, h0, h0 + Math.max(1, hRev), perRow);
      }
      const key = `${label}|${rows.join("|")}|${total}`;
      if (key !== lastKey) {
        lastKey = key;
        if (rowsRef.current) rowsRef.current.textContent = rows.slice(-6).join("\n");
        if (labelRef.current) labelRef.current.textContent = label;
        if (countRef.current) countRef.current.textContent = total.toLocaleString();
        const fills = [cRev / (c1 - c0), zRev / (z1 - z0), hRev / (h1 - h0)];
        bars.current.forEach((b, i) => b && (b.style.transform = `scaleX(${fills[i]})`));
        if (verifiedRef.current) verifiedRef.current.style.opacity = hRev === 83 ? "1" : "0";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sig, progress]);

  return (
    <div className="pointer-events-auto absolute right-4 bottom-4 left-4 md:right-24 md:bottom-10 md:left-auto md:w-[400px]">
      <div className="card bg-ink/70 p-5 backdrop-blur-xl" data-lenis-prevent>
        <div className="flex items-center justify-between text-xs">
          <span className="text-fog">ML-DSA-87 signature · built in your browser</span>
          <span className="hash whitespace-nowrap text-white">
            <span ref={countRef}>0</span> / 4,627 B
          </span>
        </div>
        <div className="mt-3 grid grid-cols-[1.2fr_7fr_1.1fr] gap-1">
          {(["c̃ 64", "z 4,480", "h 83"] as const).map((label, i) => (
            <div key={label}>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <span ref={(el) => (bars.current[i] = el)} className={`block h-full origin-left rounded-full ${i === 1 ? "bg-violet" : "bg-mint"}`} style={{ transform: "scaleX(0)" }} />
              </div>
              <p className="hash mt-1 text-[0.62rem] text-mute">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[0.7rem] text-violet-2">
          <span ref={labelRef}>waiting</span>
        </p>
        <pre ref={rowsRef} className="hash mt-1 h-[7.2rem] overflow-hidden text-[0.72rem] leading-[1.2rem] whitespace-pre text-white/80" />
        <div className="mt-2 flex items-center justify-between">
          <div ref={verifiedRef} className="text-xs text-mint transition-opacity duration-500" style={{ opacity: 0 }}>
            ✓ Verified with the public key{sig ? ` · signed in ${sig.millis.toFixed(0)} ms` : ""}
          </div>
          <button type="button" onClick={onResign} className="text-xs text-fog underline-offset-4 hover:text-white hover:underline">
            Re-sign<span className="hidden md:inline"> (new bytes)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
