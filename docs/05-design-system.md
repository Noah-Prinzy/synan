# Synan — Design System

How Synan looks and moves: principles, colour, type, form, motion, identity, components, and the
reference library. Screens are specified in [06-screens.md](06-screens.md).

---

## 1. Principles

These hold on every surface, without exception.

1. **Dark neutral ground.** Dark is the default and the only shipped mode.
2. **Square corners.** Radius is 0 everywhere.
3. **Hairlines, not shadows.** Structure is drawn with 1px rules. State never carries a shadow.
4. **Colour is reserved for meaning.** One brand accent and three signals. The brand colour is never
   a fill — not on a button, a card, a row, or a surface (D-01).
5. **Legibility over decoration.** No gradients on data.
6. **No bounce, no spring, no parallax.** Motion uses cubic-bezier easing only.
7. **Reduced motion is honoured.** Every animation has a `prefers-reduced-motion` path.
8. **Every state is designed.** Each screen declares default, empty, loading, and degraded or offline.
9. **Accessible.** WCAG 2.1 AA contrast; every state carries a glyph and a label as well as a colour.

---

## 2. Surface personalities (D-01)

The three surfaces share type, colour, and the rules above. They differ in density and in how much
layout expression they are allowed.

| | Attendee Portal | Admin Command | Gate Scanner |
| --- | --- | --- | --- |
| Character | A publication: editorial, generous, expressive | An instrument: dense, exact | An instrument: one decision at a time |
| Layout | Hero sections, card grids, tabs, imagery | Tables, rails, hairline panels. No cards as decoration | Viewfinder and one verdict panel |
| Body size | 17px | 13px | Verdict word at 96px |
| Motion | Entrance, stagger, and hover transitions are welcome | State changes only. Live data interpolates; nothing decorates | State changes only |
| Imagery | Allowed | None | None |
| Target | Mobile-first 360–430, deliberate two-column at 1024+ | 1440–1920, one breakpoint at 1280 | Venue-owned Android phone or tablet, one-handed |

The Attendee Portal is where Synan is allowed to feel premium and less generic. Admin and Scanner
are where it must be fast to read under pressure. Neither borrows the other's manner.

### 2.1 Attendee Portal structure: Direction A (D-19)

The Attendee Portal's structure is adapted from the owner's sample site
(`archive/inspiration-clip.mp4`):

| Element | Where it applies |
| --- | --- |
| A visible hairline frame around the page column | Every attendee screen |
| Navigation as a strip of ruled cells | Site header |
| Centred display headline, with a strip of fact cells beneath | A1 Discover hero |
| Cards as ruled cells | A1 event grid |
| A sticky side list that follows the scroll, replacing tabs | A2 Event detail |
| A vertical list whose active item carries a 2px accent rule | A2 schedule by day |
| Options as square chips | A3 registration choices |
| Link columns in ruled cells | Shared footer |

Two things in the sample are **not** taken, because they break §1: saturated colour blocks and
gradients (colour is reserved for meaning), and a continuously scrolling logo strip (no endless
decorative motion). The sample's own identity is never copied (§6).

Type roles on this surface: mono is for data only — dates, counts, identifiers. Labels, navigation,
and buttons use the UI sans in sentence case. Small mono capitals on every label make nothing rank.

**No rule was reopened.** The chosen identity (D-20) needs no change to §1: the ground stays
neutral near-black, the theme stays dark-only, and the accent is never a fill.

---

## 3. Colour

**Source: shadcn preset `b3rmZc8LB2` — nova / neutral / radius none, applied to `apps/attendee` on
2026-11-22.** The values below are the preset's own output, not approximations. Theme only: the preset
also specifies Noto Sans + Geist Mono headings and Phosphor icons, which were not adopted (see §4).

Dark is the default and the only shipped mode; the light block exists because the preset ships it.

