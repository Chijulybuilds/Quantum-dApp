import type { Variants } from "motion/react";
import type { PointerEvent } from "react";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Rise and fade in; `custom` is the index for a stagger. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.9, ease: EASE } }),
};

/** Feeds the pointer position to .live-card's spotlight. */
export function trackPointer(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}
