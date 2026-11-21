import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { Wordmark } from "./Logo";
import { SealConnect } from "./SealConnect";

const links = [
  { href: "#how", label: "How it works" },
  { href: "#qday", label: "Q-Day" },
  { href: "#security", label: "Security" },
];

/** Floating capsule navigation; the links fold away once you scroll past the hero. */
export function Nav() {
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  const { pathname } = useLocation();
  const onLanding = pathname === "/";
  useMotionValueEvent(scrollY, "change", (y) => setCompact(y > 120));

  return (
    <motion.header
      className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.nav
        layout
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-ink/70 p-1.5 pl-4 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl"
      >
        <Link to="/" aria-label="Conclave home" className="mr-2">
          <Wordmark />
        </Link>
        {onLanding && !compact && (
          <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hidden items-center md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm text-fog transition-colors hover:text-white">
                {l.label}
              </a>
            ))}
          </motion.div>
        )}
        {pathname !== "/app" && (
          <Link to="/app" className="btn btn-ghost hidden h-10 px-4 text-sm sm:inline-flex">
            Open app
          </Link>
        )}
        <SealConnect compact />
      </motion.nav>
    </motion.header>
  );
}
