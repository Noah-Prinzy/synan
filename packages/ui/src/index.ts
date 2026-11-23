/**
 * Connexia UI Package
 * 
 * Shared UI components, design tokens, and motion utilities for Connexia.
 * 
 * Usage:
 *   import { Button, Input, tokens, motion } from '@connexia/ui';
 *   import '@connexia/ui/styles';
 */

// Re-export tokens
export * from './tokens';

// Re-export shared components
export * from './components';

// Re-export motion primitives under a namespace to avoid clashing with the
// `motion` timing token exported from './tokens'
export * as motionPrimitives from './motion';

// Re-export styles (CSS import)
import './styles';
