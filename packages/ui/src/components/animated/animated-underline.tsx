/**
 * AnimatedUnderline Component
 * 
 * An animated underline that can be used for active states in navigation, tabs, etc.
 * 
 * Features:
 * - Smooth width transitions
 * - Multiple colors: brand, success, warning, destructive
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
 *   import { AnimatedUnderline } from '@connexia/ui';
 *   
 *   <div className="relative">
 *     <button>Tab 1</button>
 *     <AnimatedUnderline isActive={activeTab === 'tab1'} />
 *   </div>
 */

import { motion } from 'motion/react';
import { useReducedMotion } from '../../motion/primitives';
import { colors, spacing, motion as motionTokens } from '../../tokens';

// ============================================================================
// TYPES
// ============================================================================

/** AnimatedUnderline colors */
export type AnimatedUnderlineColor = 'brand' | 'success' | 'warning' | 'destructive' | 'foreground';

/** AnimatedUnderline props */
export interface AnimatedUnderlineProps {
  /** Whether the underline is active */
  isActive: boolean;
  /** Color of the underline */
  color?: AnimatedUnderlineColor;
  /** Height of the underline */
  height?: string;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

/** Color styles */
const colorStyles: Record<AnimatedUnderlineColor, string> = {
  brand: colors.brand,
  success: colors.success,
  warning: colors.warning,
  destructive: colors.destructive,
  foreground: colors.foreground.dark,
};

// ============================================================================
// ANIMATED UNDERLINE COMPONENT
// ============================================================================

export function AnimatedUnderline({
  isActive,
  color = 'brand',
  height = '2px',
  className = '',
}: AnimatedUnderlineProps) {
  const reducedMotion = useReducedMotion();
  const colorValue = colorStyles[color];
  
  // If not active and reduced motion, just return an empty div
  if (!isActive && reducedMotion) {
    return <div className={className} style={{ height }} />;
  }
  
  // If not active, return empty but with transition
  if (!isActive) {
    return (
      <motion.div
        className={className}
        style={{ height, background: colorValue }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{
          duration: motionTokens.duration.sm / 1000,
          ease: motionTokens.easing.default,
        }}
        transformOrigin="left center"
      />
    );
  }
  
  // Active state
  return (
    <motion.div
      className={className}
      style={{ height, background: colorValue }}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{
        duration: reducedMotion ? 0 : motionTokens.duration.sm / 1000,
        ease: motionTokens.easing.default,
      }}
      transformOrigin="left center"
    />
  );
}

// ============================================================================
// ANIMATED UNDERLINE WITH LAYOUT ID
// For use with Framer Motion's layoutId for shared layout animations
// ============================================================================

export function SharedAnimatedUnderline({
  isActive,
  color = 'brand',
  height = '2px',
  layoutId,
  className = '',
}: AnimatedUnderlineProps & { layoutId: string }) {
  const reducedMotion = useReducedMotion();
  const colorValue = colorStyles[color];
  
  // If reduced motion, just return a static underline
  if (reducedMotion) {
    return (
      <div
        className={className}
        style={{
          height,
          background: isActive ? colorValue : 'transparent',
          width: '100%',
        }}
      />
    );
  }
  
  return (
    <motion.div
      layoutId={layoutId}
      className={className}
      style={{ height, background: colorValue, width: '100%' }}
      initial={false}
      transition={{
        type: 'spring',
        bounce: 0,
        duration: 0.3,
      }}
    />
  );
}

// ============================================================================
// SIMPLE ANIMATED UNDERLINE (CSS-only)
// For cases where we don't need the Motion library
// ============================================================================

export function SimpleAnimatedUnderline({
  isActive,
  color = 'brand',
  height = '2px',
  className = '',
}: AnimatedUnderlineProps) {
  const colorValue = colorStyles[color];
  
  return (
    <div
      className={`transition-transform duration-180 ease-default origin-left ${className}`}
      style={{
        height,
        background: colorValue,
        width: '100%',
        transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
      }}
    />
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AnimatedUnderline;
export { SharedAnimatedUnderline, SimpleAnimatedUnderline };
