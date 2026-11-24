# Synan — Design System

How Synan looks and moves: principles, colour, type, form, motion, identity, components, and the
reference library. Screens are specified in [06-screens.md](06-screens.md).

---

## 1. Principles

These hold on every surface, without exception.

1. **Neutral ground, dark or light (D-24).** Every app ships a dark and a light theme. Each device
   chooses System (the default, following the device), Light, or Dark. Both are the same brand.
2. **Square corners.** Radius is 0 everywhere.
3. **Hairlines, not shadows.** Structure is drawn with 1px rules. State never carries a shadow.
4. **Colour is reserved for meaning.** One brand accent and three signals. The brand colour is never
   a fill — not on a button, a card, a row, or a surface (D-01).
5. **Legibility over decoration.** No gradients on data.
6. **No bounce, no spring, no parallax.** Motion uses cubic-bezier easing only.
7. **Reduced motion is honoured.** Every animation has a `prefers-reduced-motion` path.
8. **Every state is designed.** Each screen declares default, empty, loading, and degraded or offline.
9. **Accessible.** WCAG 2.2 AA, including contrast, in both themes; every state carries a glyph
   and a label as well as a colour.

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
| Target | Mobile-first 360–430, deliberate two-column at 1024+ | 1440–1920; the rail collapses below 1280; a phone layout below 640 | Venue-owned Android phone or tablet, one-handed |

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
neutral (near-black in the dark theme, warm off-white in the light one, D-24), and the accent is
never a fill.

---

## 3. Colour

**Source: shadcn preset `b3rmZc8LB2` — nova / neutral / radius none, applied to `apps/attendee` on
2026-11-22.** The values below are the preset's own output, not approximations. Theme only: the preset
also specifies Noto Sans + Geist Mono headings and Phosphor icons, which were not adopted (see §4).

There are two themes (D-24). The dark theme is the preset's dark block plus our signals; the light
theme is ours, built to keep the dark theme's hierarchy step for step: a raised surface is lighter
than the ground, a muted one is a step away from it, and hairlines are ink at low opacity. The
preset's own light block is not used.

```text
Token              Dark                              Light
--background       oklch(0.145 0 0)   #0A0A0A        #F7F5F0  warm off-white
--foreground       oklch(0.985 0 0)   #FAFAFA        #121110  near-black, a touch warm
--card, --popover  oklch(0.205 0 0)   #171717        #FFFFFF
--muted            oklch(0.269 0 0)   #262626        #E9E6DF
--muted-foreground oklch(0.708 0 0)   #A1A1A1        #5E5A52
--border           oklch(1 0 0 / 10%)                rgb(18 17 16 / 0.12)
--input            oklch(1 0 0 / 15%)                rgb(18 17 16 / 0.22)
--ring             = --brand                         = --brand
--brand            #8AB4FF  Daybreak                 #2F62D9  Daybreak, deepened
--success          #43C07A                           #18753F
--warning          #E7B643                           #8A5A00  ochre
--destructive      #FF6467                           #C0292E
--radius           0                                 0
```

Contrast in the light theme, as measured in `theme.css`:

| Pair | Ratio |
| --- | --- |
| Ink on the ground | 17.3:1 |
| Muted text on the ground / on a card / on muted | 6.3:1 / 6.9:1 / 5.6:1 |
| Accent `#2F62D9` on the ground / on a card | 5.0:1 / 5.4:1 |
| Success, warning, stop as text on the ground | 5.3:1, 5.4:1, 5.4:1 |

**Why the accent deepens in light.** Daybreak blue is too pale to carry text, a focus ring, or a
1px rule on a light ground (1.9:1). The light theme uses the identity's light accent, `#2F62D9`, the
same hue, and keeps Daybreak itself as the tint of the ambient field. Signals keep their meanings
and deepen until text in them passes AA on the ground and on their own tints.

