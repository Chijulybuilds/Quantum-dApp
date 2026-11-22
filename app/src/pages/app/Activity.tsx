import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { trackPointer } from "../../components/live/motion";
import { useActivity } from "../../hooks/useConclave";
import { TONE_DOT, activityKey, describeActivity } from "../../lib/activity";
import { appConfig, txUrl } from "../../lib/config";
import { short } from "../../lib/format";

const COLLAPSED = 6;

/** The DAO's on-chain events as a quiet timeline; new ones slide in at the top. */
export function ActivityFeed() {
  const activity = useActivity();
  const [expanded, setExpanded] = useState(false);
  const items = activity.data ?? [];
  const shown = items.slice(0, expanded ? 24 : COLLAPSED);

  return (
    <aside onPointerMove={trackPointer} className="card live-card h-fit p-7">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fog">Live activity</p>
        <span className="inline-flex items-center gap-2 text-xs text-fog">
          <span className="pulse-dot relative h-1.5 w-1.5 rounded-full bg-mint text-mint" />
          listening
        </span>
      </div>

      <ol className="relative mt-7 space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[4.5px] before:w-px before:bg-white/10">
        <AnimatePresence initial={false}>
          {shown.map((a, i) => {
            const d = describeActivity(a);
            return (
              <motion.li
                key={activityKey(a)}
                layout
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, delay: Math.min(i, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="relative flex items-start justify-between gap-3 pl-6"
              >
                <span className={`absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full ring-4 ring-ink-2 ${TONE_DOT[d.tone]}`} />
                <span className="min-w-0 text-sm">
                  {d.title}
                  {d.detail && <span className="text-fog"> {d.detail}</span>}
                </span>
                <a href={txUrl(a.tx)} target="_blank" rel="noreferrer" className="hash shrink-0 pt-0.5 text-xs text-mute transition-colors hover:text-white">
                  {short(a.tx, 6, 4)}
                </a>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {activity.isLoading && <li className="pl-6 text-sm text-mute">Reading the chain…</li>}
        {activity.data?.length === 0 && <li className="pl-6 text-sm text-mute">Nothing yet.</li>}
      </ol>

      <div className="mt-7 flex items-center justify-between text-xs">
        {items.length > COLLAPSED ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-fog transition-colors hover:text-white">
            {expanded ? "Show less" : `Show all ${items.length}`}
          </button>
        ) : (
          <span />
        )}
        <a href={appConfig.explorer} target="_blank" rel="noreferrer" className="text-fog transition-colors hover:text-white">
          Explorer ↗
        </a>
      </div>
    </aside>
  );
}
