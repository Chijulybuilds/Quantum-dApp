import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { useActivity } from "../../hooks/useConclave";
import { TONE_DOT, activityKey, describeActivity, type Tone } from "../../lib/activity";
import { txUrl } from "../../lib/config";

interface Toast {
  id: string;
  title: string;
  detail?: string;
  tone: Tone;
  tx: string;
}

/** Pops a small card whenever a new Conclave event lands on chain (not for the initial history). */
export function LiveToasts() {
  const activity = useActivity();
  const seen = useRef<Set<string>>();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const items = activity.data;
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map(activityKey));
      return;
    }
    const fresh = items.filter((a) => !seen.current!.has(activityKey(a)));
    if (!fresh.length) return;
    fresh.forEach((a) => seen.current!.add(activityKey(a)));
    setToasts((t) => [...fresh.slice(0, 3).map((a) => ({ id: activityKey(a), tx: a.tx, ...describeActivity(a) })), ...t].slice(0, 3));
  }, [activity.data]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((ts) => ts.slice(0, -1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.a
            key={t.id}
            layout
            href={txUrl(t.tx)}
            target="_blank"
            rel="noreferrer"
            initial={{ opacity: 0, x: 60, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, transition: { duration: 0.3 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/12 bg-ink-2/90 px-4 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
            <span className="min-w-0 flex-1 text-sm">
              {t.title}
              {t.detail && <span className="text-fog"> {t.detail}</span>}
              <span className="block text-xs text-mute">Just landed on chain ↗</span>
            </span>
          </motion.a>
        ))}
      </AnimatePresence>
    </div>
  );
}
