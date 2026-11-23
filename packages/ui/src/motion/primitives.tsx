/**
 * Synan Motion Primitives
 * 
 * A collection of reusable animation primitives for the Synan UI system.
 * 
 * IMPORTANT: This package respects the frontend plan constraints:
 * - NO bounce, NO spring, NO parallax
 * - Motion: 120ms/180ms, cubic-bezier(.2,0,0,1)
 * - Reduced motion support
 * 
 * All animations use ONLY cubic-bezier easing curves.
 * No spring physics are used anywhere.
 * 
 * Usage:
 *   import { fadeIn, scaleIn, transitions, easing } from '@synan/ui/motion';
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { motion, type Variants, type Transition, type HTMLMotionProps } from 'motion/react';

// ============================================================================
// EASING CURVES
// ONLY cubic-bezier - NO spring animations per docs/05-design-system.md §5
// ============================================================================

/**
 * Synan's default easing curve from the docs/05-design-system.md §5
 */
export const easeDefault = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Enhanced easing curves for different animation purposes
 * All are cubic-bezier - NO spring
 */
export const easing = {
  /** Default Synan easing - from frontend plan */
  default: 'cubic-bezier(0.2, 0, 0, 1)',
  
  /** Fluid easing for smooth transitions */
  fluid: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  
  /** Smooth easing for gentle animations */
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  
  /** Subtle easing for micro-interactions */
  subtle: 'cubic-bezier(0.36, 0.1, 0.36, 1)',
  
  /** Standard ease-out */
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  
  /** Standard ease-in */
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  
  /** Standard ease-in-out */
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  
  /** Linear easing */
  linear: 'linear',
} as const;

// ============================================================================
// DURATIONS
// ============================================================================

/**
 * Animation durations in milliseconds
 * 120ms for state, 180ms for panels per docs/05-design-system.md §5
 */
export const duration = {
  xs: 100,   // Extra fast for immediate feedback
  sm: 120,   // State changes (matches frontend plan)
  md: 180,   // Panels (matches frontend plan)
  lg: 240,   // Larger transitions
  xl: 320,   // Complex animations
} as const;

// ============================================================================
// DELAYS
// ============================================================================

/**
 * Animation delays in milliseconds
 */
export const delay = {
  '0': 0,
  '40': 40,
  '80': 80,
  '120': 120,
  '160': 160,
  '200': 200,
} as const;

// ============================================================================
// TRANSITION PRESETS
// All use cubic-bezier - NO spring
// ============================================================================

/**
 * Predefined transition configurations
 */
export const transitions = {
  // From docs/05-design-system.md §5
  state: {
    duration: duration.sm / 1000,  // 120ms
    ease: easing.default,
  },
  
  panel: {
    duration: duration.md / 1000,  // 180ms
    ease: easing.default,
  },
  
  // Additional presets
  fast: {
    duration: duration.sm / 1000,
    ease: easing.default,
  },
  
  normal: {
    duration: duration.md / 1000,
    ease: easing.default,
  },
  
  slow: {
    duration: duration.lg / 1000,
    ease: easing.fluid,
  },
  
  // Specific property transitions
  opacity: {
    fast: {
      duration: duration.sm / 1000,
      ease: easing.default,
    },
    normal: {
      duration: duration.md / 1000,
      ease: easing.default,
    },
  },
  
  transform: {
    fast: {
      duration: duration.sm / 1000,
      ease: easing.default,
    },
    normal: {
      duration: duration.md / 1000,
      ease: easing.default,
    },
  },
  
  colors: {
    normal: {
      duration: duration.md / 1000,
      ease: easing.default,
    },
  },
  
  border: {
    normal: {
      duration: duration.md / 1000,
      ease: easing.default,
    },
  },
  
  // NOTE: No spring configurations - per docs/05-design-system.md §5
  // Spring animations are explicitly forbidden
} as const;

// ============================================================================
// ANIMATION VARIANTS
// All use cubic-bezier easing - NO spring, NO infinite animations
// ============================================================================

/**
 * Fade in animation
 */
export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * Fade in with upward movement
 */
export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

/**
 * Fade in with downward movement
 */
export const fadeInDown: Variants = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
};

/**
 * Fade in with left movement
 */
export const fadeInLeft: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

/**
 * Fade in with right movement
 */
export const fadeInRight: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
};

/**
 * Scale in animation
 */
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

/**
 * Scale in with fade
 */
export const scaleInFade: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
};

/**
 * Slide in from left
 */
