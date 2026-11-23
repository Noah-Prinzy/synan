/**
 * Button Component
 * 
 * A reusable button component with multiple variants.
 * 
 * Features:
 * - Multiple variants: primary, secondary, ghost, destructive, icon
 * - Multiple sizes: sm, md, lg
 * - Disabled state
 * - Loading state
 * - Full accessibility support
 * - Respects reduced motion
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - NO brand as background (per frontend plan §2.1)
 * - NO spring animations (per frontend plan §2.3)
 * - WCAG AA contrast ratios
 * - Reduced motion support
 * 
 * Usage:
 *   import { Button } from '@connexia/ui';
 *   
 *   <Button variant="primary" onClick={handleClick}>
 *     Click me
 *   </Button>
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, typographyAttendee, spacing, motion as motionTokens } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** Button variants */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon';

/** Button sizes */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Button props */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

// ============================================================================
// STYLES
// ============================================================================

/** Variant styles - NO brand as background (compliant with §2.1) */
const variantStyles: Record<ButtonVariant, {
  background: string;
  color: string;
  border: string;
  hoverBackground: string;
  hoverBorder: string;
  hoverColor: string;
  activeBackground: string;
  disabledBackground: string;
  disabledColor: string;
}> = {
  primary: {
    // Uses neutral background with brand border (NOT brand background)
    background: colors.card.dark,
    color: colors.foreground.dark,
    border: `1px solid ${colors.brand}`,
    hoverBackground: 'color-mix(in srgb, #ffffff 5%, oklch(0.205 0 0))',
    hoverBorder: `1px solid color-mix(in srgb, ${colors.brand} 80%, transparent)`,
    hoverColor: colors.foreground.dark,
    activeBackground: 'color-mix(in srgb, #ffffff 3%, oklch(0.205 0 0))',
    disabledBackground: colors.muted.dark,
    disabledColor: colors.mutedForeground.dark,
  },
  secondary: {
    background: 'transparent',
    color: colors.foreground.dark,
    border: `1px solid ${colors.border.dark}`,
    hoverBackground: colors.card.dark,
    hoverBorder: `1px solid ${colors.brand}`,
    hoverColor: colors.brand,
    activeBackground: 'color-mix(in srgb, #ffffff 5%, oklch(0.205 0 0))',
    disabledBackground: 'transparent',
    disabledColor: colors.mutedForeground.dark,
  },
  ghost: {
    background: 'transparent',
    color: colors.mutedForeground.dark,
    border: 'none',
    hoverBackground: colors.card.dark,
    hoverBorder: 'none',
    hoverColor: colors.foreground.dark,
    activeBackground: 'color-mix(in srgb, #ffffff 5%, oklch(0.205 0 0))',
    disabledBackground: 'transparent',
    disabledColor: colors.mutedForeground.dark,
  },
  destructive: {
    background: 'transparent',
    color: colors.destructive.dark,
    border: `1px solid ${colors.destructive.dark}`,
    hoverBackground: 'color-mix(in srgb, ${colors.destructive.dark} 10%, transparent)',
    hoverBorder: `1px solid ${colors.destructive.dark}`,
    hoverColor: colors.destructive.dark,
    activeBackground: 'color-mix(in srgb, ${colors.destructive.dark} 15%, transparent)',
    disabledBackground: 'transparent',
    disabledColor: 'color-mix(in srgb, ${colors.destructive.dark} 50%, transparent)',
  },
  icon: {
    background: 'transparent',
    color: colors.mutedForeground.dark,
    border: 'none',
    hoverBackground: colors.card.dark,
    hoverBorder: 'none',
    hoverColor: colors.foreground.dark,
    activeBackground: 'color-mix(in srgb, #ffffff 5%, oklch(0.205 0 0))',
    disabledBackground: 'transparent',
    disabledColor: colors.mutedForeground.dark,
  },
};

