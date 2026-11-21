import { motion } from "motion/react";

/** The Conclave mark: an outer seal (violet) around an inner seal (mint), like two signatures. */
export function Mark({ size = 28, draw = false, dark = false }: { size?: number; draw?: boolean; dark?: boolean }) {
  const outer = dark ? "#080808" : "#7b5cff";
  const inner = dark ? "#080808" : "#34f5c5";
  const transition = (delay: number) => ({ duration: 1.1, delay, ease: [0.76, 0, 0.24, 1] as const });
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <motion.path
        d="M46 16a20 20 0 1 0 0 32"
        stroke={outer}
        strokeWidth={6.5}
        strokeLinecap="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={transition(0)}
      />
      <motion.path
        d="M41 25a10 10 0 1 0 0 14"
        stroke={inner}
        strokeWidth={5.5}
        strokeLinecap="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={transition(0.25)}
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <Mark size={26} />
      <span className="text-[1.05rem]">Conclave</span>
    </span>
  );
}
