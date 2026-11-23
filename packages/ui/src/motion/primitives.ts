/**
 * Connexia Motion Primitives
 * 
 * A collection of reusable animation primitives for the Connexia UI system.
 * These primitives respect the design constraints from the frontend plan:
 * - No bounce, spring, or parallax
 * - Motion: 120ms/180ms, cubic-bezier(.2,0,0,1)
 * - Reduced motion support
 * 
 * Usage:
 *   import { fadeIn, scaleIn, stagger } from '@connexia/ui/motion';
 */

import { motion, type Variants, type Transition, type HTMLMotionProps } from 'motion/react';
import { motion as motionWeb, type MotionValue } from 'motion';
import { motion } from 'motion/react';

// ============================================================================
// EASING CURVES
// ============================================================================

/**
 * Connexia's default easing curve from the frontend plan
 */
export const easeDefault = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Enhanced easing curves for different animation purposes
 */
export const easing = {
  /** Default Connexia easing */
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
 */
export const duration = {
  xs: 100,
  sm: 120,
  md: 180,
  lg: 240,
  xl: 320,
  '2xl': 400,
  '3xl': 500,
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
  '240': 240,
  '280': 280,
  '320': 320,
} as const;

// ============================================================================
// TRANSITION PRESETS
// ============================================================================

/**
 * Predefined transition configurations
 */
export const transitions = {
  // Fast transitions (120ms)
  fast: {
    duration: duration.sm / 1000,
    ease: easing.default,
  },
  
  // Normal transitions (180ms)
  normal: {
    duration: duration.md / 1000,
    ease: easing.default,
  },
  
  // Slow transitions (240ms)
  slow: {
    duration: duration.lg / 1000,
    ease: easing.fluid,
  },
  
  // Fluid transitions
  fluid: {
    duration: duration.md / 1000,
    ease: easing.fluid,
  },
  
  // Smooth transitions
  smooth: {
    duration: duration.md / 1000,
    ease: easing.smooth,
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
    slow: {
      duration: duration.lg / 1000,
      ease: easing.fluid,
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
    slow: {
      duration: duration.lg / 1000,
      ease: easing.fluid,
    },
  },
  
  // Bounce-free spring
  spring: {
    type: 'spring',
    damping: 25,
    stiffness: 200,
    bounce: 0,
  },
  
  // Very stiff spring (almost no bounce)
  springStiff: {
    type: 'spring',
    damping: 30,
    stiffness: 500,
    bounce: 0,
  },
} as const;

// ============================================================================
// ANIMATION VARIANTS
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
 * Pulse animation (subtle)
 */
export const pulse: Variants = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.05, 1] },
};

/**
 * Subtle pulse animation
 */
export const pulseSubtle: Variants = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.02, 1] },
};

/**
 * Bounce animation (bounce-free, just scale)
 */
export const bounceSubtle: Variants = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.02, 1] },
};

/**
 * Shake animation for errors
 */
export const shake: Variants = {
  initial: { x: 0 },
  animate: {
    x: [0, -5, 5, -5, 5, 0],
    transition: { duration: 0.3 }
  },
};

/**
 * Spin animation
 */
export const spin: Variants = {
  initial: { rotate: 0 },
  animate: { rotate: 360 },
};

/**
 * Slow spin animation
 */
export const spinSlow: Variants = {
  initial: { rotate: 0 },
  animate: {
    rotate: 360,
    transition: { duration: 20, repeat: Infinity, ease: 'linear' }
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
 * Subtle scale on hover
 */
export const hoverScale = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
};

/**
 * Lift effect on hover (subtle shadow equivalent)
 */
export const hoverLift = {
  whileHover: { 
    scale: 1.01,
    // We can't use box-shadow directly in transform, 
    // but this creates a subtle "lift" effect
  },
  whileTap: { scale: 0.99 },
};

/**
 * Subtle translate on hover
 */
export const hoverTranslateY = {
  whileHover: { y: -2 },
  whileTap: { y: 0 },
};

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
    transition: { delay: index * delayPerItem },
  };
}

/**
 * Scale in with stagger
 */
export function scaleInStagger(index: number, delayPerItem: number = 0.05) {
  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    transition: { delay: index * delayPerItem },
  };
}

/**
 * Slide up with stagger
 */
export function slideUpStagger(index: number, delayPerItem: number = 0.05) {
  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: index * delayPerItem, ease: easing.fluid },
  };
}

// ============================================================================
// COUNTER ANIMATIONS
// ============================================================================

/**
 * Animate a number from start to end
 */
export function animateNumber(
  start: number,
  end: number,
  duration: number = 1000,
  easing: string = easing.easeOut
) {
  return {
    initial: { value: start },
    animate: { 
      value: end,
      transition: { duration: duration / 1000, ease: easing }
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
 */
export function animatePercentage(
  start: number,
  end: number,
  duration: number = 800,
  easing: string = easing.easeOut
) {
  return {
    initial: { percentage: start },
    animate: { 
      percentage: end,
      transition: { duration: duration / 1000, ease: easing }
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
 */
export function ReducedMotionWrapper({
  children,
  ...props
}: HTMLMotionProps<'div'>) {
  const reducedMotion = useReducedMotion();
  
  return (
    <motion.div
      {...props}
      animate={reducedMotion ? {} : props.animate}
      transition={reducedMotion ? {} : props.transition}
      whileHover={reducedMotion ? {} : props.whileHover}
      whileTap={reducedMotion ? {} : props.whileTap}
    >
      {children}
    </motion.div>
  );
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type EasingKey = keyof typeof easing;
export type DurationKey = keyof typeof duration;
export type DelayKey = keyof typeof delay;
