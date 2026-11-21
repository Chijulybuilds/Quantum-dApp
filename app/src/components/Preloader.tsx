import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { Mark } from "./Logo";

const KEY = "conclave:preloaded";

function seenThisSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Light curtain: the mark draws itself, a key size ticks up, then the curtain lifts. */
export function Preloader() {
  const [visible, setVisible] = useState(() => !seenThisSession());
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1400);
      setCount(Math.round(2592 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => {
      setVisible(false);
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        /* private mode */
      }
    }, 1900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-paper text-ink"
          initial={{ clipPath: "inset(0% 0% 0% 0%)" }}
          exit={{ clipPath: "inset(0% 0% 100% 0%)" }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
        >
          <motion.div initial={{ rotate: -90, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}>
            <Mark size={84} draw />
          </motion.div>
          <motion.p
            className="hash mt-8 text-xs tracking-[0.25em] text-ink/50"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            LOADING ML-DSA-87 · {count.toLocaleString()} B
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
