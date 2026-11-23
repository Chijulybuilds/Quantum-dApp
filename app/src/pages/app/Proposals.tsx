import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toEvmAddress } from "@qorechain/evm/window";
import { decodeFunctionData, encodeFunctionData, formatEther, getAddress, isAddress, keccak256, parseEther, toBytes, type Address, type Hex } from "viem";
import { useReadContract, useWriteContract } from "wagmi";

import { rise, trackPointer } from "../../components/live/motion";
import { SealConnect } from "../../components/SealConnect";
import { SealedCheck, SignAction } from "../../components/SignAction";
import { useAccountKind, useConclaveAddress, useDao, useHealth, usePassport, useProposals, useRefreshAll, useRelayer } from "../../hooks/useConclave";
import { useNow } from "../../hooks/useNow";
import { conclaveAbi, proxyAdminAbi } from "../../lib/abi";
import { api, type Proposal } from "../../lib/api";
import { PQC_KEY_STATUS, qorePqcAbi, txUrl } from "../../lib/config";
import { duration, nowSeconds, short } from "../../lib/format";
import { stateClass } from "../../lib/ui";

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

export function ProposalList({ onOpen, onCompose }: { onOpen: (id: string) => void; onCompose: () => void }) {
  const proposals = useProposals();
  const dao = useDao();
  if (proposals.isLoading) return <div className="card h-40 animate-pulse" />;
  if (!proposals.data?.length) return <EmptyProposals onCompose={onCompose} canCompose={Boolean(dao.data)} />;
  return (
    <div className="space-y-4">
      {proposals.data.map((p, i) => (
        <ProposalRow key={p.id} p={p} need={dao.data?.threshold ?? 2} index={i} onOpen={() => onOpen(p.id)} />
      ))}
    </div>
  );
}

const STEPS = ["A member proposes", "Members sign with ML-DSA-87", "Anyone executes after the timelock"];

/** Teaches the flow while there is nothing to show: the ring fills as the steps light up. */
function EmptyProposals({ onCompose, canCompose }: { onCompose: () => void; canCompose: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.div
      variants={rise}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true }}
      onPointerMove={trackPointer}
      className="card live-card flex flex-col items-center px-8 py-16 text-center"
    >
      <VoteRing forVotes={step} need={2} size={96} />
      <p className="mt-8 text-2xl font-medium">No proposals yet</p>
      <p className="mt-2 max-w-sm text-fog">Start the first one. It moves only when enough members sign it with their post-quantum keys.</p>
      <ol className="mt-10 flex flex-wrap justify-center gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`pill transition-all duration-700 ${i === step ? "border-violet/50 bg-violet/15 text-white" : "text-fog"}`}
          >
            <span className="hash text-xs text-mute">0{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-primary group mt-10" onClick={onCompose} disabled={!canCompose}>
        Create the first one <Plus />
      </button>
    </motion.div>
  );
}

export function Plus() {
  return (
    <span aria-hidden className="inline-block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-90">
      +
    </span>
  );
}

function ProposalRow({ p, need, index, onOpen }: { p: Proposal; need: number; index: number; onOpen: () => void }) {
  const conclave = useConclaveAddress();
  const dao = useDao();
  const actions = decodeActions(p, conclave, dao.data?.upgrades?.proxyAdmin);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      variants={rise}
      custom={index}
      initial="hidden"
      animate="show"
      whileHover={{ y: -3 }}
      onPointerMove={trackPointer}
      className="card live-card group flex w-full items-center gap-6 p-6 text-left sm:p-7"
    >
      <VoteRing forVotes={p.forVotes} need={need} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="hash text-xs text-mute">#{p.id}</span>
          <StateBadge state={p.state} />
        </div>
        <p className="mt-1.5 truncate text-lg">{p.description}</p>
        <p className="truncate text-sm text-fog">
          {actions.map((a) => a.detail).join(" · ")} · <Timing p={p} />
        </p>
        <PhaseBar p={p} />
      </div>
      <span className="-translate-x-2 text-xl text-fog opacity-0 transition-all duration-500 group-hover:translate-x-0 group-hover:opacity-100">→</span>
    </motion.button>
  );
}

