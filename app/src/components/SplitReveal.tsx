import { useLayoutEffect, useRef, type ElementType } from "react";

import { gsap, prefersReducedMotion, SplitText } from "../lib/motion";

/**
 * Text that fills in character by character as it scrolls through the viewport (scrubbed), or,
 * with `onLoad`, rises in once when it mounts.
 */
export function SplitReveal({
  as: Tag = "p",
  children,
  className = "",
  onLoad = false,
  enter = false,
  delay = 0,
}: {
  as?: ElementType;
  children: string;
  className?: string;
  onLoad?: boolean;
  /** Play once when it enters the viewport instead of scrubbing (for text near the page end). */
  enter?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      const split = new SplitText(el, { type: "words,chars", charsClass: "split-char" });
      if (onLoad) {
        gsap.from(split.chars, {
          yPercent: 110,
          opacity: 0,
          rotate: 6,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.018,
          delay,
        });
      } else if (enter) {
        gsap.from(split.chars, {
          yPercent: 80,
          opacity: 0,
          duration: 1,
          ease: "expo.out",
          stagger: 0.02,
          scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none none" },
        });
      } else {
        gsap.from(split.chars, {
          opacity: 0.12,
          ease: "power2.out",
          stagger: 0.05,
          scrollTrigger: { trigger: el, start: "top 90%", end: "bottom 35%", scrub: true },
        });
      }
      return () => split.revert();
    }, el);
    return () => ctx.revert();
  }, [children, onLoad, enter, delay]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
