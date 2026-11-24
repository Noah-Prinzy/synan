/**
 * Synan UI Components
 * 
 * Export all components from this package.
 */

// Re-export animated components
export * from './animated';

// Re-export layout components
export * from './layout';

// Re-export form components
export * from './form';

// Class-name joiner, for apps composing on top of these components
export { cn, type ClassValue } from '../lib/cn';

// Overlays: dialog
export * from './overlay';

// Shell: frame, top bar, navigation rail, status bar
export * from './shell';

// Data display components that depend on the contracts runtime are NOT re-exported
// here; import them from "@synan/ui/data" (see components/data/index.ts).

// Theme: System / Light / Dark, remembered per device (see ../theme and styles/theme.css)
export * from '../theme';
