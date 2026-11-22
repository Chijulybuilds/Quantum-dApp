import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

import { Mark } from "../components/Logo";
import { makeLiveSignature } from "../lib/mldsa";

const QuantumComputer = lazy(() => import("../three/QuantumComputer"));

/**
 * The project cover (1920×1080), rendered from the real product: the 3D cryostat in a fixed pose,
 * one complete ML-DSA-87 signature as the background texture, and fragments of the app's UI.
 * Open /#/cover and screenshot the #cover element.
 */
export function Cover() {
  const signals = useRef({
    progress: { current: 0 },
    pointer: { current: { x: 0, y: 0 } },
    dragVelocity: { current: 0 },
    pulses: { current: [] as number[] },
  }).current;
  const sig = useMemo(() => makeLiveSignature(), []);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const bytes = Array.from(sig.signature, (b) => b.toString(16).padStart(2, "0"));

  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-black">
      <div
        id="cover"
        className="relative shrink-0 overflow-hidden bg-ink text-white"
        style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "center" }}
      >
        {/* One whole signature as texture: c̃ in mint, z dim, h in violet */}
        <p className="hash absolute top-[56px] right-[56px] w-[1040px] text-[11px] leading-[15.2px] break-all select-none" aria-hidden>
          {bytes.map((b, i) => (
            <span key={i} className={i < 64 ? "text-mint/70" : i >= 4544 ? "text-violet-2/75" : "text-white/[0.085]"}>
              {b}{" "}
            </span>
          ))}
        </p>
        <div className="absolute inset-y-0 left-0 w-[900px] bg-gradient-to-r from-ink via-ink/95 to-transparent" />

        {/* The machine */}
        <div className="absolute top-0 left-[690px] h-[1080px] w-[1120px]">
          <Suspense fallback={null}>
            <QuantumComputer
              signals={signals}
              stage={-1}
              active
              still={{ camera: [3.4, 0.85, 13.6], target: [0, 0.15, 0], rotation: 0.55, glint: [2.6, 1.6, 3.6] }}
            />
          </Suspense>
        </div>

        {/* The machine descends into darkness behind the spec strip */}
        <div className="absolute inset-x-0 bottom-0 h-[210px] bg-gradient-to-t from-ink via-ink/90 to-transparent" />

        {/* Header */}
        <div className="absolute top-[64px] left-[96px] flex items-center gap-4">
          <Mark size={44} />
          <span className="text-[30px] font-semibold tracking-tight">Conclave</span>
          <span className="hash ml-6 text-[15px] tracking-[0.18em] text-white/45">POST-QUANTUM dAPP · BUILD BEFORE Q-DAY</span>
        </div>

        {/* Headline */}
        <h1 className="absolute top-[250px] left-[90px] text-[136px] leading-[0.93] font-medium tracking-[-0.05em]">
          The treasury
          <br />
          Q-Day can't
          <br />
          touch<span className="text-mint">.</span>
        </h1>
        <p className="absolute top-[680px] left-[96px] w-[640px] text-[25px] leading-[1.4] text-white/60">
          Every vote is an ML-DSA-87 signature, verified on chain by QoreChain's <span className="hash text-white">pqcVerify</span>. A stolen ECDSA key moves nothing.
        </p>

        {/* Product fragments */}
        <div className="absolute top-[838px] left-[96px] flex items-center gap-5">
          <div className="flex items-center gap-4 rounded-[26px] border border-white/10 bg-panel/90 py-4 pr-7 pl-4">
            <Ring pct={0.66} label="2/3" />
            <div>
              <p className="text-[19px]">#7 · Grant payout · 5 QOR</p>
              <p className="mt-1 text-[15px] text-white/50">
                <span className="text-mint">●</span> 2 ML-DSA-87 votes · queued
              </p>
            </div>
          </div>
          <div className="flex h-[64px] items-center gap-3 rounded-full bg-white pr-7 pl-2 text-[19px] font-semibold text-ink">
            <span className="relative grid h-[48px] w-[48px] place-items-center rounded-full bg-ink">
              <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="20" cy="20" r="18" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" fill="none" />
                <circle cx="20" cy="20" r="18" stroke="#34f5c5" strokeWidth="2.5" fill="none" strokeDasharray="113" strokeDashoffset="34" strokeLinecap="round" />
              </svg>
              <Mark size={22} />
            </span>
            Hold to connect
          </div>
        </div>
        <div className="absolute top-[790px] left-[640px] -rotate-[11deg] rounded-xl border-[3px] border-mint px-4 py-2 text-[20px] font-bold tracking-[0.2em] text-mint">
          QUANTUM-SEALED
        </div>

        {/* Interaction hint near the machine */}
        <div className="hash absolute top-[905px] left-[1010px] flex items-center gap-3 rounded-full border border-white/12 bg-ink/85 py-2 pr-5 pl-3 text-[15px] text-white/70">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 3l7 17 2.5-7 7-2.5z" fill="rgba(255,255,255,0.9)" stroke="none" />
          </svg>
          drag to spin · scroll to descend 50 K → 15 mK
        </div>

        {/* Spec strip */}
        <div className="hash absolute right-[96px] bottom-[44px] left-[96px] flex items-center justify-between border-t border-white/12 pt-5 text-[15px] text-white/55">
          <span>ML-DSA-87 · FIPS 204</span>
          <span>
            σ = <span className="text-mint">c̃ 64</span> + z 4,480 + <span className="text-violet-2">h 83</span> = 4,627 B
          </span>
          <span>pqcVerify 0x…0a01</span>
          <span>2-of-3 post-quantum votes</span>
          <span>qorechain-diana · EVM 9800</span>
        </div>

        {/* Crop marks */}
        {[
          "top-[28px] left-[28px] border-t border-l",
          "top-[28px] right-[28px] border-t border-r",
          "bottom-[28px] left-[28px] border-b border-l",
          "bottom-[28px] right-[28px] border-b border-r",
        ].map((c) => (
          <span key={c} className={`absolute h-6 w-6 border-white/30 ${c}`} />
        ))}
      </div>
    </div>
  );
}

function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[64px] w-[64px]">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} stroke="rgba(255,255,255,0.1)" strokeWidth="5" fill="none" />
        <circle cx="32" cy="32" r={r} stroke="#7b5cff" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[16px] font-semibold">{label}</span>
    </div>
  );
}
