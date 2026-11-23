/**
 * Connexia Design Tokens
 * 
 * This file contains all design tokens for the Connexia UI system.
 * These tokens are used across all apps (attendee, admin, scanner).
 * 
 * Usage:
 *   import { colors, spacing, typography, motion } from '@connexia/ui/tokens';
 */

// ============================================================================
// SPACING TOKENS
// 8px base scale with half-steps for better granularity
// ============================================================================
export const spacing = {
  '0': '0',
  '0.5': '0.125rem',   // 2px
  '1': '0.25rem',     // 4px
  '1.5': '0.375rem',  // 6px
  '2': '0.5rem',      // 8px
  '2.5': '0.625rem',  // 10px
  '3': '0.75rem',     // 12px
  '3.5': '0.875rem',  // 14px
  '4': '1rem',        // 16px
  '5': '1.25rem',     // 20px
  '6': '1.5rem',      // 24px
  '7': '1.75rem',     // 28px
  '8': '2rem',        // 32px
  '9': '2.25rem',     // 36px
  '10': '2.5rem',     // 40px
  '11': '2.75rem',    // 44px
  '12': '3rem',       // 48px
  '14': '3.5rem',     // 56px
  '16': '4rem',       // 64px
  '20': '5rem',       // 80px
  '24': '6rem',       // 96px
  '28': '7rem',       // 112px
  '32': '8rem',       // 128px
  '36': '9rem',       // 144px
  '40': '10rem',      // 160px
  '44': '11rem',      // 176px
  '48': '12rem',      // 192px
  '52': '13rem',      // 208px
  '56': '14rem',      // 224px
  '60': '15rem',      // 240px
  '64': '16rem',      // 256px
} as const;

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

// Font families
export const fonts = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  serif: '"Fraunces Variable", ui-serif, Georgia, serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
} as const;

// Font sizes for Attendee Portal (editorial, more spacious)
export const typographyAttendee = {
  xs: '0.625rem',     // 10px - mono labels, captions
  sm: '0.875rem',     // 14px - secondary text
  base: '1rem',       // 16px - body text
  lg: '1.125rem',     // 18px - large body
  xl: '1.25rem',      // 20px - subheadings
  '2xl': '1.75rem',    // 28px - headings
  '3xl': '2.25rem',    // 36px - section titles
  '4xl': '3rem',       // 48px - page titles
  '5xl': '4rem',       // 64px - display
} as const;

// Font sizes for Admin Command (dense, operational)
export const typographyAdmin = {
  xs: '0.5625rem',    // 9px - mono labels
  sm: '0.6875rem',    // 11px - secondary text
  base: '0.8125rem',  // 13px - body text
  lg: '0.875rem',     // 14px - large body
  xl: '1rem',         // 16px - subheadings
  '2xl': '1.25rem',    // 20px - headings
  '3xl': '1.5rem',     // 24px - section titles
  '4xl': '2rem',       // 32px - page titles
} as const;

// Font weights
export const fontWeights = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// Line heights
export const lineHeights = {
  none: '1',
  tight: '1.25',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
} as const;

// Letter spacing
export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
  mono: '0.08em',
  monoTight: '0.12em',
} as const;

// ============================================================================
// COLOR TOKENS
// ============================================================================

// Base colors (OKLCH for better perceptual uniformity)
export const colors = {
  // Neutral colors
  background: {
    light: 'oklch(1 0 0)',
    dark: 'oklch(0.145 0 0)',
  },
  foreground: {
    light: 'oklch(0.145 0 0)',
    dark: 'oklch(0.985 0 0)',
  },
  card: {
    light: 'oklch(1 0 0)',
    dark: 'oklch(0.205 0 0)',
  },
  cardForeground: {
    light: 'oklch(0.145 0 0)',
    dark: 'oklch(0.985 0 0)',
  },
  
  // Border and input colors
  border: {
    light: 'oklch(0.922 0 0)',
    dark: 'oklch(1 0 0 / 10%)',
  },
  input: {
    light: 'oklch(0.922 0 0)',
    dark: 'oklch(1 0 0 / 15%)',
  },
  
  // Muted colors
  muted: {
    light: 'oklch(0.97 0 0)',
    dark: 'oklch(0.269 0 0)',
  },
  mutedForeground: {
    light: 'oklch(0.556 0 0)',
    dark: 'oklch(0.708 0 0)',
  },
  
  // Semantic colors
  brand: '#0aa7c2',
  success: {
    light: 'oklch(0.55 0.14 155)',
    dark: 'oklch(0.72 0.15 155)',
  },
  warning: {
    light: 'oklch(0.65 0.14 85)',
    dark: 'oklch(0.8 0.14 85)',
  },
  destructive: {
    light: 'oklch(0.577 0.245 27.325)',
    dark: 'oklch(0.704 0.191 22.216)',
  },
  info: '#3b82f6',
  
  // Light variants for backgrounds
  brandLight: 'color-mix(in srgb, #0aa7c2 20%, transparent)',
  successLight: 'color-mix(in srgb, oklch(0.55 0.14 155) 20%, transparent)',
  warningLight: 'color-mix(in srgb, oklch(0.65 0.14 85) 20%, transparent)',
  destructiveLight: 'color-mix(in srgb, oklch(0.577 0.245 27.325) 20%, transparent)',
  
  // Chart colors
  chart: {
    '1': 'oklch(0.87 0 0)',
    '2': 'oklch(0.556 0 0)',
    '3': 'oklch(0.439 0 0)',
    '4': 'oklch(0.371 0 0)',
    '5': 'oklch(0.269 0 0)',
  },
  
  // Sidebar colors
  sidebar: {
    background: {
      light: 'oklch(0.985 0 0)',
      dark: 'oklch(0.205 0 0)',
    },
    foreground: {
      light: 'oklch(0.145 0 0)',
      dark: 'oklch(0.985 0 0)',
    },
    primary: {
      light: 'oklch(0.205 0 0)',
      dark: 'oklch(0.922 0 0)',
    },
    primaryForeground: {
      light: 'oklch(0.985 0 0)',
      dark: 'oklch(0.205 0 0)',
    },
    accent: {
      light: 'oklch(0.97 0 0)',
      dark: 'oklch(0.269 0 0)',
    },
    border: {
      light: 'oklch(0.922 0 0)',
      dark: 'oklch(1 0 0 / 10%)',
    },
    ring: {
      light: 'oklch(0.708 0 0)',
      dark: 'oklch(0.556 0 0)',
    },
  },
} as const;

