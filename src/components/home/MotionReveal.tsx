'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
};

export function MotionReveal({ children, className, delay = 0, y = 22 }: MotionRevealProps) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: Math.min(y, 10) }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.92, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
