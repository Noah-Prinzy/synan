/**
 * Connexia UI Package
 * 
 * Shared UI components, design tokens, and motion utilities for Connexia.
 * 
 * This package follows Option 2 (Redesign) path with all audit violations fixed.
 * 
 * Usage:
 *   import { Button, Input, Card, Badge, tokens, motion } from '@connexia/ui';
 *   import '@connexia/ui/styles';
 */

// Re-export tokens
export * from './tokens';

// Re-export motion utilities
export * from './motion';

// Re-export components
export * from './components';

// Re-export styles (CSS import)
import './styles';
