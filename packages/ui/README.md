# @synan/ui

Shared design tokens, motion primitives, and components for the Synan apps.

This README covers usage only. The design rules live in
[docs/05-design-system.md](../../docs/05-design-system.md); build status lives in
[docs/07-roadmap.md](../../docs/07-roadmap.md).

## Use

The package is available to every app in the workspace through pnpm.

```ts
// Components
import { Button, Input, Card, Badge, Separator } from "@synan/ui/components";
import { AnimatedCounter, AnimatedBar, AnimatedUnderline, MorphSkeleton } from "@synan/ui/components";

// Tokens
import { colors, spacing, typographyAttendee, typographyAdmin, motion } from "@synan/ui/tokens";

// Motion primitives (cubic-bezier only)
import { fadeIn, scaleIn, transitions, easing } from "@synan/ui/motion";
```

```css
/* Tokens as CSS custom properties, plus animation classes */
@import "@synan/ui/styles";
```

## Layout

```text
src/
  tokens/       Colour, spacing, type scales, motion timings
  styles/       tokens.css, motion.css
  motion/       Motion primitives
  components/   animated/  form/  layout/
  lib/          cn helper
```

## Before adding to this package

Read [docs/05-design-system.md §1](../../docs/05-design-system.md). In short: radius 0, hairlines
instead of shadows, the brand colour never as a fill, cubic-bezier easing only, and a
`prefers-reduced-motion` path for every animation.
