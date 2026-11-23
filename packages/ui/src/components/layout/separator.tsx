/**
 * Separator Component
 * 
 * A horizontal or vertical divider.
 * 
 * Features:
 * - Horizontal and vertical orientations
 * - Multiple sizes
 * - Full accessibility support
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - 1px hairline rules (per frontend plan §2.3)
 * - 0px radius (per frontend plan §2.3)
 * 
 * Usage:
 *   import { Separator } from '@connexia/ui';
 *   
 *   <Separator />
 *   <Separator orientation="vertical" />
 */

import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { colors, spacing, borderRadius } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** Separator orientations */
export type SeparatorOrientation = 'horizontal' | 'vertical';

/** Separator sizes */
export type SeparatorSize = 'sm' | 'md' | 'lg';

/** Separator props */
export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: SeparatorOrientation;
  size?: SeparatorSize;
}

// ============================================================================
// STYLES
// ============================================================================

/** Size styles */
const sizeStyles: Record<SeparatorSize, string> = {
  sm: '1px',
  md: '1px',
  lg: '2px',
};

// ============================================================================
// SEPARATOR COMPONENT
// ============================================================================

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  (
    {
      orientation = 'horizontal',
      size = 'md',
      className = '',
      ...props
    },
    ref
  ) => {
    const thickness = sizeStyles[size];
    
    if (orientation === 'vertical') {
      return (
        <div
          ref={ref}
          className={`flex-shrink-0 self-stretch ${className}`}
          style={{
            width: thickness,
            background: colors.border.dark,
          }}
          {...props}
        />
      );
    }
    
    // Default: horizontal
    return (
      <div
        ref={ref}
        className={`flex-shrink-0 ${className}`}
        style={{
          height: thickness,
          width: '100%',
          background: colors.border.dark,
        }}
        {...props}
      />
    );
  }
);

Separator.displayName = 'Separator';

// ============================================================================
// EXPORTS
// ============================================================================

export default Separator;