```text
:root (light, reference only)          .dark (shipped)
--background  oklch(1 0 0)             --background  oklch(0.145 0 0)   #0A0A0A
--foreground  oklch(0.145 0 0)         --foreground  oklch(0.985 0 0)   #FAFAFA
--card        oklch(1 0 0)             --card        oklch(0.205 0 0)   #171717
--muted       oklch(0.97 0 0)          --muted       oklch(0.269 0 0)   #262626
--muted-fg    oklch(0.556 0 0)         --muted-fg    oklch(0.708 0 0)   #A1A1A1
--border      oklch(0.922 0 0)         --border      oklch(1 0 0 / 10%)
--input       oklch(0.922 0 0)         --input       oklch(1 0 0 / 15%)
--ring        #8AB4FF                    --ring        #8AB4FF
--destructive oklch(0.577 0.245 27.3)  --destructive oklch(0.704 0.191 22.2)  #FF6467
--brand       #8AB4FF                  --brand       #8AB4FF
--radius      0                        --radius      0
```

There is one brand hue, `--brand #8AB4FF`, Daybreak blue (9.5:1 on the ground; chosen under D-20). It is an accent, never a
surface: a 1px thread at the top page edge, focus rings and text selection, the active rule on filter
tabs and the registration stepper, and checked controls. It never fills buttons, cards or rows, never
sets body or link text at rest, and never carries a state — success, warning and stop keep that job. If
the accent starts to read as decoration, remove it; the page should look monochrome at a glance and
blue only where the interface is asking to be touched.

Signals remain the only semantic chroma, added on top of the preset:

```text
--success  #43C07A   admitted / healthy
--warning  #E7B643   already inside / degraded / near capacity
--destructive #FF6467  denied / breach / offline
```

Both are registered in `@theme inline` as `--color-success` and `--color-warning`, so `text-success`,
`bg-warning` and the rest are normal utilities.

Rules carried over unchanged: signal colour never as a large fill on the attendee side; every state also
carries a glyph and a label; a room past `warn_at_pct` fills warn, past `block_at_pct` fills stop with a
hatched cap at 100%.

One exception to the dark ground: the QR field is pure `#FFFFFF` with a `#0A0A0A` finder pattern.
Camera decoding at a gate is not where brand expression belongs, and a dark QR on dark fails in bad
light.

The preset's one leftover defect was fixed on apply: dark `--sidebar-primary` came out as
`oklch(0.488 0.243 264.376)` (a blue) and was neutralised to `oklch(0.922 0 0)`.

The `Paper`, `Mist`, `Teal 500–900` and `Brass` names from the previous palette are retired. Nothing in
the app references a raw value; changing the theme is one file per app.

---

## 4. Type

| Role | Family | Notes |
| --- | --- | --- |
| Display | **Bricolage Grotesque** | screen titles, event names, hero copy, the wordmark. |
| UI | **Instrument Sans** | all controls, labels, tables, body. Sentence case. |
| Data | **Geist Mono** | data only: KPIs, identifiers, timestamps, counts. Tabular by default. |

All three are self-hosted via Fontsource variable packages, exposed as theme tokens
(`--type-display`, `--type-ui`, `--type-data`) and imported once in each app. No font CDN at a cold venue.

The preset proposed Noto Sans with Geist Mono headings and Phosphor icons. Only its **colour and radius**
were taken (`apply --only theme`). Mono headings would have made the admin read as a terminal and cost
the attendee portal its editorial voice; icons stay Lucide at 1.5px to match the hairline rule weight.

Scale: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56, plus 96 for the scanner's verdict word only.
Admin body is 13px. Attendee body is 17px, secondary text 15px. Nothing is set below 11px.
Section eyebrows are set in the UI sans, not mono.

The scale is fixed. The Attendee Portal uses the upper end more freely; it does not add sizes.

---

## 5. Form and motion

**Form.** Radius 0. 1px hairline rules instead of shadow. Spacing on an 8px scale. Grid is 12
columns, with gutters of 24 (attendee) and 16 (admin).

**Motion.**

| Use | Duration | Easing |
| --- | --- | --- |
| State change (hover, focus, toggle) | 120 ms | `cubic-bezier(.2,0,0,1)` |
| Panels, sheets, drawers | 180 ms | `cubic-bezier(.2,0,0,1)` |
| Attendee entrance and stagger | up to 240 ms | `cubic-bezier(.2,0,0,1)` |

