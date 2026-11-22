import { AnimatePresence, motion } from "motion/react";
import { useBlockNumber } from "wagmi";

/** A heartbeat for the chain: the latest block, which ticks and pulses as each one lands. */
export function ChainPulse() {
  const { data: block, isError } = useBlockNumber({ watch: true });
  const key = block?.toString() ?? "none";

  return (
    <div className="pill gap-3 py-2 pr-3 pl-3.5 whitespace-nowrap">
      <span className="relative h-2 w-2 text-mint">
        <span className="absolute inset-0 rounded-full bg-current" />
        {block !== undefined && <span key={key} className="beat absolute inset-0 rounded-full bg-current" />}
      </span>
      <span>
        {isError ? "Reconnecting" : "Live"}
        <span className="hidden sm:inline">{isError ? " to QoreChain" : " on QoreChain Diana"}</span>
      </span>
      <span className="text-mute">·</span>
      <span className="hash inline-flex h-[1.2em] items-center overflow-hidden text-fog">
        block&nbsp;
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={key}
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block tabular-nums text-white"
          >
            {block !== undefined ? Number(block).toLocaleString() : "…"}
          </motion.span>
        </AnimatePresence>
      </span>
      <svg key={key} width="34" height="14" viewBox="0 0 34 14" className="text-mint" aria-hidden>
        <motion.path
          d="M0 7 H10 L13 2 L17 12 L20 7 H34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 1 }}
          animate={{ pathLength: 1, opacity: [1, 1, 0.35] }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
    </div>
  );
}
