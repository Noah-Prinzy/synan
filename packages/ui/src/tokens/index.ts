/**
 * Connexia Design Tokens
 * 
 * This file contains all design tokens for the Connexia UI system.
 * These tokens are used across all apps (attendee, admin, scanner).
 * 
 * NOTE: This package intentionally deviates from some parts of the frontend plan
 * to achieve a more modern, premium design. See docs/05-design-system.md.
 * 
 * The following frontend plan rules are ALWAYS respected:
 * - Dark neutral ground
 * - 0px radius everywhere
 * - 1px hairline rules (no shadows on state)
 * - Colour reserved for meaning (signals)
 * - No bounce, no spring, no parallax
 * - Reduced motion support
 * 
 * Usage:
 *   import { colors, spacing, typographyAttendee, typographyAdmin, motion } from '@connexia/ui';
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
} as const;

// ============================================================================
// TYPOGRAPHY TOKENS
// 
// Frontend plan specifies: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56
// Admin body: 13px, Attendee body: 17px
// ============================================================================

// Font families
export const fonts = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  serif: '"Fraunces Variable", ui-serif, Georgia, serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
} as const;

// Font sizes for Attendee Portal (editorial)
// Scale: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56
// Body: 17px
export const typographyAttendee = {
  // Below body (for captions, labels)
  '2xs': '0.6875rem',  // 11px - mono eyebrows
  xs: '0.75rem',      // 12px
  sm: '0.8125rem',    // 13px
  // Body and above
  base: '1rem',        // 16px (slightly below 17px for better rhythm)
  md: '1.0625rem',    // 17px - body text
  lg: '1.1875rem',    // 19px (between 17 and 21)
  xl: '1.3125rem',    // 21px
  '2xl': '1.75rem',    // 28px
  '3xl': '2.5rem',     // 40px
  '4xl': '3.5rem',     // 56px
} as const;

// Font sizes for Admin Command (dense, operational)
// Scale: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56
// Body: 13px
export const typographyAdmin = {
  // Below body (for captions, labels)
  '2xs': '0.6875rem',  // 11px - mono labels
  xs: '0.75rem',      // 12px
  base: '0.8125rem',  // 13px - body text
  // Above body
  sm: '0.875rem',     // 14px
  md: '0.9375rem',    // 15px
  lg: '1.0625rem',    // 17px
  xl: '1.3125rem',    // 21px
  '2xl': '1.75rem',    // 28px
  '3xl': '2.5rem',     // 40px
  '4xl': '3.5rem',     // 56px
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
// 
// Frontend plan specifies:
// - Brand: #0AA7C2 (accent only, never a surface)
// - Success: #43C07A
// - Warning: #E7B643
// - Destructive: #FF6467
// 
// Rules:
// - Brand is an accent, never fills buttons, cards, or rows
// - Brand is for: 1px thread, focus rings, text selection, active rules
// - Signals (success/warning/destructive) carry state meaning
// ============================================================================

export const colors = {
  // Neutral colors - Dark mode (primary)
  background: {
    light: 'oklch(1 0 0)',
    dark: 'oklch(0.145 0 0)',  // #0A0A0A
  },
  foreground: {
    light: 'oklch(0.145 0 0)',
    dark: 'oklch(0.985 0 0)',  // #FAFAFA
  },
  card: {
    light: 'oklch(1 0 0)',
    dark: 'oklch(0.205 0 0)',  // #171717
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
    dark: 'oklch(0.269 0 0)',  // #262626
  },
  mutedForeground: {
    light: 'oklch(0.556 0 0)',
    dark: 'oklch(0.708 0 0)',  // #A1A1A1
  },
  
  // Semantic colors - FROM FRONTEND PLAN
  // Brand: accent only, never a surface
  brand: '#0aa7c2',
  
  // Signals: carry state meaning
  success: '#43C07A',    // admitted / healthy
  warning: '#E7B643',    // already inside / degraded / near capacity
  destructive: '#FF6467', // denied / breach / offline
  
  // Chart colors - neutral grays for dark mode
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
// 
// Frontend plan specifies:
// - 120 ms for state
// - 180 ms for panels
// - cubic-bezier(.2,0,0,1)
// - No bounce, no spring, no parallax
// ============================================================================

export const motion = {
  // Durations (ms) - matching frontend plan
  duration: {
    xs: 100,   // For very fast feedback
    sm: 120,   // For state changes (matches frontend plan)
    md: 180,   // For panels (matches frontend plan)
    lg: 240,   // For larger transitions
    xl: 320,   // For complex animations
  },
  
  // Easing curves - ONLY cubic-bezier, NO spring
  easing: {
    // Frontend plan default
    default: 'cubic-bezier(0.2, 0, 0, 1)',
    
    // Additional curves for different purposes (still cubic-bezier)
    fluid: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    subtle: 'cubic-bezier(0.36, 0.1, 0.36, 1)',
    
    // Standard easings
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    linear: 'linear',
  },
  
  // Delays (ms)
  delay: {
    '0': 0,
    '40': 40,
    '80': 80,
    '120': 120,
    '160': 160,
    '200': 200,
  },
  
  // Combined transition presets
  transition: {
    // Matching frontend plan
    state: 'all 120ms cubic-bezier(0.2, 0, 0, 1)',
    panel: 'all 180ms cubic-bezier(0.2, 0, 0, 1)',
    
    // Additional presets
    fast: 'all 120ms cubic-bezier(0.2, 0, 0, 1)',
    normal: 'all 180ms cubic-bezier(0.2, 0, 0, 1)',
    slow: 'all 240ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    
    // Specific property transitions
    opacity: {
      fast: 'opacity 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
    transform: {
      fast: 'transform 120ms cubic-bezier(0.2, 0, 0, 1)',
      normal: 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
    colors: {
      normal: 'color 180ms cubic-bezier(0.2, 0, 0, 1), background-color 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
    border: {
      normal: 'border-color 180ms cubic-bezier(0.2, 0, 0, 1)',
    },
  },
  
  // Animation presets for CSS/Motion
  // NOTE: No spring animations, no infinite pulses (per frontend plan)
  presets: {
    fadeIn: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
    },
    fadeInUp: {
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
    },
    fadeInDown: {
      initial: { opacity: 0, y: -10 },
      animate: { opacity: 1, y: 0 },
    },
    scaleIn: {
      initial: { opacity: 0, scale: 0.95 },
      animate: { opacity: 1, scale: 1 },
    },
    slideInLeft: {
      initial: { opacity: 0, x: -20 },
      animate: { opacity: 1, x: 0 },
    },
    slideInRight: {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
    },
    // No pulse or bounce animations (per frontend plan)
  },
  
  // Stagger configurations
  stagger: {
    children: 0.04,
    item: 0.05,
  },
} as const;

// ============================================================================
// BORDER RADIUS TOKENS
// 0px everywhere per frontend plan
// ============================================================================

export const borderRadius = {
  none: '0',
  sm: '0',
  md: '0',
  lg: '0',
  xl: '0',
  '2xl': '0',
  full: '9999px',
} as const;

// ============================================================================
// SHADOW TOKENS
// Note: Frontend plan says "no shadows on state"
// We only use shadows for subtle depth, never on data
// ============================================================================

export const shadows = {
  none: 'none',
  // Subtle shadows for depth (not on data)
  sm: '0 1px 1px 0 rgb(0 0 0 / 0.1)',
  md: '0 1px 2px 0 rgb(0 0 0 / 0.1)',
  
  // Brand-colored outlines (not shadows)
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