- Live data interpolates on `requestAnimationFrame` and never animates through a CSS transition on
  the same property ([02 §9](02-architecture.md)).
- Bars grow with `transform: scaleX`, never `width`.
- No infinite decorative animation, with one exception: the Attendee Portal carries a single, barely perceptible ambient background animation (D-22). It runs on one composited layer, pauses when the tab is hidden, is off under reduced motion, never reduces text contrast, and can be tuned or turned off from one theme token. Admin Command and Gate Scanner have none.
- No animation while the tab is hidden.
- **Motion is spent on feedback, not atmosphere (D-22).** The interface is still by default. Every
  press is acknowledged within one frame. A button that starts work shows progress in place, then
  what happened. A short list of key moments earns a crafted confirmation of 200–400 ms, once,
  never looping, with a light haptic tick on phones. Reduced motion gets the state change without
  the movement.
- **Blue is the colour of interaction and reward (D-22).** Pressed and active states, progress
  inside a working button, the success check, the rule that settles under a completed result,
  active tabs and steps, focus, selection, and link hover all use the accent, the same way
  everywhere, so blue comes to mean "I can act here" or "I just acted". It is still never a
  surface fill and never a state colour.
- **The background carries a touch of blue (D-22).** The ground stays near-black, with a soft,
  low-opacity blue luminance behind the content, tied to the frame and grid. It is atmosphere, not a
  coloured surface: never strong enough to affect text contrast, and tuned from the same theme
  token as the ambient animation.

---

## 6. Identity

**Chosen 2026-11-23 (D-20).** Synan, from the Greek *synántisi*: a meeting, a gathering. The brand
is the host at the door, not the guard: hospitable, warm, modern.

**The mark is "Fit":** a square cut by a single S-shaped seam into two pieces that only make sense
together. The line where they meet spells the initial.

**The wordmark is the "[S]ynan" lockup:** the mark stands in for the S, followed by "ynan" drawn to
match it. It has horizontal and stacked forms, and one-colour white and black versions.

| Part | Rule |
| --- | --- |
| Where it lives | Only in `packages/ui/src/brand/`: the name, the mark, the wordmark, and the icons, all generated from one drawing file, `fit.ts`. All three apps read from it; page titles are filled from it at build time |
| Hand-off files | `packages/ui/src/brand/assets/`: the logo as standalone SVG and PNG, for use outside the product |
| Small sizes | A simplified drawing with a wider seam is used at 24px and below. The wordmark must stay legible at about 16px in a navigation cell |
| Never as decoration | The logo is never tiled, repeated, or used as a pattern, texture, or watermark. It appears once where it has a job: header, footer lockup, pass, sign-in, not-found, favicon, app icon |
| Motion | One 240ms reveal, on first load of the attendee home only. Never on Admin or Scanner |
| Colour | The mark is drawn in the foreground colour with the accent on one piece. The accent is never a fill on interface components (§1) |

Synan took the sample site's **structure**, never its identity: no pixel-art mosaics or mascots, no
orange, yellow, and red block stacks.

Before public launch: a formal trademark search on the name and the mark, and purchase of the
domains.

---

## 7. Component inventory

Four tiers. Tier 1 and 2 live in `packages/ui`; tier 3 lives in each app; tier 4 is per-screen
composition with no reusable shell.

**Tier 1 — primitives (behaviour from Radix, styled with our tokens)**

