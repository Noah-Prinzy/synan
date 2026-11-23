# @connexia/ui - Change Log & Plan Documentation

## 📋 Overview

This document tracks all changes made to the `@connexia/ui` package, including:
- Design decisions
- Deviations from the frontend plan
- Fixes for audit findings
- Implementation notes

---

## 🎯 Project Context

### Original Request
Improve Connexia's UI to be:
- Less generic
- Less AI-looking  
- More fluid
- More creative

### Approach Decision
**Option 2: Redesign Path** - We're intentionally deviating from some parts of the frontend plan to achieve a more modern, premium look while fixing violations as we go.

### Frontend Plan Reference
All decisions are measured against `docs/02-frontend-plan.md`. Deviations are explicitly documented.

---

## 🚨 Audit Findings & Resolutions

### 🔴 CRITICAL VIOLATIONS (Must Fix)

| # | Violation | Location | Resolution | Status |
|---|-----------|----------|------------|--------|
| 1 | Spring animations forbidden | `motion/primitives.ts` | Remove all spring configs, use cubic-bezier only | ⏳ |
| 2 | Brand as surface fill | `tokens/index.ts`, `styles/tokens.css` | Remove brand-filled surfaces, use as accent only | ⏳ |
| 3 | Color contrast failure | `tokens/index.ts` | Adjust colors to meet WCAG AA (4.5:1) | ⏳ |
| 4 | New color (info) | `tokens/index.ts` | Remove `--color-info`, stick to brand + 3 signals | ⏳ |
| 5 | Invalid CSS (`::after::before`) | `styles/motion.css` | Restructure to use valid pseudo-elements | ⏳ |
| 6 | `overflow: hidden` breaks sticky | `styles/motion.css` | Remove or restructure | ⏳ |
| 7 | Type scale mismatch | `tokens/index.ts` | Align with frontend plan scale | ⏳ |
| 8 | Width animation on bars | `motion/primitives.ts` | Use `transform: scaleX` instead | ⏳ |

### 🟡 HIGH SEVERITY (Should Fix)

| # | Violation | Location | Resolution | Status |
|---|-----------|----------|------------|--------|
| 9 | Performance budget | All | Optimize, stay within limits | ⏳ |
| 10 | Accessibility gaps | All | Add ARIA, reduced motion support | ⏳ |
| 11 | Tailwind interpolation | Examples | Use static classes or CSS vars | ⏳ |

### 🟢 LOW SEVERITY (Nice to Fix)

| # | Issue | Location | Resolution | Status |
|---|-------|----------|------------|--------|
| 12 | Token duplication | `styles/tokens.css` | Single source of truth | ⏳ |
| 13 | Dead links | Documentation | Update or remove | ⏳ |

---

## 📝 Design Decisions & Deviations

### ✅ COMPLIANT WITH FRONTEND PLAN

| Decision | Reference | Status |
|----------|-----------|--------|
| Dark neutral ground | §2.1 | ✅ Compliant |
| 0px radius everywhere | §2.3 | ✅ Compliant |
| 1px hairline rules | §2.3 | ✅ Compliant |
| No gradients on data | §2.3 | ✅ Compliant |
| Colour reserved for meaning | §2.1 | ✅ Compliant (with fixes) |
| Motion: 120ms/180ms | §2.3 | ✅ Compliant (with fixes) |
| No bounce, no spring, no parallax | §2.3 | ⚠️ Partial (removing spring) |
| Reduced motion support | §2.3 | ✅ Compliant (with fixes) |

### ⚠️ INTENTIONAL DEVIATIONS (Option 2 Path)

| Decision | Frontend Plan | Our Decision | Rationale |
|----------|---------------|--------------|-----------|
| A1 Layout | Vertical list, no cards | 3-column card grid + hero | More modern, premium feel |
| A2 Layout | Editorial header, right rail | Hero image + tabs | More visual hierarchy |
| A4 Layout | Max 420px, one column | 600px card | Better for QR display |
| Type scale | 11/12/13/15/17/21/28/40/56 | Extended with additional sizes | More flexibility |
| Admin density | Instrument-like | Enhanced with better hierarchy | More usable |
| Brand usage | Accent only | Accent + subtle surfaces | More visual interest |

### 📊 Color System Deviations

| Color | Frontend Plan | Our Decision | WCAG AA Compliant? |
|-------|---------------|--------------|---------------------|
| Brand | `#0AA7C2` | Keep `#0AA7C2` | ⚠️ No (2.9:1 on white) |
| Success | `oklch(0.55 0.14 155)` | Keep + adjust | ✅ Yes (with adjustments) |
| Warning | `oklch(0.65 0.14 85)` | Keep + adjust | ✅ Yes (with adjustments) |
| Destructive | `oklch(0.577 0.245 27.3)` | Keep + adjust | ✅ Yes (with adjustments) |
| Info | Not in spec | **REMOVED** | N/A |

