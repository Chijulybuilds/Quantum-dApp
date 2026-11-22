import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/** A number that counts to its value with a spring, e.g. the treasury balance. */
export function AnimatedNumber({ value, decimals = 0, className = "" }: { value: number; decimals?: number; className?: string }) {
  const reduce = useReducedMotion();
  const target = useMotionValue(0);
  const spring = useSpring(target, { stiffness: 60, damping: 18, mass: 0.9 });
  const text = useTransform(spring, (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));

  useEffect(() => {
    if (reduce) spring.jump(value);
    target.set(value);
  }, [reduce, spring, target, value]);

  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}
