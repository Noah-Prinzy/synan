/**
 * Synan Motion Library
 *
 * Export all motion primitives, utilities, and components.
 *
 * Usage:
 *   import { fadeIn, scaleIn, transitions, easing } from '@synan/ui/motion';
 */

export * from './primitives';

// Re-export motion from the library for convenience
export { motion, AnimatePresence, m, LazyMotion } from 'motion/react';
export type {
  MotionProps,
  HTMLMotionProps,
  SVGMotionProps,
  Variants,
  Transition,
  Target,
  MotionValue,
  PanInfo,
} from 'motion/react';
