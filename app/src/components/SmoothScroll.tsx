import Lenis from "lenis";
import { useEffect } from "react";

import { ScrollTrigger, gsap, prefersReducedMotion } from "../lib/motion";

/** Inertial smooth scrolling (Lenis) driving GSAP's ticker, so scroll-scrubbed scenes stay fluid. */
export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, anchors: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
