/**
 * Badge Component
 * 
 * A reusable badge component for status indicators.
 * 
 * Features:
 * - Multiple variants: success, warning, destructive, brand, neutral
 * - Multiple sizes: sm, md, lg
 * - Dot indicator option
 * - Pulse animation option (can be disabled)
 * - Full accessibility support
 * - Respects reduced motion
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - NO brand as surface (per frontend plan §2.1) - brand variant uses border only
 * - NO spring animations (per frontend plan §2.3)
 * - WCAG AA contrast ratios
 * - Reduced motion support
 * 
 * Usage:
 *   import { Badge } from '@connexia/ui';
 *   
 *   <Badge variant="success" dot>
 *     Active
 *   </Badge>
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, typographyAttendee, spacing, motion as motionTokens, borderRadius } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** Badge variants */
export type BadgeVariant = 'success' | 'warning' | 'destructive' | 'brand' | 'neutral';

/** Badge sizes */
export type BadgeSize = 'sm' | 'md' | 'lg';

/** Badge props */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  pulse?: boolean;
  children?: ReactNode;
}

// ============================================================================
// STYLES
// ============================================================================

/** Variant styles */
const variantStyles: Record<BadgeVariant, {
  background: string;
  color: string;
  border?: string;
  dotColor: string;
}> = {
  success: {
    // Success: green background with white text
    background: colors.success,
    color: '#ffffff',
    dotColor: '#ffffff',
  },
  warning: {
    // Warning: amber background with dark text
    background: colors.warning,
    color: '#000000',
    dotColor: '#000000',
  },
  destructive: {
    // Destructive: red background with white text
    background: colors.destructive,
    color: '#ffffff',
    dotColor: '#ffffff',
  },
  brand: {
    // Brand: transparent background with brand border (NO brand as surface)
    background: 'transparent',
    color: colors.brand,
    border: `1px solid ${colors.brand}`,
    dotColor: colors.brand,
  },
  neutral: {
    // Neutral: muted background
    background: colors.muted.dark,
    color: colors.mutedForeground.dark,
    dotColor: colors.mutedForeground.dark,
  },
};

/** Size styles */
const sizeStyles: Record<BadgeSize, {
  padding: string;
  fontSize: string;
  height: string;
  gap: string;
  dotSize: string;
}> = {
  sm: {
    padding: `${spacing['0.5']} ${spacing['2']}`,
    fontSize: typographyAttendee['2xs'],
    height: '1.25rem',
    gap: spacing['1'],
    dotSize: '0.375rem',
  },
  md: {
    padding: `${spacing['1']} ${spacing['2.5']}`,
    fontSize: typographyAttendee.xs,
    height: '1.5rem',
    gap: spacing['1.5'],
    dotSize: '0.5rem',
  },
  lg: {
    padding: `${spacing['1.5']} ${spacing['3']}`,
    fontSize: typographyAttendee.sm,
    height: '2rem',
    gap: spacing['2'],
    dotSize: '0.625rem',
  },
};

// ============================================================================
// BADGE COMPONENT
// ============================================================================

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = 'neutral',
      size = 'md',
      dot = false,
      pulse = false,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const reducedMotion = useReducedMotion();
    const styles = variantStyles[variant];
    const sizes = sizeStyles[size];
    
    // Don't pulse if reduced motion is preferred
    const shouldPulse = pulse && !reducedMotion;

    return (
      <motion.span
        ref={ref}
        className={`
          inline-flex items-center gap-${sizes.gap.replace(' ', '')}
          font-sans font-medium tracking-[0.04em]
          ${borderRadius.lg}
          ${className}
        `}
        style={{
          background: styles.background,
          color: styles.color,
          padding: sizes.padding,
          fontSize: sizes.fontSize,
          height: sizes.height,
          border: styles.border || 'none',
        }}
        animate={shouldPulse ? { scale: [1, 1.05, 1] } : {}}
        transition={shouldPulse ? { duration: 2, repeat: Infinity } : {}}
        {...props}
      >
        {dot && (
          <motion.span
            className="flex-shrink-0 rounded-full"
            style={{
              width: sizes.dotSize,
              height: sizes.dotSize,
              background: styles.dotColor,
            }}
            animate={shouldPulse ? { scale: [1, 1.2, 1] } : {}}
            transition={shouldPulse ? { duration: 2, repeat: Infinity } : {}}
          />
        )}
        {children}
      </motion.span>
    );
  }
);

Badge.displayName = 'Badge';

// ============================================================================
// EXPORTS
// ============================================================================

export default Badge;
