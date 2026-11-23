import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState, type ReactNode } from "react";

import { Backdrop } from "../components/live/Backdrop";
import { ChainPulse } from "../components/live/ChainPulse";
import { LiveToasts } from "../components/live/LiveToasts";
import { EASE, rise } from "../components/live/motion";
import { PassportCard } from "../components/PassportCard";
import { SealConnect } from "../components/SealConnect";
import { SplitReveal } from "../components/SplitReveal";
import { useDao, useHealth, usePassport } from "../hooks/useConclave";
import { ActivityFeed } from "./app/Activity";
import { Overview } from "./app/Overview";
import { ComposeDrawer, Plus, ProposalDrawer, ProposalList } from "./app/Proposals";

export function AppPage() {
  const health = useHealth();
  const [selected, setSelected] = useState<string>();
  const [composing, setComposing] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <main className="spotlight relative min-h-screen px-5 pt-32 pb-40 sm:px-8">
        <Backdrop />
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <AnimatePresence>
            {health.isError && (
              <Banner tone="ember">
                The Conclave relayer is offline. Start it from the repo with <span className="hash">npm run dev</span>.
              </Banner>
            )}
            {health.data && !health.data.deployed && (
              <Banner tone="sun">
                Conclave is not deployed yet. Fund the relayer, then run <span className="hash">npm run setup:testnet</span>.
              </Banner>
            )}
          </AnimatePresence>

          <Hero onCompose={() => setComposing(true)} />

          <section className="mt-36">
            <SectionHead index="02" label="The DAO" title="What guards the treasury" />
            <Overview />
          </section>

          <section id="proposals" className="mt-36 scroll-mt-28">
            <SectionHead
              index="03"
              label="Proposals"
              title="Every one signed with ML-DSA-87"
              action={<ComposeButton onClick={() => setComposing(true)} />}
            />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <ProposalList onOpen={setSelected} onCompose={() => setComposing(true)} />
              <ActivityFeed />
            </div>
          </section>
        </div>

        <AnimatePresence>
          {selected && <ProposalDrawer id={selected} onClose={() => setSelected(undefined)} />}
          {composing && <ComposeDrawer onClose={() => setComposing(false)} />}
        </AnimatePresence>
        <LiveToasts />
      </main>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------------------------
// Hero: the passport and what it means for you
// ---------------------------------------------------------------------------------------------

function heroCopy(p: ReturnType<typeof usePassport>, members: number, threshold: number) {
  if (!p.isConnected)
    return {
      eyebrow: "Your passport",
      title: "Sign in with a quantum-safe key.",
      text: "Connect QoreX to see your ML-DSA-87 key, your role, and the proposals waiting for your signature.",
    };
  if (p.loading)
    return {
      eyebrow: "Your passport",
      title: "Reading your passport…",
      text: "Looking up your ML-DSA-87 key on QoreChain and your seat in Conclave.",
    };
  if (p.accountKind === "ethereum")
    return {
      eyebrow: p.isMember ? "Member · imported account" : "Imported account",
      title: "QoreX can't sign with this account.",
      text: "It came from an Ethereum wallet such as MetaMask, and QoreX signs post-quantum messages only with accounts created in QoreX. Create one in QoreX and have it added as a member.",
    };
  if (!p.key.mlDsa87)
    return {
      eyebrow: "Classical account",
      title: "This key won't survive Q-Day.",
      text: "This account has no ML-DSA-87 key on QoreChain. Switch to a registered account in QoreX to sign in Conclave.",
    };
  if (p.isMember)
    return {
      eyebrow: "Welcome back, member",
      title: "Your vote is quantum-sealed.",
      text: `You are one of ${members || "the"} members. A proposal needs ${threshold || "enough"} signatures, and the chain checks each one with pqcVerify before any QOR moves.`,
    };
  return {
    eyebrow: "Quantum-ready visitor",
    title: "Your key is ready. Watch along.",
    text: "Your ML-DSA-87 key is registered, but this account is not a member. You can follow the treasury and execute passed proposals.",
  };
}

function Hero({ onCompose }: { onCompose: () => void }) {
  const passport = usePassport();
  const dao = useDao();
  const copy = heroCopy(passport, dao.data?.members.length ?? 0, dao.data?.threshold ?? 0);

  return (
    <section className="grid min-h-[calc(100svh-14rem)] items-center gap-16 lg:grid-cols-2 lg:gap-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 1.2, ease: EASE, delay: 0.1 }}
        className="relative flex justify-center lg:order-none"
      >
        <div className="passport-halo" aria-hidden />
        <div className="float relative flex w-full justify-center">
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
            <div className="relative w-full max-w-[420px] opacity-60 saturate-50">
              <PassportCard data={{ mlDsa87: false, keyBytes: 0, isMember: false, isGuardian: false }} stamp={false} />
              <p className="absolute inset-x-0 -bottom-10 text-center text-sm text-fog">Your passport appears here</p>
            </div>
          )}
        </div>
      </motion.div>

      <div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}>
          <ChainPulse />
        </motion.div>
        <motion.p
          key={copy.eyebrow}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-12 text-xs tracking-[0.24em] text-fog uppercase"
        >
          <span className="hash text-mute">01</span> &nbsp;{copy.eyebrow}
        </motion.p>
        <SplitReveal key={copy.title} as="h1" onLoad delay={0.2} className="mt-5 max-w-xl text-[clamp(2.6rem,5.2vw,4.4rem)] leading-[1.02] font-medium tracking-[-0.045em]">
          {copy.title}
        </SplitReveal>
        <motion.p
          key={copy.text}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}
          className="mt-7 max-w-md text-lg leading-relaxed text-fog"
        >
          {copy.text}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.75 }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          {!passport.isConnected ? (
            <SealConnect />
          ) : (
            <>
              {passport.isMember && passport.key.mlDsa87 && <ComposeButton onClick={onCompose} />}
              <a href="#proposals" className="btn btn-ghost">
                See proposals ↓
              </a>
            </>
          )}
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------------

function SectionHead({ index, label, title, action }: { index: string; label: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div>
        <motion.p
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="text-xs tracking-[0.24em] text-fog uppercase"
        >
          <span className="hash text-mute">{index}</span> &nbsp;{label}
        </motion.p>
        <SplitReveal as="h2" enter className="mt-4 text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
          {title}
        </SplitReveal>
      </div>
      {action}
    </div>
  );
}

function ComposeButton({ onClick }: { onClick: () => void }) {
  const dao = useDao();
  return (
    <motion.button
      type="button"
      className="btn btn-primary group"
      onClick={onClick}
      disabled={!dao.data}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
    >
      New proposal <Plus />
    </motion.button>
  );
}

function Banner({ tone, children }: { tone: "ember" | "sun"; children: ReactNode }) {
  const cls = tone === "ember" ? "border-ember/40 bg-ember/10 text-ember" : "border-sun/40 bg-sun/10 text-sun";
  return (
    <motion.p
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`mb-8 rounded-2xl border px-5 py-4 text-sm ${cls}`}
    >
      {children}
    </motion.p>
  );
}
