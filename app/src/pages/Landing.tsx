import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { HeroDevice } from "../components/HeroDevice";
import { Mark } from "../components/Logo";
import { SplitReveal } from "../components/SplitReveal";
import { useDao, useProposals } from "../hooks/useConclave";
import { appConfig } from "../lib/config";
import { qor } from "../lib/format";

export function Landing() {
  return (
    <main>
      <Hero />
      <Manifesto />
      <Stats />
      <Stages />
      <QDay />
      <Security />
      <Closing />
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

function Hero() {
  return (
    <section className="spotlight relative overflow-hidden px-4 pt-32 pb-24 md:pt-36">
      <div className="grid-lines absolute inset-0" />
      <div className="relative mx-auto max-w-5xl text-center">
        <motion.p className="pill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
          <span className="relative h-1.5 w-1.5 rounded-full bg-mint pulse-dot text-mint" />
          Post-quantum DAO treasury · QoreChain
        </motion.p>
        <SplitReveal as="h1" onLoad delay={1.0} className="mx-auto mt-7 max-w-4xl text-[2.6rem] leading-[1.02] font-medium tracking-[-0.035em] md:text-[5.2rem]">
          The treasury Q-Day can't touch.
        </SplitReveal>
        <motion.p
          className="mx-auto mt-6 max-w-2xl text-lg text-fog md:text-xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          Every vote, payout and rule change in Conclave needs an ML-DSA-87 signature, checked on chain by QoreChain's pqcVerify. A stolen ECDSA key can't move a single QOR.
        </motion.p>
        <motion.div className="mt-9 flex flex-wrap justify-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.75 }}>
          <Link to="/app" className="btn btn-primary">
            Open the treasury →
          </Link>
          <a href="#qday" className="btn btn-ghost">
            Simulate Q-Day
          </a>
        </motion.div>
      </div>
      <HeroDevice />
    </section>
  );
}

function Manifesto() {
  return (
    <section id="how" className="mx-auto max-w-5xl px-4 py-32 md:py-44">
      <SplitReveal className="text-center text-[1.9rem] leading-[1.18] font-medium tracking-[-0.02em] md:text-[3.1rem]">
        Every DAO trusts one thing: the ECDSA keys of its members. A quantum computer can rebuild those keys from what is already on chain. Conclave doesn't trust them at all.
      </SplitReveal>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, value, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (node.textContent = v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })),
    });
    return () => controls.stop();
  }, [inView, value, decimals]);
  return <span ref={ref}>0</span>;
}

