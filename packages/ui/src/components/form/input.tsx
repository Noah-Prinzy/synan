/**
 * Input Component
 * 
 * A reusable text input component with proper focus states.
 * 
 * Features:
 * - Multiple sizes: sm, md, lg
 * - Disabled state
 * - Read-only state
 * - Error state
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
 *   import { Input } from '@connexia/ui';
 *   
 *   <Input
 *     placeholder="Enter text"
 *     value={value}
 *     onChange={handleChange}
 *   />
 */

import type { InputHTMLAttributes } from 'react';
import { forwardRef, useState } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, typographyAttendee, spacing, motion as motionTokens, borderRadius } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** Input sizes */
export type InputSize = 'sm' | 'md' | 'lg';

/** Input props */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: InputSize;
  error?: boolean;
  errorMessage?: string;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// ============================================================================
// STYLES
// ============================================================================

/** Size styles */
const sizeStyles: Record<InputSize, {
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
// INPUT COMPONENT
// ============================================================================

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = 'md',
      error = false,
      errorMessage,
      fullWidth = true,
      leftIcon,
      rightIcon,
      disabled,
      className = '',
      ...props
    },
    ref
  ) => {
    const reducedMotion = useReducedMotion();
    const sizes = sizeStyles[size];
    const [isFocused, setIsFocused] = useState(false);
    
    // Determine border color based on state
    const getBorderColor = () => {
      if (error) return colors.destructive.dark;
      if (isFocused) return colors.brand;
      return colors.border.dark;
    };
    
    // Determine background color based on state
    const getBackgroundColor = () => {
      if (disabled) return colors.input.dark;
      return colors.input.dark;
    };

    return (
      <div className={`flex flex-col gap-${spacing['1.5'].replace(' ', '')} ${fullWidth ? 'w-full' : ''}`}>
        <motion.div
          className={`
            relative flex items-center
            border ${borderRadius.lg}
            transition-colors duration-${motionTokens.duration.sm} ease-${motionTokens.easing.default.replace('cubic-bezier(', '').replace(')', '').replace(',', '-')}
            ${error ? 'border-destructive' : 'border-border'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            ${className}
          `}
          style={{
            background: getBackgroundColor(),
            borderColor: getBorderColor(),
            height: sizes.height,
          }}
          whileHover={!disabled && !reducedMotion ? { borderColor: colors.brand } : {}}
        >
          {leftIcon && (
            <div className="flex-shrink-0 pl-${sizes.padding.split(' ')[1].replace('rem', '').replace('px', '')}" style={{ fontSize: sizes.iconSize }}>
              {leftIcon}
            </div>
          )}
          
          <input
            ref={ref}
            type="text"
            disabled={disabled}
            className={`
              w-full h-full
              bg-transparent
              text-foreground
              placeholder:text-muted-foreground
              font-sans font-normal
              border-none outline-none
              focus:outline-none
              ${disabled ? 'cursor-not-allowed' : ''}
            `}
            style={{
              padding: leftIcon || rightIcon ? `0 ${spacing['2']}` : sizes.padding,
              fontSize: sizes.fontSize,
            }}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            {...props}
          />
          
          {rightIcon && (
            <div className="flex-shrink-0 pr-${sizes.padding.split(' ')[1].replace('rem', '').replace('px', '')}" style={{ fontSize: sizes.iconSize }}>
              {rightIcon}
            </div>
          )}
          
          {/* Focus ring - only visible when focused */}
          {isFocused && !reducedMotion && (
            <motion.div
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: motionTokens.duration.sm / 1000 }}
              style={{
                border: `1px solid ${colors.brand}`,
                borderRadius: borderRadius.lg,
              }}
            />
          )}
        </motion.div>
        
        {error && errorMessage && (
          <motion.p
            className="text-destructive text-[0.6875rem] tracking-[0.08em] uppercase"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionTokens.duration.sm / 1000 }}
          >
            {errorMessage}
          </motion.p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// ============================================================================
// EXPORTS
// ============================================================================

export default Input;