`Button` (primary / quiet / destructive / ghost), `IconButton`, `Input`, `Textarea`, `Select`,
`Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `SegmentedControl`, `Tabs`, `Stepper`, `Dialog`,
`Sheet` (right drawer), `Popover`, `Tooltip`, `DropdownMenu`, `CommandPalette`, `Toast` + `Toaster`,
`Progress`, `Skeleton`, `Badge`, `Avatar`, `Separator`, `Kbd`, `ScrollArea`.

**Tier 2 — layout and structure**

`AppShell`, `Sidebar`, `TopBar`, `PageHeader` (eyebrow + title + actions), `Section` (numbered
editorial header), `Grid`, `Stack`, `Rail`, `StatusBar`, `Card` → `Panel` (hairline, no shadow),
`EmptyState`, `ErrorState`, `NotFound`, `ErrorBoundary`, `RouteFallback`, `OfflineBadge`,
`VirtualList`, `VisuallyHidden`.

**Tier 3 — data display**

`Table` (dense / comfortable, sticky head, row selection), `TableToolbar`, `ColumnPicker`,
`FilterChips`, `SearchField`, `Pagination`, `KpiCell`, `DeltaBadge`, `Sparkline`, `MiniBar`,
`OccupancyBar`, `CapacityMeter`, `StatusDot`, `ResultChip`, `MonoNumber`, `UidText`, `Timestamp`,
`Duration`, `Timeline`, `LogRow`, `DiffView`, `ChartFrame` (hairline grid, mono axes).

**Tier 3 — domain**

Attendee: `EventIndex`, `EventRow`, `EventHeader`, `SessionList`, `SessionRow`, `OccupancyChip`,
`RegistrationStepper`, `DynamicProfileForm`, `ConsentRow`, `SummaryList`, `QrPass`, `CredentialState`,
`BandRow`, `CredentialActions`, `RevokedOverlay`, `BindTarget`, `BindCode`, `BindResult`,
`AgendaSection`, `AgendaRow`, `NotificationRow`, `ProfileForm`, `PrivacyBlock`, `CredentialSummary`,
`AuthCard`, `OtpInput`.

Admin: `ZoneMap`, `ZonePolygon`, `RoomBlock`, `RoomCard`, `RoomsRail`, `LiveFeed`, `AlertBanner`,
`AlertRail`, `AlertDetail`, `SeverityBar`, `GateHealthRow`, `GateCard`, `QueueBadge`, `ScanFeed`,
`ReadinessChecklist`, `TierMatrix`, `RuleDiff`, `EventWizardStep`, `PassTemplatePreview`,
`ProvisioningConsole`, `BandInventory`, `ColumnMappingPreview`, `BulkActionBar`, `ConfirmCount`,
`WebhookDeliveryRow`, `ReportRow`, `ReportChart`, `ExportJob`, `AuditRow`, `ShiftEditor`,
`AssignmentConflict`, `HandoverSummary`, `SettingsSection`.

Scanner: `VerdictPanel`, `PermittedChips`, `ReasonLine`, `ScannerViewfinder`, `Reticle`,
`ManualUidEntry`, `TorchToggle`, `HapticsToggle`, `LocalTag`, `QueueHeader`, `UndoStrip`,
`ScanHistoryRow`, `GatePicker`, `ShiftRefusal`, `HelpBlock`.

**Tier 4 — screen-specific**

`ResultPanel` is scanner-only and keeps its own treatment: full-bleed ground, 96px verdict word, UID in
mono, a two-second minimum dwell so the operator can read it, and no other interactive element.

Rules: a component earns a tier only when two screens need it; single-use composition stays in the
route file. Every tier-3 component owns its default, empty, loading and error rendering. No component
imports a palette value directly.

The Attendee domain list above was written for the earlier list-based layouts. Screens A1, A2, and
A4 now use the redesigned layouts in [06 §1](06-screens.md); their component names follow what is
built.

---

## 8. Implementation

**Tokens and shared components live in `packages/ui`.** Apps import them; no app declares a palette
value of its own.

| Export | Contents |
| --- | --- |
| `@synan/ui/tokens` | Colour, spacing, type scales (attendee and admin), motion timings |
| `@synan/ui/styles` | The same tokens as CSS custom properties, plus CSS animation classes |
| `@synan/ui/motion` | Motion primitives built on the `motion` library — cubic-bezier only |
| `@synan/ui/components` | Shared components (see below) |

| `@synan/ui/data` | Components that read contract copy, such as `ResultChip` |
| `@synan/ui/brand` | The name, wordmark, mark, and icons (§6) |

Built so far: `Button`, `Input`, `Card`, `Badge`, `Separator`, `AnimatedCounter`, `AnimatedBar`,
`AnimatedUnderline`, `MorphSkeleton`, `ResultChip`. Everything else in §7 is still to build.

**One theme file.** `packages/ui/src/styles/theme.css` is the only place a palette value is
declared. All three apps import it. The neutral values in §3 originally came from shadcn preset
`b3rmZc8LB2` (theme only); the signal colours and the type-scale tokens (`text-11` … `text-56`, and
`text-96` for the scanner verdict) are ours. A change of palette is a change to this one file.

**Fonts** are self-hosted through Fontsource variable packages and imported once in each app's
`index.css`. Nothing loads from a font CDN: a venue with poor connectivity must still render type.

**Icons** are Lucide at 1.5px stroke, matching the hairline weight.

**Behaviour primitives** (dialog, select, tabs, tooltip) come from Radix, styled entirely with our
tokens.

---

## 9. Working method

### 9.1 Design skills

No paid kit is used. These installed skills cover the work:

| Job | Skill |
| --- | --- |
| Brief, sitemap, flows, journey, stories | `product-design:*` |
| System, palette, type, styling | `ui-ux-pro-max-skill:brand`, `:design-system`, `:ui-styling` |
| Composition and originality per screen | `frontend-design:frontend-design` |
| Polish — spacing rhythm, optical alignment, contrast, state completeness | `impeccable:impeccable` |
| QA, accessibility, responsive, alignment, visual regression | `design-review:*` |
| Stakeholder deck | `Presentations:pptx` |
| Verify the running build | `chrome-devtools-mcp:chrome-devtools` |

We take **systems, not recipes**: grid and gutters, type scale, measure in `ch`, hairline rules,
contrast-checked tones, and the do/don't list.

### 9.2 Loop

```text
brief → sitemap → flow-web / flow-mobile → journey
                        ↓
        brand + design-system  (tokens only change here)
                        ↓
   frontend-design, screen by screen, against the skill's anti-pattern list
                        ↓
        impeccable polish → design-qa + accessibility-review
                        ↓
                visual-regression baseline
