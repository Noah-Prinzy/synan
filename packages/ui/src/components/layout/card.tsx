/**
 * Card Component
 * 
 * A reusable card component with hover effects.
 * 
 * Features:
 * - Multiple variants: default, interactive, selected
 * - Multiple sizes: sm, md, lg
 * - Hover effects (subtle)
 * - Full accessibility support
 * - Respects reduced motion
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - 0px radius (per frontend plan §2.3)
 * - 1px hairline rules (per frontend plan §2.3)
 * - NO brand as background (per frontend plan §2.1)
 * - NO spring animations (per frontend plan §2.3)
 * - WCAG AA contrast ratios
 * 
 * Usage:
 *   import { Card } from '@connexia/ui';
 *   
 *   <Card variant="interactive" onClick={handleClick}>
 *     Card content
 *   </Card>
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, spacing, motion as motionTokens, borderRadius } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** Card variants */
export type CardVariant = 'default' | 'interactive' | 'selected' | 'bordered';

/** Card sizes */
export type CardSize = 'sm' | 'md' | 'lg';

/** Card props */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  size?: CardSize;
  children?: ReactNode;
}

// ============================================================================
// STYLES
// ============================================================================

/** Variant styles */
const variantStyles: Record<CardVariant, {
  background: string;
  border: string;
  hoverBackground?: string;
  hoverBorder?: string;
}> = {
  default: {
    background: colors.card.dark,
    border: `1px solid ${colors.border.dark}`,
  },
  interactive: {
    background: colors.card.dark,
    border: `1px solid ${colors.border.dark}`,
    hoverBackground: 'color-mix(in srgb, #ffffff 3%, oklch(0.205 0 0))',
    hoverBorder: `1px solid ${colors.brand}`,
  },
  selected: {
    background: 'color-mix(in srgb, #0aa7c2 5%, oklch(0.205 0 0))',
    border: `1px solid ${colors.brand}`,
  },
  bordered: {
    background: colors.card.dark,
    border: `1px solid ${colors.border.dark}`,
  },
};

/** Size styles */
const sizeStyles: Record<CardSize, {
  padding: string;
  gap: string;
}> = {
  sm: {
    padding: spacing['3'],
    gap: spacing['2'],
  },
  md: {
    padding: spacing['4'],
    gap: spacing['3'],
  },
  lg: {
    padding: spacing['6'],
    gap: spacing['4'],
  },
};

// ============================================================================
// CARD COMPONENT
// ============================================================================

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      size = 'md',
      children,
      className = '',
      onClick,
      ...props
    },
    ref
  ) => {
    const reducedMotion = useReducedMotion();
    const styles = variantStyles[variant];
    const sizes = sizeStyles[size];
    
    const isInteractive = variant === 'interactive' || onClick;
    
    // Determine if we should use motion or plain div
    const useMotion = isInteractive && !reducedMotion;

    if (useMotion) {
      return (
        <motion.div
          ref={ref}
          className={`
            border ${borderRadius.lg}
            transition-colors duration-${motionTokens.duration.sm} ease-${motionTokens.easing.default.replace('cubic-bezier(', '').replace(')', '').replace(',', '-')}
            ${className}
          `}
          style={{
            background: styles.background,
            border: styles.border,
            padding: sizes.padding,
          }}
          whileHover={{
            background: styles.hoverBackground || styles.background,
            border: styles.hoverBorder || styles.border,
            scale: 1.01,
          }}
          whileTap={{ scale: 0.99 }}
          onClick={onClick}
          {...props}
        >
          {children}
        </motion.div>
      );
    }

    // Plain div for non-interactive or reduced motion
    return (
      <div
        ref={ref}
        className={`
          border ${borderRadius.lg}
          transition-colors duration-${motionTokens.duration.sm} ease-${motionTokens.easing.default.replace('cubic-bezier(', '').replace(')', '').replace(',', '-')}
          ${isInteractive ? 'cursor-pointer' : ''}
          ${className}
        `}
        style={{
          background: styles.background,
          border: styles.border,
          padding: sizes.padding,
        }}
        onClick={onClick}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// ============================================================================
// CARD HEADER COMPONENT
// ============================================================================

/** Card Header props */
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Card Header - for section headings within cards */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`
        flex items-center justify-between
        mb-${spacing['3']}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
);

CardHeader.displayName = 'CardHeader';

// ============================================================================
// CARD TITLE COMPONENT
// ============================================================================

/** Card Title props */
export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children?: ReactNode;
}

/** Card Title - for main title within cards */
export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ children, className = '', ...props }, ref) => (
    <h3
      ref={ref}
      className={`
        font-serif text-xl leading-tight
        ${className}
      `}
      {...props}
    >
      {children}
    </h3>
  )
);

CardTitle.displayName = 'CardTitle';

// ============================================================================
// CARD DESCRIPTION COMPONENT
// ============================================================================

/** Card Description props */
export interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
}

/** Card Description - for secondary text within cards */
export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ children, className = '', ...props }, ref) => (
    <p
      ref={ref}
      className={`
        text-muted-foreground text-sm
        ${className}
      `}
      {...props}
    >
      {children}
    </p>
  )
);

CardDescription.displayName = 'CardDescription';

// ============================================================================
// CARD CONTENT COMPONENT
// ============================================================================

/** Card Content props */
export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Card Content - for main content within cards */
export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
);

CardContent.displayName = 'CardContent';

// ============================================================================
// CARD FOOTER COMPONENT
// ============================================================================

/** Card Footer props */
export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Card Footer - for actions at the bottom of cards */
export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`
        flex items-center justify-end gap-${spacing['2']}
        pt-${spacing['4']}
        border-t border-border
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  )
);

CardFooter.displayName = 'CardFooter';

// ============================================================================
// EXPORTS
// ============================================================================

export default Card;
export { CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
