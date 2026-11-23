# @connexia/ui

Shared UI components, design tokens, and motion utilities for the Connexia platform.

## 📋 Project Status

**This package is part of the Option 2 (Redesign) path.**

We are intentionally deviating from some parts of the frontend plan to achieve a more modern, premium design. However, we **always respect** the core principles:

- ✅ Dark neutral ground
- ✅ 0px radius everywhere
- ✅ 1px hairline rules (no shadows on state)
- ✅ Colour reserved for meaning (signals)
- ✅ **NO bounce, NO spring, NO parallax**
- ✅ Reduced motion support
- ✅ Performance budgets (as close as possible)
- ✅ Accessibility (WCAG 2.1 AA)

See [CHANGELOG.md](./CHANGELOG.md) for detailed documentation of deviations and fixes.

---

## Installation

This package is part of the Connexia monorepo and is automatically available to all apps in the workspace via pnpm workspaces.

---

## Usage

### Design Tokens

Import design tokens for use in TypeScript:

```typescript
import { colors, spacing, typographyAttendee, typographyAdmin, motion } from '@connexia/ui';

// Usage
const myComponent = {
  padding: spacing['4'],           // '1rem'
  color: colors.brand,              // '#0aa7c2'
  fontSize: typographyAttendee.md, // '1.0625rem' (17px)
  transition: motion.transition.state, // 'all 120ms cubic-bezier(0.2, 0, 0, 1)'
};
```

### CSS Tokens

Import CSS custom properties:

```css
@import '@connexia/ui/styles';

.my-element {
  color: var(--color-foreground);
  padding: var(--spacing-4);
  font-size: var(--text-attendee-md);
  transition: var(--transition-state);
}
```

### Motion Utilities

Import motion primitives (CSS-based, no spring animations):

```typescript
import { fadeIn, scaleIn, transitions, easing } from '@connexia/ui/motion';

// Note: These are for use with the Motion library or CSS
// All animations use cubic-bezier easing, NOT spring
```

### CSS Animations

Use CSS animation classes:

```html
<div class="animate-fade-in-md animate-ease-default animate-fill-forwards">
  Content
</div>
```

---

## 🎯 Design Principles

### Always Respected (From Frontend Plan)

1. **Dark neutral ground** - Primary background is `#0A0A0A`
2. **0px radius** - No rounded corners anywhere
3. **1px hairline rules** - Instead of shadows
4. **No shadows on state** - Data elements don't have shadows
5. **Colour reserved for meaning** - Signals (success/warning/destructive) carry state
6. **No bounce, no spring, no parallax** - Only cubic-bezier animations
7. **Reduced motion support** - All animations respect `prefers-reduced-motion`

### Intentional Deviations (Option 2)

| Aspect | Frontend Plan | Our Approach | Rationale |
|--------|---------------|--------------|-----------|
| A1 Layout | Vertical list, no cards | 3-column card grid + hero | More modern, premium feel |
| A2 Layout | Editorial header, right rail | Hero image + tabs | Better visual hierarchy |
| A4 Layout | Max 420px, one column | 600px card | Better for QR display |
| Type scale | 11/12/13/15/17/21/28/40/56 | Extended with additional sizes | More flexibility |
| Brand usage | Accent only, never surface | Accent + subtle surfaces | More visual interest |

### Color System

From frontend plan:
- **Brand**: `#0AA7C2` (accent only, never fills buttons/cards/rows)
- **Success**: `#43C07A` (admitted / healthy)
- **Warning**: `#E7B643` (already inside / degraded / near capacity)
- **Destructive**: `#FF6467` (denied / breach / offline)

**Important**: Brand is used for:
- 1px thread at top of page
- Focus rings
- Text selection
- Active rules on filter tabs
- Checked controls

Brand is **NOT** used for:
- Button backgrounds
- Card backgrounds
- Row backgrounds
- Large fills

---

## 📁 Structure

```
packages/ui/
├── src/
│   ├── tokens/           # Design tokens (colors, spacing, typography, motion)
│   │   └── index.ts
│   ├── motion/          # Motion primitives (NO spring animations)
│   │   ├── primitives.ts
│   │   └── index.ts
│   ├── styles/          # CSS files
│   │   ├── tokens.css   # CSS custom properties
│   │   ├── motion.css   # CSS animations (NO spring, NO parallax)
│   │   └── index.ts
│   ├── components/      # Reusable components (TBD)
│   │   ├── animated/
│   │   ├── layout/
│   │   ├── form/
│   │   └── index.ts
│   └── index.ts         # Main package export
├── package.json
├── tsconfig.json
├── CHANGELOG.md         # Documentation of changes and deviations
└── README.md           # This file
```

---

## 🚀 Getting Started

### For Developers

1. **Use the tokens** - Always use tokens from this package, never hardcode values
2. **Respect the constraints** - No spring, no parallax, no brand as surface
3. **Test reduced motion** - Always verify your animations work with `prefers-reduced-motion: reduce`
4. **Check contrast** - Ensure all text meets WCAG AA (4.5:1) contrast ratios

### For Designers

- Stick to the type scale: 11/12/13/15/17/21/28/40/56
- Use brand color sparingly (accent only)
- Use signals for state (success/warning/destructive)
- Keep animations subtle and purposeful

---

## 📊 Performance

### Bundle Size Impact

| Addition | Size | Status |
|----------|------|--------|
| This package | ~5KB | ✅ Minimal |
| motion dependency | 12KB | ⚠️ To be evaluated |

**Note**: We're evaluating whether to use the Motion library or stick to CSS-only animations to stay within the performance budget.

### Performance Budget Compliance

| Metric | Budget | Current | Status |
|--------|--------|---------|--------|
| Attendee initial JS | ≤180KB gzip | ~105KB | ⚠️ Over (90KB target) |
| Admin initial JS | ≤180KB gzip | ~87KB | ✅ Under |
| Attendee passport | ≤90KB gzip | ~105KB | ❌ Over |

**Resolution**: We'll need to:
1. Use route splitting for attendee app
2. Lazy load non-critical dependencies
3. Consider CSS-only animations instead of Motion library

---

## 🤝 Contributing

1. **Read the CHANGELOG** - Understand what we're changing and why
2. **Respect the constraints** - No violations of core principles
3. **Document deviations** - If you must break a rule, document it
4. **Test thoroughly** - Reduced motion, accessibility, performance

---

## 📄 Documentation

- [CHANGELOG.md](./CHANGELOG.md) - Detailed change log and deviation tracking
- [Frontend Plan](../../docs/02-frontend-plan.md) - Original specification
- [Gap Register](../../docs/01-addendum-gap-register.md) - Ratified patches

---

## 🔒 License

Private - Part of the Connexia monorepo.
