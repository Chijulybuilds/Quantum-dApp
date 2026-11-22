import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

import { rise, trackPointer } from "./motion";

/** A card that rises in when it scrolls into view and lights up under the pointer. */
export function LiveCard({
  index = 0,
  className = "",
  children,
  ...rest
}: { index?: number; className?: string; children: ReactNode } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <motion.div
      variants={rise}
      custom={index}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      onPointerMove={trackPointer}
      className={`card live-card ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
