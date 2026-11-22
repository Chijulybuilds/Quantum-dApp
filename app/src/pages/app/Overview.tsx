import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatEther } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { AnimatedNumber } from "../../components/live/AnimatedNumber";
import { GuardianFuse } from "../../components/live/GuardianFuse";
import { LiveCard } from "../../components/live/LiveCard";
import { QuorumRing } from "../../components/live/QuorumRing";
import { RelayRoute } from "../../components/live/RelayRoute";
import { useConclaveAddress, useDao, usePassport, useRefreshAll, useRelayer } from "../../hooks/useConclave";
import { useNow } from "../../hooks/useNow";
import { conclaveAbi } from "../../lib/abi";
import { addressUrl } from "../../lib/config";
import { duration, short } from "../../lib/format";

const WINDOW_TXS = 40; // the relayer opens 40-transaction windows (server/src/keeper.ts)
const minutes = (s: number) => (s % 60 === 0 ? `${s / 60}-minute` : duration(s));

/** The four things that keep the treasury safe, one visual each. */
export function Overview() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <TreasuryCard />
      <MembersCard />
      <RelayerCard />
      <GuardianCard />
    </div>
  );
}

function Shell({ index, label, badge, visual, children, className = "" }: { index: number; label: string; badge?: ReactNode; visual: ReactNode; children: ReactNode; className?: string }) {
  return (
    <LiveCard index={index} className={`flex min-h-[320px] flex-col p-7 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fog">{label}</p>
        {badge}
      </div>
      <div className="grid flex-1 place-items-center py-7">{visual}</div>
      <div>{children}</div>
    </LiveCard>
  );
}

function Badge({ tone, children }: { tone: "mint" | "sun" | "ember" | "fog"; children: ReactNode }) {
  const cls = { mint: "bg-mint/12 text-mint", sun: "bg-sun/12 text-sun", ember: "bg-ember/15 text-ember", fog: "bg-white/5 text-fog" }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-xs ${cls}`}>{children}</span>;
}

function TreasuryCard() {
  const dao = useDao();
  const value = dao.data ? Number(formatEther(BigInt(dao.data.treasuryWei))) : 0;
  const previous = useRef<number>();
  const [gain, setGain] = useState<number>();

  useEffect(() => {
    if (!dao.data) return;
    if (previous.current !== undefined && value > previous.current) {
      setGain(value - previous.current);
      const t = setTimeout(() => setGain(undefined), 2600);
      previous.current = value;
      return () => clearTimeout(t);
    }
    previous.current = value;
  }, [dao.data, value]);

  return (
    <LiveCard index={0} className="flex min-h-[320px] flex-col p-7">
      <Wave className="text-violet/15" duration={9} />
      <Wave className="text-mint/[0.07]" duration={14} offset />
      <p className="text-sm text-fog">Treasury</p>
      <div className="relative flex flex-1 flex-col justify-center py-7">
        <p className="text-[clamp(2.75rem,4.2vw,3.75rem)] leading-none font-medium tracking-[-0.04em]">
          <AnimatedNumber value={value} decimals={2} />
          <span className="ml-2 text-lg tracking-normal text-fog">QOR</span>
        </p>
        <AnimatePresence>
          {gain !== undefined && (
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: -6 }}
              exit={{ opacity: 0, y: -24 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="absolute top-2 left-0 rounded-full bg-mint/15 px-2.5 py-1 text-xs text-mint"
            >
              +{gain.toLocaleString(undefined, { maximumFractionDigits: 4 })} QOR
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {dao.data && (
        <a href={addressUrl(dao.data.address)} target="_blank" rel="noreferrer" className="hash relative text-xs text-fog transition-colors hover:text-white">
          {short(dao.data.address, 8, 6)} ↗
        </a>
      )}
    </LiveCard>
  );
}

/** Two offset sine waves drifting along the bottom of the treasury card. */
function Wave({ className, duration: seconds, offset = false }: { className: string; duration: number; offset?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 100"
      preserveAspectRatio="none"
      className={`wave pointer-events-none absolute bottom-0 left-0 -z-10 h-20 w-[200%] ${className}`}
      style={{ animationDuration: `${seconds}s`, animationDirection: offset ? "reverse" : "normal" }}
    >
      <path fill="currentColor" d={offset ? "M0 60 Q100 30 200 60 T400 60 T600 60 T800 60 V100 H0Z" : "M0 50 Q100 80 200 50 T400 50 T600 50 T800 50 V100 H0Z"} />
    </svg>
  );
}

function MembersCard() {
  const dao = useDao();
  const passport = usePassport();
  const members = dao.data?.members ?? [];
  const keyed = members.filter((m) => m.mlDsa87).length;
  return (
    <Shell index={1} label="Members" visual={<QuorumRing members={members} threshold={dao.data?.threshold ?? 0} me={passport.address} />}>
      <p className="text-2xl font-medium">
        {members.length || "–"} members
      </p>
      <p className="mt-1 text-sm text-fog">
        {!members.length ? "Loading…" : keyed === members.length ? "Every one holds an ML-DSA-87 key" : `${members.length - keyed} without a post-quantum key`}
      </p>
    </Shell>
  );
}

function RelayerCard() {
  const relayer = useRelayer();
  const w = relayer.data?.window;
  const live = Boolean(w?.live);
  const txs = w ? Number(w.remainingTxs) : 0;
  return (
    <Shell
      index={2}
      label="Relayer"
      badge={<Badge tone={live && w?.scopedToConclave ? "mint" : "fog"}>{live ? (w?.scopedToConclave ? "Scoped" : "Open") : "Idle"}</Badge>}
      visual={<RelayRoute live={live} scoped={Boolean(w?.scopedToConclave)} />}
    >
      <p className="text-2xl font-medium">
        <AnimatedNumber value={live ? txs : 0} /> <span className="text-fog">txs left</span>
      </p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet to-mint"
          initial={{ width: 0 }}
          animate={{ width: `${live ? Math.min(100, (txs / WINDOW_TXS) * 100) : 0}%` }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <p className="mt-3 text-sm text-fog">{live ? "Pays the gas" : "Opens a window on demand"} · {relayer.data ? (Number(relayer.data.balanceUqor) / 1e6).toFixed(2) : "–"} QOR</p>
    </Shell>
  );
}

function GuardianCard() {
  const dao = useDao();
  const passport = usePassport();
  const conclave = useConclaveAddress();
  const refresh = useRefreshAll();
  const now = useNow();
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  useEffect(() => {
    if (receipt.isSuccess) refresh();
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseLength = Number(dao.data?.timing.pauseDuration ?? 1800);
  const left = Math.max(0, Number(dao.data?.pausedUntil ?? 0) - now);
  const state = dao.data?.paused ? "paused" : dao.data?.guardianArmed ? "armed" : "spent";

  return (
    <Shell
      index={3}
      label="Guardian"
      badge={dao.data && <Badge tone={state === "paused" ? "ember" : state === "armed" ? "sun" : "fog"}>{state === "paused" ? "Paused" : state === "armed" ? "Armed" : "Spent"}</Badge>}
      visual={<GuardianFuse state={state} remaining={left / pauseLength} />}
    >
      <p className="text-2xl font-medium">{state === "paused" ? duration(left) : state === "armed" ? "1 pause" : "Fuse spent"}</p>
      <p className="mt-1 text-sm text-fog">
        {state === "paused" ? "Payouts resume after this" : `A ${minutes(pauseLength)} brake. No other power.`}
      </p>
      {passport.isGuardian && conclave && (
        <button
          type="button"
          className="btn btn-ghost mt-4 w-full text-sm"
          disabled={state !== "armed" || isPending}
          onClick={() => writeContractAsync({ address: conclave, abi: conclaveAbi, functionName: "pause" })}
        >
          {isPending ? "Confirm in your wallet…" : "Pause payouts"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-ember">{error.message.split("\n")[0]}</p>}
    </Shell>
  );
}