There is one brand hue, `--brand`: Daybreak blue `#8AB4FF` (9.5:1 on the dark ground; chosen under
D-20), deepened to `#2F62D9` in the light theme. It is an accent, never a
surface: a 1px thread at the top page edge, focus rings and text selection, the active rule on filter
tabs and the registration stepper, and checked controls. It never fills buttons, cards or rows, never
sets body or link text at rest, and never carries a state — success, warning and stop keep that job. If
the accent starts to read as decoration, remove it; the page should look monochrome at a glance and
blue only where the interface is asking to be touched.

Signals remain the only semantic chroma, added on top of the preset (values in the table above):
success for admitted and healthy; warning for already inside, degraded, and near capacity;
destructive (stop) for denied, breach, and offline.

They are registered in `@theme inline` as `--color-success`, `--color-warning`, and
`--color-destructive`, so `text-success`, `bg-warning` and the rest are normal utilities.

Further tokens, each with a dark and a light value:

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--action`, `--action-foreground` | ink on ground | ink on ground | The one filled action per screen: neutral, never the brand colour |
| `--destructive-on-action` | `#C0292E` | `#FF8A8C` | A failure word set on the filled action. The fill is the opposite of the ground, so the red is the other theme's (5.6:1 dark, 8.3:1 light) |
| `--warning-on-tint` | = `--warning` | `#6E4700` | A warning word on its own faint tint, such as a nearly full room |
| `--destructive-on-tint` | `#FF7073` | `#911B21` | A stop word on its own faint tint: a full room, the critical alert cell |
| `--qr-field`, `--qr-ink` | `#FFFFFF`, `#0A0A0A` | the same | The pass QR, black on white in both themes |
| `--scrim` | black at 60% | ink at 32% | Behind dialogs and sheets |
| `--ambient`, `--ambient-tint` | 0.06, `--brand` | 0.1, `#8AB4FF` | Strength and colour of the ambient field (§5); 0 turns it off |
| `--hatch-step` | 3px | 3px | Pitch of the hatching on a room's stop cap |
| `--sheen`, `--scrollbar`, `--check-tick` | | | A faint highlight, scrollbar colour, and the checkbox tick drawn in the ground colour |
| `--tap-highlight` | accent at 12% | accent at 12% | The press flash on touch screens |

Rules carried over unchanged: signal colour never as a large fill on the attendee side; every state also
carries a glyph and a label; a room past `warn_at_pct` fills warn, past `block_at_pct` fills stop with a
hatched cap at 100%.

One exception to the ground: the QR field is pure `#FFFFFF` with a `#0A0A0A` finder pattern, in
both themes. Camera decoding at a gate is not where brand expression belongs, and a dark QR on dark
fails in bad light.

**How a theme is chosen.** The choice (System, Light, or Dark) is remembered per device. A small
script in each app's page sets the resolved theme on the page before any style or code loads, so
the wrong theme never flashes; it follows the device's setting and other open tabs from then on.
The browser's own chrome takes the ground colour of the resolved theme. Components never name a
theme: they read tokens.

**Map colour rules** (Admin Command, D1). Zones are faint outlines with a name and floor. A room's
fill rises from its floor to show how full it is: neutral while it has space, a faint warning tint
and border once it passes `warn_at_pct`, a faint stop tint and border once it passes
`block_at_pct`. Tints stay faint (8–20%) so a full room is noticed without the map shouting, and
every level also carries a word ("Nearly full", "Full") or a shape where the room is too small for
words. The map shows no figures: counts live in the rail and the room card. A selected room has a
2px accent frame; a room with an open high or critical alert has a 2px stop frame until it is
acknowledged. Gates are calm when online; colour appears only when a gate needs someone.

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

**Admin Command layout and density.** The admin's shared page and table parts hold these rules, so
every screen follows them without restating them. The hairline and frame rules here are the current
ones; they are under review (O-27) and will change with the owner's reference.