```

Rules:

- No new colour or size without a token.
- One filled primary action per screen.
- Serif for identity and section titles, mono for numbers, sans for everything interactive.
- Review at 390px and 1440px, always.

---

## 10. Reference library

### 10.1 Use

- **Flow research:** [Page Flows](https://pageflows.com), [Mobbin](https://mobbin.com),
  [Refero](https://refero.design) — real screen sequences, not inspiration grabs.
- **Block structure:** [21st.dev](https://21st.dev), [Preline UI](https://preline.co). Structure only.
- **Behaviour primitives:** [Radix UI](https://www.radix-ui.com) — unstyled dialog, select, tabs,
  tooltip. Adopt for behaviour, style entirely with our tokens.
- **Wordmark:** [Fonts In Use](https://fontsinuse.com), [Another Graphic](https://anothergraphic.org),
  [Typewolf](https://www.typewolf.com). A wordmark comes out of a typeface, not a logo generator.
- **Colour validation:** [Realtime Colors](https://realtimecolors.com) — palette on a real layout.
- **Icons:** [Lucide](https://lucide.dev) — 1.5px stroke, matches the hairline language.
- **Type hosting:** [Fontsource](https://fontsource.org) / [Bunny Fonts](https://fonts.bunny.net) —
  self-host rather than depend on Google's CDN at a cold venue.
- **Presentation:** [Shots](https://shots.so) for device mockups of the pass and command center.

### 10.2 Avoid

Aceternity UI, Magic UI, HeroUI, Mantine, daisyUI, Flowbite, Hover.dev, Motion Primitives, React Bits
Shape Magic, GSAP, Spline, Three.js, Rive, Lottie.

They are built around a rounded, gradient, motion-first aesthetic that breaks §1, and a 60 FPS
operations map cannot share the main thread with decoration. On the Attendee Portal they may be
studied for layout ideas; their code is not imported.

### 10.3 The full collection

The owner's complete collection of design resources — inspiration galleries, component libraries,
design prompts and systems, skills, colour and background tools, animation libraries, icons, fonts,
illustration sources — lives in [design_base.md](design_base.md). It is the toolbox for upgrading the
interface. §10.1 and §10.2 above govern what from it is actually imported into the code.
