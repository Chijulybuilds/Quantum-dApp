import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AnimatePresence, animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";

import { usePassport } from "../hooks/useConclave";
import { appConfig } from "../lib/config";
import { short } from "../lib/format";
import { LatticeField } from "./LatticeField";
import { Mark } from "./Logo";
import { PassportCard, addressHue } from "./PassportCard";

type Step = "closed" | "choose" | "handshake" | "passport";

/**
 * Connecting is a small ritual instead of a modal: hold the seal, pick the wallet that holds your
 * ML-DSA-87 key, watch the chain check your key and membership, then receive your Q-Passport.
 */
export function SealConnect({ compact = false }: { compact?: boolean }) {
  const { isConnected, address } = useAccount();
  const [step, setStep] = useState<Step>("closed");

  return (
    <>
      {isConnected ? (
        <PassportChip address={address} onClick={() => setStep("passport")} compact={compact} />
      ) : (
        <HoldToSeal onSealed={() => setStep("choose")} compact={compact} />
      )}
      {/* Portal: the nav's transform and backdrop blur would otherwise clip a fixed overlay. */}
      {createPortal(<Airlock step={step} setStep={setStep} />, document.body)}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Hold-to-seal button
// ---------------------------------------------------------------------------------------------

function HoldToSeal({ onSealed, compact }: { onSealed: () => void; compact: boolean }) {
  const progress = useMotionValue(0);
  const dash = useTransform(progress, [0, 1], [113, 0]);
  const glow = useTransform(progress, [0, 1], [0, 1]);
  const [holding, setHolding] = useState(false);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  const start = (e: PointerEvent) => {
    e.preventDefault();
    setHolding(true);
    controls.current?.stop();
    controls.current = animate(progress, 1, {
      duration: 0.75 * (1 - progress.get()),
      ease: "linear",
      onComplete: () => {
        setHolding(false);
        progress.set(0);
        onSealed();
      },
    });
  };
  const cancel = () => {
    if (!holding) return;
    setHolding(false);
    controls.current?.stop();
    controls.current = animate(progress, 0, { type: "spring", stiffness: 300, damping: 26 });
  };

  return (
    <motion.button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSealed();
        }
      }}
      whileHover={{ scale: 1.03 }}
      className={`group relative flex select-none items-center gap-3 rounded-full bg-white pr-5 pl-1.5 font-semibold whitespace-nowrap text-ink ${compact ? "h-10 text-sm" : "h-12 text-[0.95rem]"}`}
      aria-label="Connect wallet: press and hold, or press Enter"
    >
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ opacity: glow, boxShadow: "0 0 0 8px rgba(123,92,255,0.25), 0 0 40px rgba(123,92,255,0.6)" }}
      />
      <span className={`relative grid place-items-center rounded-full bg-ink ${compact ? "h-7 w-7" : "h-9 w-9"}`}>
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="20" cy="20" r="18" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" fill="none" />
          <motion.circle cx="20" cy="20" r="18" stroke="#34f5c5" strokeWidth="2.5" fill="none" strokeDasharray="113" style={{ strokeDashoffset: dash }} strokeLinecap="round" />
        </svg>
        <Mark size={compact ? 14 : 18} />
      </span>
      <span className="relative">{holding ? "Sealing…" : "Hold to connect"}</span>
    </motion.button>
  );
}

function PassportChip({ address, onClick, compact }: { address?: string; onClick: () => void; compact: boolean }) {
  const p = usePassport();
  const hue = addressHue(address);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      className={`flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.06] pr-4 pl-1.5 text-sm backdrop-blur ${compact ? "h-10" : "h-12"}`}
    >
      <span
        className="h-7 w-7 rounded-full"
        style={{ background: `conic-gradient(from 90deg, hsl(${hue} 90% 65%), hsl(${(hue + 120) % 360} 90% 60%), hsl(${hue} 90% 65%))` }}
      />
      <span className="hash">{short(address)}</span>
      <span className={`relative h-2 w-2 rounded-full ${p.key.mlDsa87 ? "pulse-dot bg-mint text-mint" : "bg-ember"}`} />
    </motion.button>
  );
}

// ---------------------------------------------------------------------------------------------
// The airlock overlay
// ---------------------------------------------------------------------------------------------

