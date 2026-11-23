# @connexia/ui

Shared UI components, design tokens, and motion utilities for the Connexia platform.

## Installation

This package is part of the Connexia monorepo and is automatically available to all apps in the workspace.

## Usage

### Design Tokens

Import design tokens for use in TypeScript:

```typescript
import { colors, spacing, typographyAttendee, typographyAdmin, motion } from '@connexia/ui';

// Usage
const myComponent = {
  padding: spacing['4'], // 1rem
  color: colors.brand,    // #0aa7c2
  fontSize: typographyAttendee.base, // 1rem
};
```

### CSS Tokens

Import CSS custom properties:

```css
@import '@connexia/ui/styles';

.my-element {
  color: var(--color-foreground);
  padding: var(--spacing-4);
  font-size: var(--text-attendee-base);
  transition: all var(--duration-md) var(--ease-default);
}
```

### Motion Utilities

Import motion primitives:

```typescript
import { motion, fadeIn, scaleIn, transitions, easing } from '@connexia/ui';

function MyComponent() {
  return (
    <motion.div
      initial={fadeIn.initial}
      animate={fadeIn.animate}
      transition={transitions.normal}
    >
      Content
    </motion.div>
  );
}
```

### CSS Animations

Use CSS animation classes:

```html
<div class="animate-fade-in-md animate-ease-default animate-fill-forwards">
  Content
</div>
```

## Structure

```
packages/ui/
├── src/
│   ├── tokens/           # Design tokens (colors, spacing, typography, motion)
│   │   └── index.ts
│   ├── motion/          # Motion primitives and utilities
│   │   ├── primitives.ts
│   │   └── index.ts
│   ├── styles/          # CSS files
│   │   ├── tokens.css   # CSS custom properties
│   │   ├── motion.css   # CSS animations and transitions
│   │   └── index.ts
│   └── index.ts         # Main export
├── package.json
├── tsconfig.json
└── README.md
```

## Design Principles

This package follows the Connexia frontend plan principles:

1. **Dark neutral ground** - Primary background is dark (`#0A0A0A`)
2. **0px radius** - No rounded corners anywhere
3. **1px hairline rules** - Instead of shadows
4. **No gradients on data** - Colour reserved for meaning
5. **Brand as accent** - Teal (`#0AA7C2`) used sparingly
6. **Motion constraints** - 120ms/180ms, cubic-bezier(.2,0,0,1), no bounce/spring/parallax

## Adding Components

To add a new component:

1. Create a new file in `src/components/`
2. Export the component from the appropriate index file
3. Import and use in your app

Example:

```typescript
// src/components/button.tsx
import { motion } from '@connexia/ui/motion';

export function Button({ children }: { children: React.ReactNode }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.button>
  );
}
```

## Reduced Motion Support

All animations respect the `prefers-reduced-motion` media query. When reduced motion is preferred:

- All animations are disabled
- All transitions are instant
- Hover effects are disabled

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Dependencies

- `motion` - Lightweight animation library (~12KB)
- `react` - Peer dependency
- `react-dom` - Peer dependency

## License

Private - Part of the Connexia monorepo.
