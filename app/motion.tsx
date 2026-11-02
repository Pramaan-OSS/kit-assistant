"use client";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Optional entrance motion; respects the visitor's reduced-motion setting. */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.35 }}
    >
      {children}
    </motion.div>
  );
}