function Airlock({ step, setStep }: { step: Step; setStep: (s: Step) => void }) {
  const navigate = useNavigate();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const passport = usePassport();
  const [error, setError] = useState<string>();
  const [checks, setChecks] = useState(0);

  // Close on Escape
  useEffect(() => {
    if (step === "closed") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStep("closed");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, setStep]);

  // The handshake checklist advances with the real reads, never faster than the animation.
  useEffect(() => {
    if (step !== "handshake") return;
    setChecks(0);
    const timers = [setTimeout(() => setChecks(1), 450), setTimeout(() => setChecks(2), 1100)];
    return () => timers.forEach(clearTimeout);
  }, [step]);
  useEffect(() => {
    if (step === "handshake" && checks >= 2 && passport.address && !passport.loading) {
      const t = setTimeout(() => {
        setChecks(3);
        setStep("passport");
      }, 650);
      return () => clearTimeout(t);
    }
  }, [step, checks, passport.address, passport.loading, setStep]);

  const wallets = dedupe(connectors);

  const pick = async (connector: Connector) => {
    setError(undefined);
    setStep("handshake");
    try {
      await connectAsync({ connector });
    } catch (err) {
      setStep("choose");
      const msg = err instanceof Error ? err.message : String(err);
      setError(/not (found|installed)|provider/i.test(msg) ? `${connector.name} is not installed in this browser.` : msg.split("\n")[0]);
    }
  };

  return (
    <AnimatePresence>
      {step !== "closed" && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-ink/80 px-4 py-10 backdrop-blur-xl"
          data-lenis-prevent
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          onClick={(e) => e.target === e.currentTarget && setStep("closed")}
          role="dialog"
          aria-modal="true"
          aria-label="Connect to Conclave"
        >
          <LatticeField className="absolute inset-0 h-full w-full" />
          <motion.div
            className="relative w-full max-w-3xl"
            initial={{ y: 40, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <button type="button" onClick={() => setStep("closed")} className="absolute -top-2 right-0 text-sm text-fog hover:text-white">
              Close · Esc
            </button>
            <AnimatePresence mode="wait">
              {step === "choose" && (
                <motion.section key="choose" {...fade}>
                  <p className="pill mb-5">Step 1 of 3 · Key holder</p>
                  <h2 className="text-4xl font-medium tracking-tight md:text-5xl">Choose the wallet that holds your post-quantum key.</h2>
                  <p className="mt-3 max-w-xl text-fog">Conclave never sees your keys. Your wallet signs a readable message with ML-DSA-87; the chain checks it.</p>
                  <div className="mt-8 grid gap-4 md:grid-cols-3">
                    {wallets.map((c, i) => (
                      <WalletTile key={c.uid} connector={c} featured={isQorex(c)} index={i} onPick={() => pick(c)} />
                    ))}
                  </div>
                  {error && <p className="mt-5 rounded-2xl border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</p>}
                  <button type="button" onClick={() => openConnectModal?.()} className="mt-6 text-sm text-fog underline-offset-4 hover:text-white hover:underline">
                    More wallets (RainbowKit)
                  </button>
                </motion.section>
              )}

              {step === "handshake" && (
                <motion.section key="handshake" {...fade} className="flex flex-col items-center py-10 text-center">
                  <Handshake />
                  <h2 className="mt-10 text-3xl font-medium tracking-tight">Reading your key from the chain</h2>
                  <ul className="mt-6 space-y-3 text-left text-[0.95rem]">
                    {["Account linked to Conclave", "Key registry · pqcKeyStatus (0x…0a02)", "Membership · isMember()"].map((label, i) => (
                      <motion.li key={label} className="flex items-center gap-3" initial={{ opacity: 0, x: -10 }} animate={{ opacity: checks >= i ? 1 : 0.35, x: 0 }} transition={{ delay: i * 0.1 }}>
                        <span className={`grid h-5 w-5 place-items-center rounded-full border text-[0.6rem] ${checks > i ? "border-mint bg-mint text-ink" : "border-white/30"}`}>
                          {checks > i ? "✓" : ""}
                        </span>
                        {label}
                      </motion.li>
                    ))}
                  </ul>
                </motion.section>
              )}

              {step === "passport" && (
                <motion.section key="passport" {...fade} className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
                  <motion.div initial={{ rotateY: 100, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} style={{ perspective: 1200 }}>
                    <PassportCard
                      data={{
                        address: passport.address,
                        walletName: passport.walletName,
                        mlDsa87: passport.key.mlDsa87,
                        keyBytes: passport.key.keyBytes,
                        pubkey: passport.key.pubkey,
                        isMember: passport.isMember,
                        isGuardian: passport.isGuardian,
                      }}
                    />
                  </motion.div>
                  <div>
                    <p className="pill mb-5">Step 3 of 3 · Passport issued</p>
                    <h2 className="text-3xl font-medium tracking-tight">
                      {passport.key.mlDsa87 ? (passport.isMember ? "Welcome back to the Conclave." : "Your key is quantum-safe.") : "This account has no post-quantum key yet."}
                    </h2>
                    <p className="mt-3 text-fog">
                      {passport.key.mlDsa87
                        ? passport.isMember
                          ? "You can propose and vote. Every signature you give is checked on chain by pqcVerify."
                          : "You are not a member, but you can follow the treasury, verify votes and execute passed proposals."
                        : "Register your ML-DSA-87 key in QoreX (Testnet) first: without it, nothing in Conclave can be signed in your name."}
                    </p>
                    <div className="mt-7 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setStep("closed");
                          navigate("/app");
                        }}
                      >
                        Enter Conclave →
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          disconnect();
                          setStep("closed");
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const fade = {
  initial: { opacity: 0, y: 16, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -12, filter: "blur(6px)" },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
};

function isQorex(c: Connector) {
  return /qorex/i.test(c.name) || c.id === "qorex" || c.id === "network.qore.qorex";
}

const walletConnectReady = appConfig.walletConnectProjectId !== "conclave-dev";

function dedupe(list: readonly Connector[]): Connector[] {
  const seen = new Set<string>();
  const out: Connector[] = [];
  const usable = list.filter((c) => walletConnectReady || !/walletconnect/i.test(c.id + c.name));
  for (const c of [...usable].sort((a, b) => Number(isQorex(b)) - Number(isQorex(a)))) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 3);
}

/** RainbowKit wallets carry their icon in `rkDetails.iconUrl` (a string or an async loader). */
function useConnectorIcon(connector: Connector): string | undefined {
  const [icon, setIcon] = useState<string | undefined>(connector.icon);
  useEffect(() => {
    const raw = (connector as unknown as { rkDetails?: { iconUrl?: string | (() => Promise<string>) } }).rkDetails?.iconUrl;
    if (typeof raw === "string") setIcon(raw);
    else if (typeof raw === "function") raw().then(setIcon, () => undefined);
  }, [connector]);
  return icon;
}

function WalletTile({ connector, featured, index, onPick }: { connector: Connector; featured: boolean; index: number; onPick: () => void }) {
  const icon = useConnectorIcon(connector);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(my, { stiffness: 200, damping: 18 });
  const ry = useSpring(mx, { stiffness: 200, damping: 18 });
  return (
    <motion.button
      type="button"
      onClick={onPick}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width - 0.5) * 16);
        my.set(-((e.clientY - r.top) / r.height - 0.5) * 16);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 800 }}
      className={`group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-[26px] border p-5 text-left md:aspect-[3/4] ${
        featured ? "border-violet/50 bg-gradient-to-br from-violet/30 via-panel to-mint/10" : "border-white/10 bg-panel"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white/10 text-lg font-semibold">
          {icon ? <img src={icon} alt="" className="h-8 w-8 rounded-lg" /> : connector.name.slice(0, 1)}
        </span>
        {featured && <span className="rounded-full bg-mint px-2.5 py-1 text-[0.65rem] font-semibold text-ink">ML-DSA-87</span>}
      </div>
      <div>
        <p className="text-xl font-medium">{connector.name === "Injected" ? "Browser wallet" : connector.name}</p>
        <p className="mt-1 text-sm text-fog">{featured ? "Signs votes with your post-quantum key" : "Classical wallet · read and execute"}</p>
      </div>
      <span className="absolute right-5 bottom-5 translate-x-2 opacity-0 transition-all duration-500 group-hover:translate-x-0 group-hover:opacity-100">→</span>
    </motion.button>
  );
}

function Handshake() {
  return (
    <div className="relative grid h-40 w-40 place-items-center">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border border-violet/60"
          initial={{ width: 160, height: 160, opacity: 0 }}
          animate={{ width: [160, 40], height: [160, 40], opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, delay: i * 0.5, repeat: Infinity, ease: "easeIn" }}
        />
      ))}
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
        <Mark size={56} />
      </motion.div>
    </div>
  );
}
