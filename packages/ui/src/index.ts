/**
 * Synan UI Package
 * 
 * Shared UI components, design tokens, and motion utilities for Synan.
 * 
 * Usage:
 *   import { Button, Input, tokens, motion } from '@synan/ui';
 *
 * The apps' palette and type are CSS: `@import "@synan/ui/theme.css"` and "@synan/ui/motion.css".
 */

// Re-export tokens
export * from './tokens';

// Re-export shared components
export * from './components';

// Re-export motion primitives under a namespace to avoid clashing with the
// `motion` timing token exported from './tokens'
export * as motionPrimitives from './motion';