function StateBadge({ state }: { state: string }) {
  const live = state === "Active" || state === "Ready";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] ${stateClass(state)}`}>
      {live && <span className="pulse-dot relative h-1.5 w-1.5 rounded-full bg-current" />}
      {state}
    </span>
  );
}

/** A ticking countdown for whatever the proposal is waiting on. */
function Timing({ p }: { p: Proposal }) {
  const now = useNow();
  if (p.state === "Active") return <span>voting ends in {duration(Number(p.voteEnd) - now)}</span>;
  if (p.state === "Queued") return <span>executable in {duration(Number(p.eta) - now)}</span>;
  if (p.state === "Ready") return <span className="text-mint">ready to execute</span>;
  return (
    <span>
      {p.forVotes} for · {p.againstVotes} against
    </span>
  );
}

/** How far through voting (violet) or the timelock (sun) the proposal is. */
function PhaseBar({ p }: { p: Proposal }) {
  const dao = useDao();
  const now = useNow();
  if (!dao.data || (p.state !== "Active" && p.state !== "Queued")) return null;
  const voting = p.state === "Active";
  const span = Number(voting ? dao.data.timing.votingPeriod : dao.data.timing.timelockDelay);
  const end = Number(voting ? p.voteEnd : p.eta);
  const done = Math.min(1, Math.max(0, 1 - (end - now) / Math.max(1, span)));
  return (
    <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/6">
      <motion.div
        className={`h-full rounded-full ${voting ? "bg-violet" : "bg-sun"}`}
        initial={{ width: 0 }}
        animate={{ width: `${done * 100}%` }}
        transition={{ duration: 1, ease: "linear" }}
      />
    </div>
  );
}

export function VoteRing({ forVotes, need, size = 56 }: { forVotes: number; need: number; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, forVotes / Math.max(1, need));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={4} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={pct >= 1 ? "#34f5c5" : "#7b5cff"}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct), stroke: pct >= 1 ? "#34f5c5" : "#7b5cff" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">
        {forVotes}/{need}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

interface DecodedAction {
  label: string;
  detail: string;
}

function decodeActions(p: Proposal, conclave?: Address, proxyAdmin?: Address): DecodedAction[] {
  return p.targets.map((target, i) => {
    const value = BigInt(p.values[i] ?? "0");
    const data = p.calldatas[i] ?? "0x";
    // Upgrades go through the ProxyAdmin, which only Conclave itself owns.
    if (proxyAdmin && target.toLowerCase() === proxyAdmin.toLowerCase() && data !== "0x") {
      try {
        const d = decodeFunctionData({ abi: proxyAdminAbi, data });
        if (d.functionName === "upgradeAndCall") {
          const [, implementation, migration] = d.args as [Address, Address, `0x${string}`];
          return { label: "Upgrade", detail: `implementation → ${short(implementation)}${migration !== "0x" ? " + migration" : ""}` };
        }
        if (d.functionName === "renounceOwnership") return { label: "Freeze", detail: "no further upgrades, ever" };
        if (d.functionName === "transferOwnership") return { label: "Upgrade rights", detail: `hand over → ${short(d.args[0] as Address)}` };
      } catch {
        /* fall through */
      }
    }
    if (conclave && target.toLowerCase() === conclave.toLowerCase() && data !== "0x") {
      try {
        const d = decodeFunctionData({ abi: conclaveAbi, data });
        if (d.functionName === "payERC20") {
          const [token, to, amount] = d.args as [Address, Address, bigint];
          return { label: "Pay token", detail: `${formatEther(amount)} of ${short(token)} → ${short(to)}` };
        }
        if (d.functionName === "addMember") return { label: "Add member", detail: short(d.args[0] as Address, 8, 6) };
        if (d.functionName === "removeMember") return { label: "Remove member", detail: short(d.args[0] as Address, 8, 6) };
        if (d.functionName === "setThreshold") return { label: "Votes needed", detail: `→ ${String(d.args[0])}` };
        if (d.functionName === "setGuardian") return { label: "Set guardian", detail: short(d.args[0] as Address, 8, 6) };
        if (d.functionName === "unpause") return { label: "Unpause", detail: "resume payouts" };
        return { label: d.functionName, detail: (d.args ?? []).map(String).join(", ") || "governance" };
      } catch {
        /* fall through */
      }
    }
    if (data === "0x") return { label: "Pay QOR", detail: `${formatEther(value)} QOR → ${short(target, 8, 6)}` };
    return { label: "Call", detail: `${short(target)} · ${data.slice(0, 10)}` };
  });
}

// ---------------------------------------------------------------------------------------------
// Drawers
// ---------------------------------------------------------------------------------------------

function Drawer({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-[80] flex justify-end bg-ink/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-ink-2 p-7 md:p-10"
        data-lenis-prevent
        role="dialog"
        aria-label={title}
      >
        <div className="mb-8 flex items-center justify-between">
          <h3 className="text-2xl font-medium tracking-tight">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-fog transition-colors hover:text-white">
            Close
          </button>
        </div>
        <div className="stagger space-y-8">{children}</div>
      </motion.aside>
    </motion.div>
  );
}

export function ProposalDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const proposals = useProposals();
  const dao = useDao();
  const health = useHealth();
  const passport = usePassport();
  const conclave = useConclaveAddress();
  const refresh = useRefreshAll();
  const now = useNow();
  const p = proposals.data?.find((x) => x.id === id);
  const [support, setSupport] = useState(true);

  const voteMessage = useReadContract({
    address: conclave,
    abi: conclaveAbi,
    functionName: "voteMessage",
    args: passport.address ? [BigInt(id), passport.address, support] : undefined,
    query: { enabled: Boolean(conclave && passport.address) },
  });
  const hasVoted = useReadContract({
    address: conclave,
    abi: conclaveAbi,
    functionName: "hasVoted",
    args: passport.address ? [BigInt(id), passport.address] : undefined,
    query: { enabled: Boolean(conclave && passport.address) },
  });
  const cancelMessage = useReadContract({
    address: conclave,
    abi: conclaveAbi,
    functionName: "cancelMessage",
    args: [BigInt(id)],
    query: { enabled: Boolean(conclave) },
  });

  const { writeContractAsync, isPending: walletPending } = useWriteContract();
  const [execState, setExecState] = useState<string>();

  if (!p)
    return (
      <Drawer title={`Proposal #${id}`} onClose={onClose}>
        <p className="text-fog">Loading…</p>
      </Drawer>
    );
  const actions = decodeActions(p, conclave, dao.data?.upgrades?.proxyAdmin);
  const need = dao.data?.threshold ?? 2;
  const canVote = p.state === "Active" && passport.isMember && passport.key.mlDsa87 && !hasVoted.data;
  const isProposer = passport.address?.toLowerCase() === p.proposer.toLowerCase();

  const executeViaRelayer = async () => {
    setExecState("Relaying…");
    try {
      const r = await api.relayExecute(p.id);
      setExecState(`Executed ✓ ${short(r.hash)}`);
      refresh();
    } catch (err) {
      setExecState(err instanceof Error ? err.message : String(err));
    }
  };
  const executeFromWallet = async () => {
    if (!conclave) return;
    setExecState("Confirm in your wallet…");
    try {
      const hash = await writeContractAsync({
        address: conclave,
        abi: conclaveAbi,
        functionName: "execute",
        args: [BigInt(p.id), p.targets, p.values.map(BigInt), p.calldatas, keccak256(toBytes(p.description))],
      });
      setExecState(`Sent ${short(hash)} ✓`);
      setTimeout(refresh, 4000);
    } catch (err) {
      setExecState(err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  };

  return (
    <Drawer title={`Proposal #${p.id}`} onClose={onClose}>
      <div className="flex items-center gap-5">
        <VoteRing forVotes={p.forVotes} need={need} size={80} />
        <div>
          <StateBadge state={p.state} />
          <p className="mt-2 text-xl">{p.description}</p>
          <p className="text-sm text-fog">
            by <span className="hash">{short(p.proposer)}</span> ·{" "}
            {p.state === "Active"
              ? `voting ends in ${duration(Number(p.voteEnd) - now)}`
              : p.state === "Queued"
                ? `executable in ${duration(Number(p.eta) - now)}`
                : `${p.forVotes} for · ${p.againstVotes} against`}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        {actions.map((a, i) => (
          <div key={i} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 px-4 py-3 text-sm">
            <span className="text-fog">{a.label}</span>
            <span className="hash truncate">{a.detail}</span>
          </div>
        ))}
        <p className="hash truncate pt-1 text-[0.7rem] text-mute">proposal hash {p.proposalHash}</p>
      </section>

      <section>
        <p className="mb-3 text-sm text-fog">Votes</p>
        {p.votes.length === 0 && <p className="text-sm text-mute">No votes yet.</p>}
        <ul className="space-y-2">
          {p.votes.map((v, i) => (
            <motion.li
              key={v.voter}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
              className="flex items-center justify-between text-sm"
            >
              <span className="hash">{short(v.voter, 8, 6)}</span>
              <a href={txUrl(v.tx)} target="_blank" rel="noreferrer" className={v.support ? "text-mint" : "text-ember"}>
                {v.support ? "FOR" : "AGAINST"} · ML-DSA-87 ✓
              </a>
            </motion.li>
          ))}
        </ul>
      </section>

      {p.state === "Active" && (
        <section>
          <p className="mb-3 text-sm text-fog">Your vote</p>
          {!passport.isConnected && <SealConnect />}
          {passport.isConnected && !passport.isMember && <p className="text-sm text-fog">Only members can vote. You can still follow and execute.</p>}
          {passport.isMember && hasVoted.data && <p className="text-sm text-mint">You voted on this proposal.</p>}
          {canVote && (
            <>
              <div className="relative mb-4 grid grid-cols-2 rounded-full bg-white/5 p-1">
                {[true, false].map((s) => (
                  <button
                    key={String(s)}
                    type="button"
                    onClick={() => setSupport(s)}
                    className={`relative rounded-full py-2.5 text-sm transition-colors duration-300 ${support === s ? (s ? "text-ink" : "text-white") : "text-fog hover:text-white"}`}
                  >
                    {support === s && (
                      <motion.span
                        layoutId="vote-pill"
                        className={`absolute inset-0 rounded-full ${s ? "bg-mint" : "bg-ember"}`}
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{s ? "For" : "Against"}</span>
                  </button>
                ))}
              </div>
              <SignAction
                message={voteMessage.data}
                signer={passport.address}
                label={support ? "Vote FOR" : "Vote AGAINST"}
                submit={(signature) => api.relayVote({ proposalId: p.id, voter: passport.address!, support, signature })}
                onDone={() => setTimeout(refresh, 600)}
              />
            </>
          )}
        </section>
      )}

      {p.state === "Ready" && (
        <section className="space-y-3">
          <p className="text-sm text-fog">Passed and past its timelock. Anyone may execute it: the content is fixed by its hash.</p>
          <button type="button" className="btn btn-primary w-full" onClick={executeViaRelayer}>
            Execute via relayer
          </button>
          {passport.isConnected && !/qorex/i.test(passport.walletName ?? "") && (
            <button type="button" className="btn btn-ghost w-full" onClick={executeFromWallet} disabled={walletPending}>
              Execute from my wallet (needs an EVM window)
            </button>
          )}
          {execState && <p className="text-sm text-fog">{execState}</p>}
        </section>
      )}

      {isProposer && ["Active", "Queued", "Ready"].includes(p.state) && (
        <section>
          <p className="mb-3 text-sm text-fog">Cancel your proposal</p>
          <SignAction
            message={cancelMessage.data}
            signer={passport.address}
            label="Cancel proposal"
            submit={(signature) => api.relayCancel({ proposalId: p.id, signature })}
            onDone={() => setTimeout(refresh, 600)}
          />
        </section>
      )}

      {health.data?.demoMode && p.state === "Active" && <DemoVotes id={p.id} onDone={refresh} />}
    </Drawer>
  );
}

function DemoVotes({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  const vote = async (member: "A" | "B", support: boolean) => {
    setBusy(member + support);
    setNote(undefined);
    try {
      const r = await api.demoVote({ proposalId: id, member, support });
      setNote(`Demo member ${member} voted ${support ? "FOR" : "AGAINST"} · ${short(r.hash)}`);
      onDone();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section className="rounded-2xl border border-dashed border-white/15 p-5">
      <p className="text-sm text-fog">Testnet demo · the two demo members' ML-DSA-87 keys live in the relayer</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["A", "B"] as const).map((m) => (
          <button key={m} type="button" className="btn btn-ghost text-sm" disabled={Boolean(busy)} onClick={() => vote(m, true)}>
            {busy === m + "true" ? "Signing…" : `Demo ${m} votes FOR`}
          </button>
        ))}
      </div>
      {note && <p className="mt-2 text-xs text-fog">{note}</p>}
    </section>
  );
}

type Kind = "payout" | "add" | "remove";
interface Actions {
  targets: Address[];
  values: string[];
  calldatas: Hex[];
  description: string;
}

const KINDS: { id: Kind; label: string }[] = [
  { id: "payout", label: "Payout" },
  { id: "add", label: "Add member" },
  { id: "remove", label: "Remove member" },
];

/** The smallest strict majority of `count` members. */
const majority = (count: number) => Math.floor(count / 2) + 1;
/** Votes needed once the member count changes: the current number if it is still a strict majority. */
const thresholdFor = (current: number, count: number) => (current >= 1 && current <= count && current * 2 > count ? current : majority(count));

/** A 0x… or qor1… account as a checksummed 0x address. */
function parseAccount(raw: string): Address | undefined {
  const s = raw.trim();
  try {
    if (/^qor1[02-9ac-hj-np-z]{38}$/.test(s)) return getAddress(toEvmAddress(s));
    if (isAddress(s, { strict: false })) return getAddress(s);
  } catch {
    /* not an address */
  }
  return undefined;
}

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function ComposeDrawer({ onClose }: { onClose: () => void }) {
  const passport = usePassport();
  const health = useHealth();
  const dao = useDao();
  const relayer = useRelayer();
  const conclave = useConclaveAddress();
  const refresh = useRefreshAll();
  const [kind, setKind] = useState<Kind>("payout");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [account, setAccount] = useState("");
  const [removing, setRemoving] = useState<Address>();
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<{ message: string; deadline: string; actions: Actions }>();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();

  // Any change to the proposal invalidates a prepared message.
  useEffect(() => {
    setDraft(undefined);
    setError(undefined);
  }, [kind, to, amount, account, removing, description]);

  const members = dao.data?.members ?? [];
  const current = dao.data?.threshold ?? 0;
  const candidate = kind === "add" ? parseAccount(account) : undefined;
  const key = useReadContract({
    address: PQC_KEY_STATUS,
    abi: qorePqcAbi,
    functionName: "pqcKeyStatus",
    args: candidate ? [candidate] : undefined,
    query: { enabled: Boolean(candidate) },
  });
  const [registered, algorithmId, pubkey] = (key.data ?? [false, 0, "0x"]) as readonly [boolean, number, Hex];
  const candidateHasKey = registered && algorithmId === 1 && (pubkey.length - 2) / 2 === 2592;
  const candidateIsMember = members.some((m) => same(m.address, candidate));
  const candidateIsRelayer = same(candidate, relayer.data?.address);
  const candidateKind = useAccountKind(candidate);

  /** The actions this proposal will run, or why it cannot be proposed yet. */
  const plan = useMemo((): { actions?: Actions; summary?: string } => {
    if (kind === "payout") {
      const recipient = parseAccount(to);
      const ok = recipient && /^\d+(\.\d{1,18})?$/.test(amount) && Number(amount) > 0 && description.trim().length > 2;
      if (!ok) return {};
      return {
        actions: { targets: [recipient], values: [parseEther(amount).toString()], calldatas: ["0x"], description: description.trim() },
      };
    }
    if (!conclave || !members.length) return {};
    const count = kind === "add" ? members.length + 1 : members.length - 1;
    const target = kind === "add" ? candidate : removing;
    if (!target || count < 1) return {};
    if (kind === "add" && (candidateIsMember || !candidateHasKey || candidateKind === "ethereum")) return {};
    const next = thresholdFor(current, count);
    const calldatas: Hex[] = [
      kind === "add"
        ? encodeFunctionData({ abi: conclaveAbi, functionName: "addMember", args: [target] })
        : encodeFunctionData({ abi: conclaveAbi, functionName: "removeMember", args: [target] }),
    ];
    // Conclave checks after all actions that the threshold is a strict majority, so change it in the same proposal.
    if (next !== current) calldatas.push(encodeFunctionData({ abi: conclaveAbi, functionName: "setThreshold", args: [next] }));
    const summary = `${next} of ${count} votes to pass`;
    return {
      summary,
      actions: {
        targets: calldatas.map(() => conclave),
        values: calldatas.map(() => "0"),
        calldatas,
        description: description.trim() || `${kind === "add" ? "Add" : "Remove"} member ${target} (${summary})`,
      },
    };
  }, [kind, to, amount, description, conclave, members, current, candidate, removing, candidateIsMember, candidateHasKey, candidateKind]);

  const prepare = async () => {
    setError(undefined);
    if (!passport.address || !plan.actions) return;
    try {
      const deadline = String(nowSeconds() + 3600);
      const { message } = await api.proposeMessage({ proposer: passport.address, ...plan.actions, deadline });
      setDraft({ message, deadline, actions: plan.actions });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const demoPropose = async (member: "A" | "B") => {
    setError(undefined);
    const recipient = parseAccount(to);
    if (!recipient) return;
    try {
      const r = await api.demoPropose({ member, to: recipient, amount, description: description.trim() });
      setCreated(r.proposalId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const field = "mt-2 w-full rounded-2xl border border-white/10 bg-ink px-4 py-3.5 text-sm outline-none transition-colors focus:border-violet";

  return (
    <Drawer title="New proposal" onClose={onClose}>
      {created ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-4 rounded-2xl border border-mint/40 bg-mint/10 p-6">
          <SealedCheck />
          <div>
            <p className="text-lg text-mint">Proposal #{created} created</p>
            <p className="mt-1 text-sm text-fog">It is now collecting post-quantum votes.</p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-5">
          <div className="relative grid grid-cols-3 rounded-full bg-white/5 p-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`relative rounded-full py-2.5 text-sm transition-colors duration-300 ${kind === k.id ? "text-ink" : "text-fog hover:text-white"}`}
              >
                {kind === k.id && <motion.span layoutId="compose-kind" className="absolute inset-0 rounded-full bg-white" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative">{k.label}</span>
              </button>
            ))}
          </div>

          {kind === "payout" && (
            <>
              <label className="block">
                <span className="text-sm text-fog">Recipient (0x… or qor1…)</span>
                <input value={to} onChange={(e) => setTo(e.target.value.trim())} className={`hash ${field}`} placeholder="0x…" />
              </label>
              <label className="block">
                <span className="text-sm text-fog">Amount (QOR)</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" className={field} />
              </label>
            </>
          )}

          {kind === "add" && (
            <div>
              <label className="block">
                <span className="text-sm text-fog">New member (0x… or qor1…)</span>
                <input value={account} onChange={(e) => setAccount(e.target.value.trim())} className={`hash ${field}`} placeholder="0x… or qor1…" />
              </label>
              <div className="mt-2 text-sm">
                {!account ? (
                  <p className="text-mute">They must already have an ML-DSA-87 key registered on QoreChain.</p>
                ) : !candidate ? (
                  <p className="text-ember">Not a valid 0x or qor1 address.</p>
                ) : key.isLoading ? (
                  <p className="text-fog">Checking their post-quantum key…</p>
                ) : candidateIsMember ? (
                  <p className="text-fog">Already a member.</p>
                ) : !candidateHasKey ? (
                  <p className="text-ember">
                    No ML-DSA-87 key registered for this account yet. Its owner must register one first (QoreX does it), because a member who
                    cannot sign could block every vote.
                  </p>
                ) : candidateKind === "ethereum" ? (
                  <p className="text-ember">
                    This account was imported from an Ethereum wallet (such as MetaMask). QoreX can't sign Conclave messages with it, so
                    as a member it could never vote. Add an account created in QoreX instead.
                  </p>
                ) : (
                  <p className="text-mint">ML-DSA-87 key registered ✓{candidateKind === "cosmos" ? " · QoreX account ✓" : ""}</p>
                )}
                {candidateIsRelayer && (
                  <p className="mt-2 rounded-xl border border-ember/40 bg-ember/10 px-3 py-2 text-ember">
                    This is the relayer. Its keys live on the server with the two demo members', so the server alone would hold a majority. Not
                    recommended.
                  </p>
                )}
              </div>
            </div>
          )}

          {kind === "remove" && (
            <div>
              <p className="text-sm text-fog">Member to remove</p>
              <div className="mt-2 space-y-2">
                {members.map((m) => (
                  <button
                    key={m.address}
                    type="button"
                    onClick={() => setRemoving(m.address)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                      same(removing, m.address) ? "border-ember/60 bg-ember/10" : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    <span className="hash">{short(m.address, 10, 8)}</span>
                    {same(m.address, passport.address) && <span className="text-xs text-fog">you</span>}
                  </button>
                ))}
              </div>
              {members.length <= 1 && <p className="mt-2 text-sm text-ember">The last member cannot be removed.</p>}
            </div>
          )}

          {plan.summary && (
            <p className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-fog">
              After this: <span className="text-white">{plan.summary}</span>. Open proposals become Stale when membership changes.
            </p>
          )}

          <label className="block">
            <span className="text-sm text-fog">{kind === "payout" ? "What is it for?" : "Note (optional)"}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className={field}
              placeholder={kind === "payout" ? "Grant for …" : "Why this change"}
            />
          </label>

          {!draft && passport.isMember && passport.key.mlDsa87 && (
            <button type="button" className="btn btn-violet w-full" disabled={!plan.actions} onClick={prepare}>
              Prepare the message to sign
            </button>
          )}
          {!passport.isMember && <p className="text-sm text-fog">Only members can propose{passport.isConnected ? "" : ": connect first"}.</p>}

          {draft && (
            <SignAction
              message={draft.message}
              signer={passport.address}
              label="Propose"
              submit={(signature) => api.relayPropose({ proposer: passport.address!, ...draft.actions, deadline: draft.deadline, signature })}
              onDone={(r) => {
                setCreated(r.proposalId);
                refresh();
              }}
            />
          )}

          {health.data?.demoMode && kind === "payout" && (
            <div className="rounded-2xl border border-dashed border-white/15 p-5">
              <p className="text-sm text-fog">Testnet demo · let a demo member propose it</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-ghost text-sm" disabled={!plan.actions} onClick={() => demoPropose("A")}>
                  Demo A proposes
                </button>
                <button type="button" className="btn btn-ghost text-sm" disabled={!plan.actions} onClick={() => demoPropose("B")}>
                  Demo B proposes
                </button>
              </div>
            </div>
          )}
          {error && <p className="rounded-xl border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}
