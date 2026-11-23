/**
 * MorphSkeleton Component
 * 
 * A skeleton loading component that can morph into the actual content.
 * 
 * Features:
 * - Multiple variants: text, circular, rectangular
 * - Multiple sizes
 * - Smooth morph transitions
 * - Respects reduced motion
 * - Uses Connexia design tokens
 * 
 * Compliance:
 * - NO spring animations (per frontend plan §2.3)
 * - Reduced motion support
 * - Performance optimized
 * 
 * Usage:
 *   import { MorphSkeleton } from '@connexia/ui';
 *   
 *   {isLoading ? (
 *     <MorphSkeleton variant="text" width="100%" height="1rem" />
 *   ) : (
 *     <p>Content loaded</p>
 *   )}
 */

import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, spacing, motion as motionTokens, borderRadius } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** MorphSkeleton variants */
export type MorphSkeletonVariant = 'text' | 'circular' | 'rectangular';

/** MorphSkeleton props */
export interface MorphSkeletonProps {
  /** Variant of the skeleton */
  variant?: MorphSkeletonVariant;
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
  /** Size for circular variant */
  size?: string | number;
  /** CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
}

// ============================================================================
// MORPH SKELETON COMPONENT
// ============================================================================

export function MorphSkeleton({
  variant = 'text',
  width = '100%',
  height = '1rem',
  size = '1rem',
  className = '',
  style,
}: MorphSkeletonProps) {
  const reducedMotion = useReducedMotion();
  
  // Skeleton background - subtle, not distracting
  const background = colors.muted.dark;
  const shimmerBackground = 'linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, #ffffff 5%, transparent),
    transparent
  )';
  
  // Common styles
  const commonStyles: React.CSSProperties = {
    background,
    borderRadius: borderRadius.lg,
    ...style,
  };
  
  // Variant-specific styles
  switch (variant) {
    case 'circular':
      return (
        <motion.div
          className={`flex-shrink-0 ${className}`}
          style={{
            ...commonStyles,
            width: size,
            height: size,
            borderRadius: '50%',
          }}
          initial={{ opacity: 0.5 }}
          animate={reducedMotion ? {} : { opacity: [0.5, 0.8, 0.5] }}
          transition={reducedMotion ? {} : { duration: 1.5, repeat: Infinity }}
        />
      );
    
    case 'rectangular':
      return (
        <motion.div
          className={className}
          style={{
            ...commonStyles,
            width,
            height,
          }}
          initial={{ opacity: 0.5 }}
          animate={reducedMotion ? {} : { opacity: [0.5, 0.8, 0.5] }}
          transition={reducedMotion ? {} : { duration: 1.5, repeat: Infinity }}
        />
      );
    
    case 'text':
    default:
      return (
        <motion.div
          className={className}
          style={{
            ...commonStyles,
            width,
            height,
          }}
          initial={{ opacity: 0.5 }}
          animate={reducedMotion ? {} : { opacity: [0.5, 0.8, 0.5] }}
          transition={reducedMotion ? {} : { duration: 1.5, repeat: Infinity }}
        />
      );
  }
}

// ============================================================================
// SKELETON WITH SHIMMER EFFECT
// ============================================================================

export function ShimmerSkeleton({
  variant = 'text',
  width = '100%',
  height = '1rem',
  size = '1rem',
  className = '',
  style,
}: MorphSkeletonProps) {
  const reducedMotion = useReducedMotion();
  
  // Common styles
  const commonStyles: React.CSSProperties = {
    background: colors.muted.dark,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    ...style,
  };
  
  // Shimmer effect
  const shimmer = (
    <motion.div
      className="absolute inset-0"
      style={{
        background: shimmerBackground,
        backgroundSize: '200% 100%',
      }}
      initial={{ x: '-100%' }}
      animate={reducedMotion ? {} : { x: ['-100%', '100%'] }}
      transition={reducedMotion ? {} : { duration: 1.5, repeat: Infinity, ease: 'linear' }}
    />
  );
  
  // Variant-specific styles
  switch (variant) {
    case 'circular':
      return (
        <motion.div
          className={`flex-shrink-0 ${className}`}
          style={{
            ...commonStyles,
            width: size,
            height: size,
            borderRadius: '50%',
          }}
        >
          {shimmer}
        </motion.div>
      );
    
    case 'rectangular':
      return (
        <motion.div
          className={className}
          style={{
            ...commonStyles,
            width,
            height,
          }}
        >
          {shimmer}
        </motion.div>
      );
    
    case 'text':
    default:
      return (
        <motion.div
          className={className}
          style={{
            ...commonStyles,
            width,
            height,
          }}
        >
          {shimmer}
        </motion.div>
      );
  }
}

// ============================================================================
// SKELETON TEXT (for text content)
// ============================================================================

/** Skeleton for text with multiple lines */
export function SkeletonText({
  lines = 1,
  width = '100%',
  className = '',
}: {
  lines?: number;
  width?: string | number;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  
  return (
    <div className={`flex flex-col gap-${spacing['2']} ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <MorphSkeleton
          key={index}
          variant="text"
          width={index === lines - 1 ? '75%' : width}
          height="1rem"
        />
      ))}
    </div>
  );
}

// ============================================================================
// SKELETON CARD (for card content)
// ============================================================================

/** Skeleton for a card */
export function SkeletonCard({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div className={`border border-border ${borderRadius.lg} p-${spacing['4']} ${className}`}>
      <SkeletonText lines={3} />
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default MorphSkeleton;
export { ShimmerSkeleton, SkeletonText, SkeletonCard };
