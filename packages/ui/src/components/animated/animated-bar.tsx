/**
 * AnimatedBar Component
 * 
 * A bar that animates its width using transform: scaleX (not width property).
 * 
 * Features:
 * - Smooth width transitions using transform: scaleX
 * - Multiple variants: success, warning, destructive, brand, neutral
 * - Multiple sizes: sm, md, lg
 * - Respects reduced motion
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - Uses transform: scaleX for width (per frontend plan §9)
 * - NO width property animation (forbidden)
 * - NO spring animations (per frontend plan §2.3)
 * - Reduced motion support
 * 
 * Usage:
 *   import { AnimatedBar } from '@connexia/ui';
 *   
 *   <AnimatedBar value={75} max={100} />
 *   // Displays a bar at 75% width with smooth animation
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, spacing, motion as motionTokens } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** AnimatedBar variants */
export type AnimatedBarVariant = 'success' | 'warning' | 'destructive' | 'brand' | 'neutral';

/** AnimatedBar sizes */
export type AnimatedBarSize = 'sm' | 'md' | 'lg';

/** AnimatedBar props */
export interface AnimatedBarProps {
  /** Current value */
  value: number;
  /** Maximum value */
  max: number;
  /** Variant for color */
  variant?: AnimatedBarVariant;
  /** Size of the bar */
  size?: AnimatedBarSize;
  /** Whether to show the percentage label */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'inside' | 'outside';
  /** CSS class name */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

/** Variant styles */
const variantStyles: Record<AnimatedBarVariant, {
  background: string;
  labelColor: string;
}> = {
  success: {
    background: colors.success,
    labelColor: '#ffffff',
  },
  warning: {
    background: colors.warning,
    labelColor: '#000000',
  },
  destructive: {
    background: colors.destructive,
    labelColor: '#ffffff',
  },
  brand: {
    // Brand as accent (1px line), not fill
    // For bars, we use a subtle brand tint
    background: 'color-mix(in srgb, #0aa7c2 20%, transparent)',
    labelColor: colors.brand,
  },
  neutral: {
    background: 'color-mix(in srgb, #ffffff 10%, oklch(0.205 0 0))',
    labelColor: colors.foreground.dark,
  },
};

/** Size styles */
const sizeStyles: Record<AnimatedBarSize, {
  height: string;
  labelFontSize: string;
}> = {
  sm: {
    height: '0.25rem',
    labelFontSize: '0.625rem',
  },
  md: {
    height: '0.5rem',
    labelFontSize: '0.6875rem',
  },
  lg: {
    height: '0.75rem',
    labelFontSize: '0.75rem',
  },
};

// ============================================================================
// ANIMATED BAR COMPONENT
// ============================================================================

export function AnimatedBar({
  value,
  max,
  variant = 'neutral',
  size = 'md',
  showLabel = false,
  labelPosition = 'outside',
  className = '',
}: AnimatedBarProps) {
  const reducedMotion = useReducedMotion();
  const styles = variantStyles[variant];
  const sizes = sizeStyles[size];
  
  // Calculate percentage
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const percentageFormatted = Math.round(percentage);
  
  // For the animation, we use transform: scaleX instead of width
  // This is per frontend plan §9: "occupancy bars animate with transform: scaleX, not width"
  const scaleX = percentage / 100;
  
  // Track if this is the initial render
  const [isInitial, setIsInitial] = useState(true);
  const previousValueRef = useRef(value);
  
  useEffect(() => {
    if (previousValueRef.current !== value) {
      setIsInitial(false);
      previousValueRef.current = value;
    }
  }, [value]);

  return (
    <div
      className={`flex items-center gap-${spacing['2']} ${className}`}
      style={{ height: sizes.height }}
    >
      {/* Background track */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{ height: sizes.height, background: colors.border.dark }}
      >
        {/* Animated fill bar using transform: scaleX */}
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{
            height: sizes.height,
            background: styles.background,
            // Use transform: scaleX instead of width
            transformOrigin: 'left center',
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isInitial ? scaleX : scaleX }}
          transition={{
            duration: reducedMotion ? 0 : motionTokens.duration.md / 1000,
            ease: motionTokens.easing.default,
          }}
        />
      </div>
      
      {/* Label */}
      {showLabel && (
        <span
          className="flex-shrink-0 font-mono tabular-nums"
          style={{
            fontSize: sizes.labelFontSize,
            color: styles.labelColor,
            minWidth: '2.5rem',
            textAlign: 'right',
          }}
        >
          {percentageFormatted}%
        </span>
      )}
    </div>
  );
}

// ============================================================================
// SIMPLE ANIMATED BAR (CSS-only)
// For cases where we don't need the Motion library
// ============================================================================

export function SimpleAnimatedBar({
  value,
  max,
  variant = 'neutral',
  size = 'md',
  showLabel = false,
  className = '',
}: Omit<AnimatedBarProps, 'labelPosition'>) {
  const styles = variantStyles[variant];
  const sizes = sizeStyles[size];
  
  // Calculate percentage
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const percentageFormatted = Math.round(percentage);

  return (
    <div
      className={`flex items-center gap-${spacing['2']} ${className}`}
      style={{ height: sizes.height }}
    >
      {/* Background track */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{ height: sizes.height, background: colors.border.dark }}
      >
        {/* Animated fill bar using CSS transition on transform */}
        <div
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{
            height: sizes.height,
            background: styles.background,
            width: '100%',
            transform: `scaleX(${percentage / 100})`,
            transformOrigin: 'left center',
            transition: `transform 180ms cubic-bezier(0.2, 0, 0, 1)`,
          }}
        />
      </div>
      
      {/* Label */}
      {showLabel && (
        <span
          className="flex-shrink-0 font-mono tabular-nums"
          style={{
            fontSize: sizes.labelFontSize,
            color: styles.labelColor,
            minWidth: '2.5rem',
            textAlign: 'right',
          }}
        >
          {percentageFormatted}%
        </span>
      )}
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AnimatedBar;
export { SimpleAnimatedBar };