export const slideInLeft: Variants = {
  initial: { x: '-100%', opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '-100%', opacity: 0 },
};

/**
 * Slide in from right
 */
export const slideInRight: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '100%', opacity: 0 },
};

/**
 * Slide in from top
 */
export const slideInTop: Variants = {
  initial: { y: '-100%', opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: '-100%', opacity: 0 },
};

/**
 * Slide in from bottom
 */
export const slideInBottom: Variants = {
  initial: { y: '100%', opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: '100%', opacity: 0 },
};

/**
 * Spin animation - for loading indicators only
 * Uses linear easing, not spring
 */
export const spin: Variants = {
  initial: { rotate: 0 },
  animate: { 
    rotate: 360,
    transition: { 
      duration: 1,
      ease: 'linear',
      repeat: Infinity,
    }
  },
};

// ============================================================================
// STAGGER CONFIGURATIONS
// ============================================================================

/**
 * Stagger children with a delay
 */
export const staggerChildren = {
  animate: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

/**
 * Stagger children in reverse
 */
export const staggerChildrenReverse = {
  animate: {
    transition: {
      staggerChildren: -0.04,
    },
  },
};

/**
 * Stagger with custom delay
 */
export function staggerCustom(delay: number = 0.04) {
  return {
    animate: {
      transition: {
        staggerChildren: delay,
      },
    },
  };
}

// ============================================================================
// HOVER ANIMATIONS
// ============================================================================

/**
 * Color change on hover
 */
export function hoverColor(hoverColor: string, tapColor?: string) {
  return {
    whileHover: { color: hoverColor },
    whileTap: { color: tapColor || hoverColor },
  };
}

/**
 * Background color change on hover
 */
export function hoverBg(hoverBg: string, tapBg?: string) {
  return {
    whileHover: { backgroundColor: hoverBg },
    whileTap: { backgroundColor: tapBg || hoverBg },
  };
}

// ============================================================================
// ENTRANCE ANIMATIONS WITH STAGGER
// ============================================================================

/**
 * Fade in with stagger
 */
export function fadeInStagger(index: number, delayPerItem: number = 0.04) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { 
      delay: index * delayPerItem,
      ease: easing.default,
    },
  };
}

/**
 * Scale in with stagger
 */
export function scaleInStagger(index: number, delayPerItem: number = 0.05) {
  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    transition: { 
      delay: index * delayPerItem,
      ease: easing.default,
    },
  };
}

/**
 * Slide up with stagger
 */
export function slideUpStagger(index: number, delayPerItem: number = 0.05) {
  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { 
      delay: index * delayPerItem,
      ease: easing.fluid,
    },
  };
}

// ============================================================================
// COUNTER ANIMATIONS
// Uses transform: scaleX for bars (not width) per docs/02-architecture.md §9
// ============================================================================

/**
 * Animate a number from start to end
 * Uses cubic-bezier easing, not spring
 */
export function animateNumber(
  start: number,
  end: number,
  duration: number = 1000,
  ease: string = easing.easeOut
) {
  return {
    initial: { value: start },
    animate: { 
      value: end,
      transition: { 
        duration: duration / 1000,
        ease,
      }
    },
  };
}

/**
 * Format a number with commas
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Animate a percentage
 * Uses cubic-bezier easing, not spring
 */
export function animatePercentage(
  start: number,
  end: number,
  duration: number = 800,
  ease: string = easing.easeOut
) {
  return {
    initial: { percentage: start },
    animate: { 
      percentage: end,
      transition: { 
        duration: duration / 1000,
        ease,
      }
    },
  };
}

// ============================================================================
// REDUCED MOTION SUPPORT
// ============================================================================

/**
 * Check if the user prefers reduced motion
 */
export function useReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Create a motion component that respects reduced motion
 * This is a wrapper that disables animations when reduced motion is preferred
 */
export function ReducedMotionWrapper({
  children,
  ...props
}: HTMLMotionProps<'div'>) {
  const reducedMotion = useReducedMotion();
  
  // If reduced motion is preferred, return a plain div with no animations
  if (reducedMotion) {
    return <div {...(props as HTMLAttributes<HTMLDivElement>)}>{children as ReactNode}</div>;
  }
  
  // Otherwise, use motion.div with animations
  return (
    <motion.div {...props}>
      {children as ReactNode}
    </motion.div>
  );
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type EasingKey = keyof typeof easing;
export type DurationKey = keyof typeof duration;
export type DelayKey = keyof typeof delay;