// ============================================================================
// MOTION TOKENS
// ============================================================================

export const motion = {
  // Durations (ms)
  duration: {
    xs: 100,
    sm: 120,
    md: 180,
    lg: 240,
    xl: 320,
    '2xl': 400,
    '3xl': 500,
  },
  
  // Easing curves
  easing: {
    // Connexia's default easing (from frontend plan)
    default: 'cubic-bezier(0.2, 0, 0, 1)',
    
    // Enhanced easing curves for different purposes
    fluid: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    subtle: 'cubic-bezier(0.36, 0.1, 0.36, 1)',
    
    // Standard easings
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  
  // Delays (ms)
  delay: {
    '0': 0,
    '40': 40,
    '80': 80,
    '120': 120,
    '160': 160,
    '200': 200,
    '240': 240,
    '280': 280,
    '320': 320,
  },
  
  // Combined transition presets
  transition: {
    fast: 'all 120ms cubic-bezier(0.2, 0, 0, 1)',
    normal: 'all 180ms cubic-bezier(0.2, 0, 0, 1)',
    slow: 'all 240ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    
    // Specific property transitions
    opacity: {
      fast: 'opacity 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)',
      slow: 'opacity 240ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    },
    transform: {
      fast: 'transform 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
      slow: 'transform 240ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    },
    scale: {
      fast: 'transform 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
      bounce: 'transform 180ms cubic-bezier(0.36, 0.1, 0.36, 1)',
    },
    colors: {
      fast: 'color 120ms cubic-bezier(0.2, 0, 0, 1), background-color 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'color 180ms cubic-bezier(0.2, 0, 0, 1), background-color 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
    border: {
      normal: 'border-color 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
    shadow: {
      normal: 'box-shadow 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
  },
  
  // Animation presets for Motion library
  presets: {
    fadeIn: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    },
    fadeInUp: {
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -10 },
    },
    fadeInDown: {
      initial: { opacity: 0, y: -10 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 10 },
    },
    scaleIn: {
      initial: { opacity: 0, scale: 0.95 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.95 },
    },
    slideInLeft: {
      initial: { opacity: 0, x: -20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -20 },
    },
    slideInRight: {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: 20 },
    },
    pulse: {
      initial: { scale: 1 },
      animate: { scale: [1, 1.05, 1] },
    },
    bounceSubtle: {
      initial: { scale: 1 },
      animate: { scale: [1, 1.02, 1] },
    },
  },
  
  // Stagger configurations
  stagger: {
    children: 0.04,
    childrenReverse: -0.04,
    item: 0.05,
  },
} as const;

// ============================================================================
// BORDER RADIUS TOKENS
// ============================================================================

export const borderRadius = {
  none: '0',
  sm: 'calc(var(--radius) * 0.6)',
  md: 'calc(var(--radius) * 0.8)',
  lg: 'var(--radius)',
  xl: 'calc(var(--radius) * 1.4)',
  '2xl': 'calc(var(--radius) * 1.8)',
  '3xl': 'calc(var(--radius) * 2.2)',
  '4xl': 'calc(var(--radius) * 2.6)',
  full: '9999px',
} as const;

// ============================================================================
// SHADOW TOKENS
// Note: Connexia prefers no shadows on state, but we include for
// subtle depth effects when needed
// ============================================================================

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  lg: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  xl: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  '2xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  
  // Brand-colored shadows for accent
  brand: {
    sm: '0 0 0 1px color-mix(in srgb, #0aa7c2 50%, transparent)',
    md: '0 0 0 2px color-mix(in srgb, #0aa7c2 30%, transparent)',
  },
} as const;

// ============================================================================
// Z-INDEX TOKENS
// ============================================================================

export const zIndex = {
  auto: 'auto',
  '0': '0',
  '10': '10',
  '20': '20',
  '30': '30',
  '40': '40',
  '50': '50',
  '60': '60',
  dropdown: '100',
  sticky: '200',
  fixed: '300',
  modal: '400',
  popover: '500',
  tooltip: '600',
} as const;

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type Spacing = keyof typeof spacing;
export type TypographyAttendee = keyof typeof typographyAttendee;
export type TypographyAdmin = keyof typeof typographyAdmin;
export type FontWeight = keyof typeof fontWeights;
export type LineHeight = keyof typeof lineHeights;
export type LetterSpacing = keyof typeof letterSpacing;
export type Color = keyof typeof colors;
export type Duration = keyof typeof motion.duration;
export type Easing = keyof typeof motion.easing;
export type Delay = keyof typeof motion.delay;
export type BorderRadius = keyof typeof borderRadius;
export type Shadow = keyof typeof shadows;
export type ZIndex = keyof typeof zIndex;