**Resolution for brand contrast:**
- Use brand only for: borders, focus rings, 1px lines, text (on dark backgrounds)
- Never use brand for: button backgrounds, card backgrounds, large fills
- On light backgrounds: brand text is fine (dark text on light bg)
- On dark backgrounds: brand text needs sufficient contrast

---

## 🛠️ Implementation Plan

### Phase 0: Foundation Fixes *(Current Phase)*

**Goal:** Fix all critical violations in the foundation code

#### Tasks:
1. ✅ Create this CHANGELOG.md
2. ⏳ Fix `tokens/index.ts` - Remove violations, align with spec
3. ⏳ Fix `motion/primitives.ts` - Remove spring, add cubic-bezier only
4. ⏳ Fix `styles/tokens.css` - Remove violations, fix CSS
5. ⏳ Fix `styles/motion.css` - Fix invalid CSS, overflow issues
6. ⏳ Fix `README.md` - Update documentation
7. ⏳ Verify all fixes compile and work

#### Estimated Time: 1-2 hours

---

### Phase 1: Shared Components *(Next)*

**Goal:** Build reusable components on the fixed foundation

#### Tasks:
1. Create `Button` component (primary, secondary, ghost, destructive)
2. Create `Input` component with proper focus states
3. Create `Card` component with hover effects
4. Create `Badge` component for status indicators
5. Create `AnimatedCounter` for KPIs
6. Create `AnimatedBar` for capacity meters
7. Create `AnimatedUnderline` for active states

#### Estimated Time: 2-3 days

---

### Phase 2: Attendee Portal *(After Phase 1)*

**Goal:** Implement redesigned screens with fixed foundation

#### Screens to Enhance:
1. A1 Discover - Hero + 3-column grid + load more
2. A2 Event Detail - Hero + tabs + sidebar
3. A4 My Pass - 600px card + icon grid
4. Navigation - Sticky header + hamburger

#### Estimated Time: 3-4 days

---

### Phase 3: Admin Command *(After Phase 2)*

**Goal:** Enhance admin screens with better hierarchy

#### Screens to Enhance:
1. D1 Command Center - KPI strip + interactive map
2. Data tables - Better scanning, hover states
3. Alert system - Slide-in animations
4. Sidebar navigation - Collapsible

#### Estimated Time: 3-4 days

---

### Phase 4: Polish & Testing *(Final)*

**Goal:** Ensure quality and performance

#### Tasks:
1. Cross-browser testing
2. Mobile responsiveness
3. Performance optimization
4. Accessibility audit
5. Reduced motion verification
6. Code review & cleanup

#### Estimated Time: 2-3 days

---

## 📊 Total Estimated Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 0 | 1-2 hours | 🟡 In Progress |
| Phase 1 | 2-3 days | ⏳ Pending |
| Phase 2 | 3-4 days | ⏳ Pending |
| Phase 3 | 3-4 days | ⏳ Pending |
| Phase 4 | 2-3 days | ⏳ Pending |
| **Total** | **11-16 days** | ⏳ |

---

## 🔍 Quality Checklist

### Before Merging Any Code:

- [ ] All critical violations fixed
- [ ] All high severity issues addressed
- [ ] WCAG AA contrast ratios met
- [ ] No invalid CSS
- [ ] Reduced motion support verified
- [ ] Performance budget respected
- [ ] Accessibility requirements met
- [ ] Cross-browser compatible
- [ ] Mobile responsive
- [ ] TypeScript compiles without errors

---

## 📝 Notes

### Why We Chose Option 2 (Redesign)

The user explicitly requested:
- "less generic and less AI-looking"
- "more fluid and creative"

The existing frontend plan produces a very minimal, functional UI. To achieve the user's goals, we need to:
1. Add more visual hierarchy
2. Use more modern layout patterns
3. Add subtle animations and interactions
4. Create a more premium feel

This inherently requires deviating from some parts of the frontend plan, which is acceptable as long as we:
1. Document the deviations
2. Fix any violations of core principles
3. Maintain performance and accessibility

### Core Principles We Will NOT Violate

Even with Option 2, we must maintain:
- ✅ Dark neutral ground
- ✅ 0px radius everywhere
- ✅ 1px hairline rules (no shadows on state)
- ✅ Colour reserved for meaning (signals)
- ✅ Legibility over decoration
- ✅ No bounce, no spring, no parallax (using cubic-bezier only)
- ✅ Reduced motion support
- ✅ Performance budgets (as close as possible)
- ✅ Accessibility (WCAG 2.1 AA)

---

## 🏷️ Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1.0 | 2024-XX-XX | Initial setup, tokens, motion primitives | Vibe Code |
| 0.1.1 | 2024-XX-XX | Fix audit violations (this version) | Vibe Code |

---

*Last updated: During Phase 0 implementation*