function Stats() {
  const dao = useDao();
  const proposals = useProposals();
  const treasury = dao.data ? Number(qor(dao.data.treasuryWei, 4).replace(/,/g, "")) : 0;
  const pqMembers = dao.data?.members.filter((m) => m.mlDsa87).length ?? 0;
  const signatures = (proposals.data ?? []).reduce((n, p) => n + 1 + p.votes.length, 0);

  const cards = [
    { big: <CountUp value={treasury} decimals={2} />, unit: "QOR", label: "In the treasury, live from the chain", tag: "Treasury" },
    { big: <CountUp value={4627} />, unit: "B", label: "Every ML-DSA-87 signature Conclave checks", tag: "FIPS 204" },
    { big: <CountUp value={signatures} />, unit: "", label: "Post-quantum signatures verified on chain so far", tag: "pqcVerify" },
    { big: <><CountUp value={pqMembers} />/{dao.data?.members.length ?? 3}</>, unit: "", label: "Members with an ML-DSA-87 key registered", tag: "pqcKeyStatus" },
  ];

  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-32 md:grid-cols-2">
      {cards.map((c, i) => (
        <motion.div
          key={c.tag}
          initial={{ opacity: 0, y: 60, rotate: i % 2 ? 2.5 : -2.5 }}
          whileInView={{ opacity: 1, y: 0, rotate: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: (i % 2) * 0.1 }}
          className="card card-hover relative overflow-hidden p-8 md:p-10"
        >
          <span className="pill absolute top-7 right-7">{c.tag}</span>
          <p className="text-[4.2rem] leading-none font-medium tracking-[-0.04em] md:text-[5.6rem]">
            {c.big}
            {c.unit && <span className="ml-2 text-2xl text-fog">{c.unit}</span>}
          </p>
          <p className="mt-6 max-w-xs text-fog">{c.label}</p>
        </motion.div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

const STAGES = [
  {
    title: "Propose",
    text: "A member signs a readable proposal in QoreX. The relayer submits it; the contract checks the member's ML-DSA-87 signature against the key the chain holds for them.",
    visual: "Conclave v1\naction: propose\nproposal hash: 0x9a1f…c07e\nnonce: 0\nvalid until: 1764633600\nmember: 0x8cb8…7c7f\ndao: 0x5fbd…0aa3\nchain: 9800",
  },
  {
    title: "Vote",
    text: "Each vote names the proposal, its exact content, the member, this DAO and the chain, so it can never be replayed anywhere else. Members pay no gas and need no EVM window.",
    visual: "Conclave v1\naction: vote\nsupport: for\nproposal: 7\nproposal hash: 0x9a1f…c07e\nmember: 0x8cb8…7c7f\ndao: 0x5fbd…0aa3\nchain: 9800",
  },
  {
    title: "Timelock",
    text: "A strict majority of post-quantum votes queues the proposal. The timelock gives every member, and the guardian, time to react before anything moves.",
    visual: "state: Queued\nforVotes: 2 / 3\neta: in 2m 00s\ngrace: 7 days\npause fuse: armed",
  },
  {
    title: "Execute",
    text: "Anyone can execute a passed proposal: its content is fixed by a hash the members signed. All actions succeed together or nothing happens.",
    visual: "execute(#7)\n→ hash matches ✓\n→ 5 QOR → 0xgrantee ✓\nProposalExecuted(7)\nrelayer window: scoped to Conclave",
  },
];

function Stages() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STAGES.length - 1, Math.floor(v * STAGES.length))));

  return (
    <section ref={ref} className="relative" style={{ height: `${STAGES.length * 85}vh` }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden px-4">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm text-fog">Life of a proposal</p>
            <div className="mt-6 flex gap-2">
              {STAGES.map((s, i) => (
                <span key={s.title} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i <= active ? "bg-white" : "bg-white/10"}`} />
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                <p className="hash mt-10 text-sm text-violet-2">0{active + 1}</p>
                <h3 className="mt-2 text-5xl font-medium tracking-[-0.03em] md:text-6xl">{STAGES[active]!.title}</h3>
                <p className="mt-5 max-w-md text-lg text-fog">{STAGES[active]!.text}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div style={{ perspective: 1400 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, rotateY: -18, rotateX: 8, x: 60 }}
                animate={{ opacity: 1, rotateY: -8, rotateX: 4, x: 0 }}
                exit={{ opacity: 0, rotateY: 8, x: -40 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="card relative overflow-hidden p-7 shadow-[0_50px_120px_-40px_rgba(123,92,255,0.45)]"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="pill">{active < 2 ? "QoreX · sign with ML-DSA-87" : "Conclave contract"}</span>
                  <Mark size={22} />
                </div>
                <pre className="hash text-[0.95rem] leading-7 whitespace-pre-wrap text-white/85">{STAGES[active]!.visual}</pre>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

const ATTEMPTS = [
  { act: "Propose a payout to the attacker, as a member", result: "PqcInvalidSignature", ok: false },
  { act: "Vote FOR, sent from the member's own account", result: "PqcInvalidSignature", ok: false },
  { act: "Call payERC20 / setThreshold / addMember directly", result: "OnlySelf", ok: false },
  { act: "Replay a member's old vote on another proposal", result: "PqcInvalidSignature", ok: false },
  { act: "Redirect a passed payout at execution", result: "ProposalHashMismatch", ok: false },
  { act: "Pause the treasury with the guardian's key", result: "Paused · once, 30 min", ok: true },
  { act: "Pause it again to hold the DAO hostage", result: "GuardianDisarmed", ok: false },
];

function QDay() {
  const [leaked, setLeaked] = useState(false);
  return (
    <section id="qday" className="mx-auto max-w-6xl px-4 py-32">
      <div className="grid gap-10 md:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="pill">Q-Day simulator</p>
          <h2 className="mt-6 text-5xl font-medium tracking-[-0.03em] md:text-6xl">Hand an attacker every classical key.</h2>
          <p className="mt-5 max-w-md text-lg text-fog">
            On Q-Day a quantum computer recovers ECDSA keys from public keys. These are the attacks our test suite runs against Conclave, and what the contract answers.
          </p>
          <button type="button" onClick={() => setLeaked((v) => !v)} className={`btn mt-8 ${leaked ? "btn-ghost" : "btn-violet"}`}>
            {leaked ? "Reset" : "Leak every ECDSA key"}
          </button>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 text-sm">
            <span className="text-fog">Attacker holds: members, guardian, relayer (ECDSA)</span>
            <span className={leaked ? "text-ember" : "text-mute"}>{leaked ? "● keys leaked" : "○ idle"}</span>
          </div>
          <ul className="divide-y divide-white/5">
            {ATTEMPTS.map((a, i) => (
              <li key={a.act} className="flex items-center justify-between gap-4 px-6 py-4">
                <span className={`text-[0.95rem] transition-colors duration-500 ${leaked ? "text-white" : "text-mute"}`}>{a.act}</span>
                <AnimatePresence>
                  {leaked && (
                    <motion.span
                      initial={{ opacity: 0, x: 20, scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: 0.25 * i, type: "spring", stiffness: 300, damping: 22 }}
                      className={`hash shrink-0 rounded-full px-3 py-1 text-xs ${a.ok ? "bg-sun/15 text-sun" : "bg-mint/12 text-mint"}`}
                    >
                      {a.ok ? "⚠ " : "✕ "}
                      {a.result}
                    </motion.span>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
          <AnimatePresence>
            {leaked && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="border-t border-white/5 px-6 py-4 text-sm text-fog">
                Treasury moved: <span className="text-white">0 QOR</span>. A queued payout still executes after the pause.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

const SECURITY = [
  { title: "Keys from the chain, never from you", text: "pqcKeyStatus supplies the signer's ML-DSA-87 key. A caller cannot bring their own." },
  { title: "Fail closed", text: "An inactive, reverting or odd precompile answer is never read as a valid signature." },
  { title: "Bound to everything", text: "Action, proposal, exact content, member, DAO and chain are inside every signed message." },
  { title: "Scoped relayer", text: "The relayer's EVM window only reaches Conclave. Its leaked key can't spend elsewhere." },
  { title: "One-shot guardian", text: "A classical key may pause once, shorter than the grace period. Unpausing takes a vote." },
  { title: "Tested like an attacker", text: "133 unit, fuzz and invariant tests, plus differential tests against QoreSign." },
];

function Security() {
  return (
    <section id="security" className="bg-paper px-4 py-32 text-ink">
      <div className="mx-auto max-w-6xl">
        <SplitReveal as="h2" enter className="max-w-3xl text-5xl font-medium tracking-[-0.03em] md:text-6xl">
          Built for the day the old keys stop meaning anything.
        </SplitReveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {SECURITY.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.8, delay: (i % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="group rounded-[28px] border border-ink/10 bg-white p-8 transition-colors duration-700 hover:bg-ink hover:text-white"
            >
              <span className="hash text-sm text-ink/40 transition-colors duration-700 group-hover:text-white/40">0{i + 1}</span>
              <h3 className="mt-10 text-2xl font-medium tracking-tight">{s.title}</h3>
              <p className="mt-3 text-ink/60 transition-colors duration-700 group-hover:text-white/60">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <footer className="relative overflow-hidden px-4 pt-32 pb-10">
      <div className="spotlight absolute inset-0 rotate-180" />
      <div className="relative mx-auto max-w-6xl">
        <SplitReveal as="h2" enter className="text-[3.2rem] leading-[0.95] font-medium tracking-[-0.045em] md:text-[8.5rem]">
          Build before Q-Day.
        </SplitReveal>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link to="/app" className="btn btn-primary">
            Open the treasury →
          </Link>
          <a className="btn btn-ghost" href={appConfig.repo} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
        <div className="mt-24 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-sm text-mute">
          <span>Conclave · Post-Quantum dApp · Build Before Q-Day</span>
          <span className="hash">qorechain-diana · EVM 9800 · MIT</span>
        </div>
      </div>
    </footer>
  );
}
