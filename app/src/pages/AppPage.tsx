import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { decodeFunctionData, formatEther, getAddress, isAddress, keccak256, parseEther, toBytes, type Address } from "viem";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { stateClass } from "../components/HeroDevice";
import { PassportCard } from "../components/PassportCard";
import { SealConnect } from "../components/SealConnect";
import { SignAction } from "../components/SignAction";
import { useActivity, useConclaveAddress, useDao, useHealth, usePassport, useProposals, useRefreshAll, useRelayer } from "../hooks/useConclave";
import { conclaveAbi } from "../lib/abi";
import { api, type Proposal } from "../lib/api";
import { addressUrl, appConfig, txUrl } from "../lib/config";
import { duration, nowSeconds, qor, short } from "../lib/format";

export function AppPage() {
  const passport = usePassport();
  const dao = useDao();
  const proposals = useProposals();
  const health = useHealth();
  const [selected, setSelected] = useState<string>();
  const [composing, setComposing] = useState(false);

  return (
    <main className="spotlight min-h-screen px-4 pt-28 pb-20">
      <div className="mx-auto max-w-6xl">
        {health.isError && (
          <p className="mb-6 rounded-2xl border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-ember">
            The Conclave relayer is offline. Start it with <span className="hash">cd server && npm run dev</span>.
          </p>
        )}
        {health.data && !health.data.deployed && (
          <p className="mb-6 rounded-2xl border border-sun/40 bg-sun/10 px-4 py-3 text-sm text-sun">
            Conclave is not deployed yet. Fund the relayer, then run <span className="hash">cd server && npm run setup:testnet</span>.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[440px_1fr]">
          <div className="card flex flex-col items-center justify-center gap-5 p-6">
            {passport.isConnected ? (
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
            ) : (
              <div className="py-10 text-center">
                <p className="text-2xl font-medium">Connect to get your Q-Passport</p>
                <p className="mx-auto mt-2 max-w-xs text-fog">Members sign with QoreX. Anyone can follow the treasury and execute passed proposals.</p>
                <div className="mt-6 flex justify-center">
                  <SealConnect />
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TreasuryCard />
            <RelayerCard />
            <MembersCard />
            <GuardianCard />
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-fog">Proposals</p>
            <h2 className="text-4xl font-medium tracking-[-0.03em]">Every one signed with ML-DSA-87</h2>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setComposing(true)} disabled={!dao.data}>
            New proposal +
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {proposals.data?.length === 0 && <div className="card p-10 text-center text-fog">No proposals yet. Create the first one.</div>}
            {proposals.data?.map((p, i) => (
              <ProposalRow key={p.id} p={p} need={dao.data?.threshold ?? 2} index={i} onOpen={() => setSelected(p.id)} />
            ))}
          </div>
          <ActivityFeed />
        </div>
      </div>

      <AnimatePresence>
        {selected && <ProposalDrawer id={selected} onClose={() => setSelected(undefined)} />}
        {composing && <ComposeDrawer onClose={() => setComposing(false)} />}
      </AnimatePresence>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Overview cards
// ---------------------------------------------------------------------------------------------

function TreasuryCard() {
  const dao = useDao();
  return (
    <div className="card p-6">
      <p className="text-sm text-fog">Treasury</p>
      <p className="mt-2 text-5xl font-medium tracking-tight">
        {qor(dao.data?.treasuryWei)} <span className="text-lg text-fog">QOR</span>
      </p>
      {dao.data && (
        <a href={addressUrl(dao.data.address)} target="_blank" rel="noreferrer" className="hash mt-4 block truncate text-xs text-mute hover:text-white">
          {dao.data.address}
        </a>
      )}
    </div>
  );
}

function RelayerCard() {
  const relayer = useRelayer();
  const w = relayer.data?.window;
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fog">Relayer window</p>
        <span className={`rounded-full px-2.5 py-1 text-xs ${w?.live && w.scopedToConclave ? "bg-mint/15 text-mint" : "bg-white/5 text-fog"}`}>
          {w?.live ? (w.scopedToConclave ? "Scoped to Conclave" : "Open") : "Opens on demand"}
        </span>
      </div>
      <p className="mt-3 text-sm text-white/80">The relayer pays gas. It can only reach Conclave, and Conclave ignores who sends.</p>
      <p className="mt-3 text-xs text-fog">
        {w ? `${w.remainingTxs} txs · ${(Number(w.remainingValueUqor) / 1e6).toFixed(2)} QOR left` : "—"} · balance {relayer.data ? (Number(relayer.data.balanceUqor) / 1e6).toFixed(2) : "—"} QOR
      </p>
    </div>
  );
}

function MembersCard() {
  const dao = useDao();
  return (
    <div className="card p-6">
      <p className="text-sm text-fog">
        Members · {dao.data?.threshold ?? "–"} of {dao.data?.members.length ?? "–"} to pass
      </p>
      <ul className="mt-3 space-y-2">
        {dao.data?.members.map((m) => (
          <li key={m.address} className="flex items-center justify-between text-sm">
            <span className="hash">{short(m.address, 8, 6)}</span>
            <span className={m.mlDsa87 ? "text-xs text-mint" : "text-xs text-ember"}>{m.mlDsa87 ? "ML-DSA-87 ✓" : "no PQ key"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuardianCard() {
  const dao = useDao();
  const passport = usePassport();
  const conclave = useConclaveAddress();
  const refresh = useRefreshAll();
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  useEffect(() => {
    if (receipt.isSuccess) refresh();
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const until = Number(dao.data?.pausedUntil ?? 0);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fog">Guardian fuse</p>
        <span className={`rounded-full px-2.5 py-1 text-xs ${dao.data?.paused ? "bg-ember/15 text-ember" : dao.data?.guardianArmed ? "bg-sun/15 text-sun" : "bg-white/5 text-fog"}`}>
          {!dao.data ? "—" : dao.data.paused ? `Paused · ${duration(until - nowSeconds())}` : dao.data.guardianArmed ? "Armed" : "Spent"}
        </span>
      </div>
      <p className="mt-3 text-sm text-white/80">The only classical-key power in Conclave: one pause, shorter than the grace period.</p>
      {passport.isGuardian && conclave && (
        <button
          type="button"
          className="btn btn-ghost mt-4 w-full"
          disabled={!dao.data?.guardianArmed || isPending}
          onClick={() => writeContractAsync({ address: conclave, abi: conclaveAbi, functionName: "pause" })}
        >
          {isPending ? "Confirm in your wallet…" : "Pause payouts (guardian)"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-ember">{error.message.split("\n")[0]}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

interface DecodedAction {
  label: string;
  detail: string;
}

function decodeActions(p: Proposal, conclave?: Address): DecodedAction[] {
  return p.targets.map((target, i) => {
    const value = BigInt(p.values[i] ?? "0");
    const data = p.calldatas[i] ?? "0x";
    if (conclave && target.toLowerCase() === conclave.toLowerCase() && data !== "0x") {
      try {
        const d = decodeFunctionData({ abi: conclaveAbi, data });
        if (d.functionName === "payERC20") {
          const [token, to, amount] = d.args as [Address, Address, bigint];
          return { label: "Pay token", detail: `${formatEther(amount)} of ${short(token)} → ${short(to)}` };
        }
        return { label: d.functionName, detail: (d.args ?? []).map(String).join(", ") || "governance" };
      } catch {
        /* fall through */
      }
    }
    if (data === "0x") return { label: "Pay QOR", detail: `${formatEther(value)} QOR → ${short(target, 8, 6)}` };
    return { label: "Call", detail: `${short(target)} · ${data.slice(0, 10)}` };
  });
}

function ProposalRow({ p, need, index, onOpen }: { p: Proposal; need: number; index: number; onOpen: () => void }) {
  const conclave = useConclaveAddress();
  const actions = decodeActions(p, conclave);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="card card-hover group flex w-full items-center gap-5 p-5 text-left"
    >
      <VoteRing forVotes={p.forVotes} need={need} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="hash text-xs text-mute">#{p.id}</span>
          <span className={`rounded-full px-2 py-0.5 text-[0.7rem] ${stateClass(p.state)}`}>{p.state}</span>
        </div>
        <p className="mt-1 truncate text-lg">{p.description}</p>
        <p className="truncate text-sm text-fog">{actions.map((a) => a.detail).join(" · ")}</p>
      </div>
      <span className="translate-x-[-6px] text-fog opacity-0 transition-all duration-500 group-hover:translate-x-0 group-hover:opacity-100">→</span>
    </motion.button>
  );
}

function VoteRing({ forVotes, need, size = 52 }: { forVotes: number; need: number; size?: number }) {
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
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold">
        {forVotes}/{need}
      </span>
    </div>
  );
}

function Drawer({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <motion.div className="fixed inset-0 z-[80] flex justify-end bg-ink/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-ink-2 p-6 md:p-8"
        role="dialog"
        aria-label={title}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-2xl font-medium tracking-tight">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-fog hover:text-white">
            Close
          </button>
        </div>
        {children}
      </motion.aside>
    </motion.div>
  );
}

function ProposalDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const proposals = useProposals();
  const dao = useDao();
  const health = useHealth();
  const passport = usePassport();
  const conclave = useConclaveAddress();
  const refresh = useRefreshAll();
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

  if (!p) return <Drawer title={`Proposal #${id}`} onClose={onClose}>Loading…</Drawer>;
  const actions = decodeActions(p, conclave);
  const need = dao.data?.threshold ?? 2;
  const now = nowSeconds();
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
      <div className="flex items-center gap-4">
        <VoteRing forVotes={p.forVotes} need={need} size={72} />
        <div>
          <span className={`rounded-full px-2.5 py-1 text-xs ${stateClass(p.state)}`}>{p.state}</span>
          <p className="mt-2 text-xl">{p.description}</p>
          <p className="text-sm text-fog">
            by <span className="hash">{short(p.proposer)}</span> ·{" "}
            {p.state === "Active" ? `voting ends in ${duration(Number(p.voteEnd) - now)}` : p.state === "Queued" ? `executable in ${duration(Number(p.eta) - now)}` : `${p.forVotes} for · ${p.againstVotes} against`}
          </p>
        </div>
      </div>

      <section className="mt-6 space-y-2">
        {actions.map((a, i) => (
          <div key={i} className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 text-sm">
            <span className="text-fog">{a.label}</span>
            <span className="hash">{a.detail}</span>
          </div>
        ))}
        <p className="hash truncate pt-1 text-[0.7rem] text-mute">proposal hash {p.proposalHash}</p>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-sm text-fog">Votes</p>
        {p.votes.length === 0 && <p className="text-sm text-mute">No votes yet.</p>}
        <ul className="space-y-2">
          {p.votes.map((v) => (
            <li key={v.voter} className="flex items-center justify-between text-sm">
              <span className="hash">{short(v.voter, 8, 6)}</span>
              <a href={txUrl(v.tx)} target="_blank" rel="noreferrer" className={v.support ? "text-mint" : "text-ember"}>
                {v.support ? "FOR" : "AGAINST"} · ML-DSA-87 ✓
              </a>
            </li>
          ))}
        </ul>
      </section>

      {p.state === "Active" && (
        <section className="mt-8">
          <p className="mb-3 text-sm text-fog">Your vote</p>
          {!passport.isConnected && <SealConnect />}
          {passport.isConnected && !passport.isMember && <p className="text-sm text-fog">Only members can vote. You can still follow and execute.</p>}
          {passport.isMember && hasVoted.data && <p className="text-sm text-mint">You voted on this proposal.</p>}
          {canVote && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-full bg-white/5 p-1">
                {[true, false].map((s) => (
                  <button key={String(s)} type="button" onClick={() => setSupport(s)} className={`rounded-full py-2 text-sm transition-colors ${support === s ? (s ? "bg-mint text-ink" : "bg-ember text-white") : "text-fog"}`}>
                    {s ? "For" : "Against"}
                  </button>
                ))}
              </div>
              <SignAction
                message={voteMessage.data}
                signer={passport.address}
                label={support ? "Vote FOR" : "Vote AGAINST"}
                cliCommand={`cd contracts && npm run conclave sign-vote ${p.id} ${support ? "for" : "against"}`}
                submit={(signature) => api.relayVote({ proposalId: p.id, voter: passport.address!, support, signature })}
                onDone={() => setTimeout(refresh, 600)}
              />
            </>
          )}
        </section>
      )}

      {p.state === "Ready" && (
        <section className="mt-8 space-y-3">
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
        <section className="mt-8">
          <p className="mb-3 text-sm text-fog">Cancel your proposal</p>
          <SignAction
            message={cancelMessage.data}
            signer={passport.address}
            label="Cancel proposal"
            cliCommand={`cd contracts && npm run conclave cancel ${p.id}`}
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
    <section className="mt-8 rounded-2xl border border-dashed border-white/15 p-4">
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

// ---------------------------------------------------------------------------------------------
// New proposal
// ---------------------------------------------------------------------------------------------

function ComposeDrawer({ onClose }: { onClose: () => void }) {
  const passport = usePassport();
  const health = useHealth();
  const refresh = useRefreshAll();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<{ message: string; deadline: string; to: Address; value: string }>();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();

  const valid = useMemo(() => isAddress(to, { strict: false }) && /^\d+(\.\d{1,18})?$/.test(amount) && Number(amount) > 0 && description.trim().length > 2, [to, amount, description]);

  const prepare = async () => {
    setError(undefined);
    if (!passport.address) return;
    try {
      const recipient = getAddress(to) as Address;
      const value = parseEther(amount).toString();
      const deadline = String(nowSeconds() + 3600);
      const { message } = await api.proposeMessage({ proposer: passport.address, targets: [recipient], values: [value], calldatas: ["0x"], description: description.trim(), deadline });
      setDraft({ message, deadline, to: recipient, value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const demoPropose = async (member: "A" | "B") => {
    setError(undefined);
    try {
      const r = await api.demoPropose({ member, to: getAddress(to) as Address, amount, description: description.trim() });
      setCreated(r.proposalId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Drawer title="New payout proposal" onClose={onClose}>
      {created ? (
        <div className="rounded-2xl border border-mint/40 bg-mint/10 p-5">
          <p className="text-lg text-mint">Proposal #{created} created ✓</p>
          <p className="mt-1 text-sm text-fog">It is now collecting post-quantum votes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm text-fog">Recipient (0x…)</span>
            <input value={to} onChange={(e) => setTo(e.target.value.trim())} className="hash mt-1 w-full rounded-xl border border-white/10 bg-ink px-4 py-3 text-sm outline-none focus:border-violet" placeholder="0x…" />
          </label>
          <label className="block">
            <span className="text-sm text-fog">Amount (QOR)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.trim())} inputMode="decimal" className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-4 py-3 text-sm outline-none focus:border-violet" />
          </label>
          <label className="block">
            <span className="text-sm text-fog">What is it for?</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-xl border border-white/10 bg-ink px-4 py-3 text-sm outline-none focus:border-violet" placeholder="Grant for …" />
          </label>

          {!draft && passport.isMember && passport.key.mlDsa87 && (
            <button type="button" className="btn btn-violet w-full" disabled={!valid} onClick={prepare}>
              Prepare the message to sign
            </button>
          )}
          {!passport.isMember && <p className="text-sm text-fog">Only members can propose{passport.isConnected ? "" : ": connect first"}.</p>}

          {draft && (
            <SignAction
              message={draft.message}
              signer={passport.address}
              label="Propose"
              cliCommand={`cd contracts && npm run conclave propose-payout ${draft.to} ${amount} "${description.trim()}"`}
              submit={(signature) =>
                api.relayPropose({ proposer: passport.address!, targets: [draft.to], values: [draft.value], calldatas: ["0x"], description: description.trim(), deadline: draft.deadline, signature })
              }
              onDone={(r) => {
                setCreated(r.proposalId);
                refresh();
              }}
            />
          )}

          {health.data?.demoMode && (
            <div className="rounded-2xl border border-dashed border-white/15 p-4">
              <p className="text-sm text-fog">Testnet demo · let a demo member propose it</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-ghost text-sm" disabled={!valid} onClick={() => demoPropose("A")}>
                  Demo A proposes
                </button>
                <button type="button" className="btn btn-ghost text-sm" disabled={!valid} onClick={() => demoPropose("B")}>
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

// ---------------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------------

const ACTIVITY_LABEL: Record<string, string> = {
  ProposalCreated: "proposed",
  VoteCast: "voted",
  ProposalQueued: "queued",
  ProposalExecuted: "executed",
  ProposalCanceled: "canceled",
  Deposited: "deposit",
  Paused: "paused",
  Unpaused: "unpaused",
  MemberAdded: "member added",
  MemberRemoved: "member removed",
  ThresholdChanged: "threshold",
  GuardianChanged: "guardian",
  EpochAdvanced: "epoch",
  TokenPaid: "token paid",
};

function ActivityFeed() {
  const activity = useActivity();
  return (
    <aside className="card h-fit p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fog">Live activity</p>
        <span className="relative h-1.5 w-1.5 rounded-full bg-mint pulse-dot text-mint" />
      </div>
      <ul className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {activity.data?.slice(0, 12).map((a) => (
            <motion.li key={a.tx + a.type + (a.actor ?? "")} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">
                {a.proposalId && <span className="hash text-mute">#{a.proposalId} </span>}
                {ACTIVITY_LABEL[a.type] ?? a.type}
                {a.type === "VoteCast" && <span className={a.detail?.support ? "text-mint" : "text-ember"}> {a.detail?.support ? "for" : "against"}</span>}
                {a.type === "Deposited" && a.detail?.amount && <span className="text-fog"> {qor(String(a.detail.amount))} QOR</span>}
              </span>
              <a href={txUrl(a.tx)} target="_blank" rel="noreferrer" className="hash shrink-0 text-xs text-mute hover:text-white">
                {short(a.tx, 6, 4)}
              </a>
            </motion.li>
          ))}
        </AnimatePresence>
        {activity.data?.length === 0 && <li className="text-sm text-mute">Nothing yet.</li>}
      </ul>
      <a href={appConfig.explorer} target="_blank" rel="noreferrer" className="mt-4 block text-xs text-fog hover:text-white">
        Explorer ↗
      </a>
    </aside>
  );
}