| Element | Rule |
| --- | --- |
| Spacing | 4px base, 8px rhythm. Page gutter 16px on a phone, 24px from 640px, 32px from 1536px |
| Page header | One per screen: a 28px display title, one line of context, actions on the right. No screen codes on screen |
| Section head | A 40px ruled band: a 13px title and a 12px note. Panel padding 16px in a rail, 20px in the main column |
| Type floor | Body and table cells 13px; labels 12px; 11px only for unit suffixes and the status bar. Figures in mono |
| Measure | Prose stops at 68 characters; forms at 40rem |
| Controls | 32px tall for a mouse, 44px under a coarse pointer (touch) |
| Split pages | The side column is 20–26rem and drops below the main column under 1024px |
| Tables | 13px rows, 40px tall (44px for touch); a 36px head in 12px; hairline row rules; numbers in mono, right-aligned; a sticky head. The table scrolls inside its own frame; the page never does. Row hover is a faint lift, never a fill colour |
| Actions | At most one filled primary per screen. Row actions are quiet at rest, never a filled or bordered button in every row |

**Motion.**

| Use | Duration | Easing |
| --- | --- | --- |
| State change (hover, focus, toggle) | 120 ms | `cubic-bezier(.2,0,0,1)` |
| Panels, sheets, drawers | 180 ms | `cubic-bezier(.2,0,0,1)` |
| Attendee entrance and stagger | up to 240 ms | `cubic-bezier(.2,0,0,1)` |

- Live data interpolates on `requestAnimationFrame` and never animates through a CSS transition on
  the same property ([02 §9](02-architecture.md)).
- Bars grow with `transform: scaleX`, never `width`.
- No infinite decorative animation, with one exception: the Attendee Portal carries a single, barely
  perceptible ambient background animation (D-22). The ambient field is one soft Daybreak luminance
  behind the frame, top left, painted as the page's own background rather than as a separate layer,
  so it lies under every piece of content and text keeps its sharpness. On the Attendee Portal it
  drifts 22 × 14 viewport units over 90 seconds, in one-second steps (one repaint a second, no
  layout). On Admin Command it is present but never moves. The Gate Scanner has none. It pauses when
  the tab is hidden, is still under reduced motion, never reduces text contrast, and is tuned or
  turned off from one theme token per theme (`--ambient`, §3).
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
- **The background carries a touch of blue (D-22).** The ground stays neutral, with a soft,
  low-opacity blue luminance behind the content, tied to the frame and grid. It is atmosphere, not a
  coloured surface: never strong enough to affect text contrast, and tuned from the same theme
  token as the ambient animation.
- **A disabled button is a hairline with muted text**, never a grey filled block. The filled action
  loses its fill and keeps a hairline; quiet and danger buttons fade to half strength. A disabled
  button never reacts to hover.
- **Haptics follow a tap.** A device vibrates only in response to something the person just did: a
  short tick (about 12 ms) by default. On the Gate Scanner, staff can turn vibration and sound off
  from the Help screen.
- **Dropdown lists always have an opaque ground** in the current theme. A select with a transparent
  background makes the browser draw its list on white, which hides our light text in the dark theme. The Admin Command uses the shared
  `Select` and no native select. The Attendee Portal keeps native selects on purpose, so phones show
  the system picker, with the ground and option colours stated.

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

`Select`, `Dialog`, `Field`, `TextInput`, `TextArea`, `Checkbox`, `ActionButton`, and `ThemeSwitch`
are written by hand to the same accessibility patterns, without Radix. Moving them onto Radix is
optional and changes no screen.

- `ActionButton` is the button that starts work: it shows progress in place, then what happened,
  with the reward moment and haptic tick of §5.
- `ThemeSwitch` is System · Light · Dark as one row of square ruled cells over native radio
  buttons, so the keyboard and screen readers treat it as a labelled radio group. The chosen cell
  carries the accent rule and its word turns from muted to ink. It is 44px tall under a coarse
  pointer. It appears in the attendee footer and account screen, the admin operator menu, and the
  scanner's Help screen.