/** Size styles */
const sizeStyles: Record<ButtonSize, {
  padding: string;
  fontSize: string;
  height: string;
  gap: string;
  iconSize: string;
}> = {
  sm: {
    padding: `${spacing['2']} ${spacing['3']}`,
    fontSize: typographyAttendee.xs,
    height: '2rem',
    gap: spacing['1.5'],
    iconSize: '0.875rem',
  },
  md: {
    padding: `${spacing['2.5']} ${spacing['4']}`,
    fontSize: typographyAttendee.sm,
    height: '2.5rem',
    gap: spacing['2'],
    iconSize: '1rem',
  },
  lg: {
    padding: `${spacing['3']} ${spacing['5']}`,
    fontSize: typographyAttendee.base,
    height: '3rem',
    gap: spacing['2.5'],
    iconSize: '1.125rem',
  },
};

// ============================================================================
// SPINNER COMPONENT
// ============================================================================

/** Loading spinner */
function Spinner({ size = '1rem' }: { size?: string }) {
  return (
    <motion.div
      className="flex items-center justify-center"
      animate={{ rotate: 360 }}
      transition={{
        duration: 1,
        ease: 'linear',
        repeat: Infinity,
      }}
      style={{ width: size, height: size }}
    >
      <svg
        className="w-full h-full"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
      </svg>
    </motion.div>
  );
}

// ============================================================================
// BUTTON COMPONENT
// ============================================================================

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const reducedMotion = useReducedMotion();
    const styles = variantStyles[variant];
    const sizes = sizeStyles[size];
    
    // Disable all interactions when loading or disabled
    const isDisabled = disabled || isLoading;
    
    // Reduced motion: disable animations
    const motionProps = reducedMotion
      ? {}
      : {
          whileHover: !isDisabled ? { scale: 1.01 } : {},
          whileTap: !isDisabled ? { scale: 0.99 } : {},
          transition: { duration: motionTokens.duration.sm / 1000, ease: motionTokens.easing.default },
        };

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center gap-${sizes.gap.replace(' ', '')}
          font-sans font-medium tracking-[0.02em]
          border ${styles.border}
          rounded-none
          transition-colors duration-${motionTokens.duration.sm} ease-${motionTokens.easing.default.replace('cubic-bezier(', '').replace(')', '').replace(',', '-')}
          focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1
          disabled:cursor-not-allowed disabled:opacity-50
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        style={{
          background: isDisabled ? styles.disabledBackground : styles.background,
          color: isDisabled ? styles.disabledColor : styles.color,
          padding: sizes.padding,
          fontSize: sizes.fontSize,
          height: sizes.height,
          minWidth: sizes.height,
          outlineColor: colors.brand,
        }}
        onHover={(e) => {
          if (!reducedMotion && !isDisabled) {
            (e.currentTarget as HTMLButtonElement).style.background = styles.hoverBackground;
            (e.currentTarget as HTMLButtonElement).style.border = styles.hoverBorder;
            (e.currentTarget as HTMLButtonElement).style.color = styles.hoverColor;
          }
        }}
        onMouseLeave={(e) => {
          if (!reducedMotion && !isDisabled) {
            (e.currentTarget as HTMLButtonElement).style.background = styles.background;
            (e.currentTarget as HTMLButtonElement).style.border = styles.border;
            (e.currentTarget as HTMLButtonElement).style.color = styles.color;
          }
        }}
        onMouseDown={(e) => {
          if (!reducedMotion && !isDisabled) {
            (e.currentTarget as HTMLButtonElement).style.background = styles.activeBackground;
          }
        }}
        onMouseUp={(e) => {
          if (!reducedMotion && !isDisabled) {
            (e.currentTarget as HTMLButtonElement).style.background = styles.hoverBackground;
          }
        }}
        {...motionProps}
        {...props}
      >
        {isLoading ? (
          <Spinner size={sizes.iconSize} />
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0" style={{ fontSize: sizes.iconSize }}>{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0" style={{ fontSize: sizes.iconSize }}>{rightIcon}</span>}
          </>
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

// ============================================================================
// EXPORTS
// ============================================================================

export default Button;