`Button` (primary / quiet / destructive / ghost), `IconButton`, `Input`, `Textarea`, `Select`,
`Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `SegmentedControl`, `Tabs`, `Stepper`, `Dialog`,
`Sheet` (right drawer), `Popover`, `Tooltip`, `DropdownMenu`, `CommandPalette`, `Toast` + `Toaster`,
`Progress`, `Skeleton`, `Badge`, `Avatar`, `Separator`, `Kbd`, `ScrollArea`.

**Tier 2 — layout and structure**

`AppShell`, `Sidebar` (built as `NavRail`), `TopBar` with `TopBarCell`, `PageHeader` (eyebrow + title + actions), `Section` (numbered
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

Admin: `KpiStrip`, `ZoneMap`, `ZonePolygon`, `RoomBlock`, `RoomCard`, `RoomsRail`, `LiveFeed`,
`RecountDialog`, `AlertNotice` (the top-bar alert notice and its panel, in place of an alert strip),
`AlertRail`, `AlertDetail`, `SeverityBar`, `GateHealthRow`, `GateCard`, `QueueBadge`, `ScanFeed`,
`SignIn`, `StepUp`, `CodeInput`, `DeskSearch`, `AttendeeCard`, `BindFlow`, `ReplaceFlow`, `DeskCode`,
`ReadinessChecklist`, `TierMatrix`, `RuleDiff`, `EventWizardStep`, `PassTemplatePreview`,
`ProvisioningConsole`, `BandInventory`, `ColumnMappingPreview`, `BulkActionBar`, `ConfirmCount`,
`WebhookDeliveryRow`, `ReportRow`, `ReportChart`, `ExportJob`, `AuditRow`, `ShiftEditor`,
`AssignmentConflict`, `HandoverSummary`, `SettingsSection`.

Scanner: `VerdictPanel`, `PermittedChips`, `ReasonLine`, `ScannerViewfinder`, `Reticle`,
`ManualUidEntry`, `TorchToggle`, `HapticsToggle`, `LocalTag`, `QueueHeader`, `UndoStrip`,
`ScanHistoryRow`, `GatePicker`, `ShiftRefusal`, `HelpBlock`, `EndShift`.

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
| `@synan/ui/components` | Shared components: animated, layout, form controls, the dialog, the shell, and the theme module |
| `@synan/ui/shell` | The admin frame: `AppShell`, `TopBar`, `NavRail`, `StatusBar` |
| `@synan/ui/data` | Components that read contract copy, such as `ResultChip`, `KpiCell`, `OccupancyBar`, `CapacityMeter`, `LivePill`, `Sparkline` |
| `@synan/ui/mobile` | Phone behaviour: install, offline, wake lock, keyboard inset, and the build-time plugin that makes the Attendee Portal and the Gate Scanner installable |
| `@synan/ui/brand` | The name, wordmark, mark, and icons (§6) |
| `@synan/ui/theme.css` | The one theme file (below) |

**Shared controls.** `Select`, `Field`, `TextInput`, `TextArea`, `Checkbox`, `Dialog`, `Button`,
and `ActionButton` are shared by all three apps, so a control looks and behaves the same
everywhere (§7).

**The theme module** (`packages/ui/src/theme`) is what the apps read and write for the theme
choice: the stored choice, the resolved theme, a `useTheme` hook, the `ThemeSwitch` control, and
`AmbientField`, which turns the ambient field on for an app (drifting on the Attendee Portal, still
on Admin Command). It keeps in step with the small first-paint script in each app's page (§3).

**One theme file.** `packages/ui/src/styles/theme.css` is the only place a palette value is
declared, for both themes: dark under `:root`, light under `:root[data-theme="light"]`. All three
apps import it. The dark neutral values in §3 originally came from shadcn preset `b3rmZc8LB2`
(theme only); the light values, the signal colours, and the type-scale tokens (`text-11` …
`text-56`, and `text-96` for the scanner verdict) are ours. A change of palette is a change to this
one file.

**Fonts** are self-hosted through Fontsource variable packages and imported once in each app's
`index.css`. Nothing loads from a font CDN: a venue with poor connectivity must still render type.

**Icons** are Lucide at 1.5px stroke, matching the hairline weight.

**Behaviour primitives** (dialog, select, tabs, tooltip) follow Radix's accessibility patterns,
styled entirely with our tokens. The shared ones are written by hand; adopting Radix itself is
optional (§7).

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
