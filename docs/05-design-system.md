# Synan — Design System

How Synan looks and moves: principles, colour, type, form, motion, identity, components, and the
reference library. Screens are specified in [06-screens.md](06-screens.md).

---

## 1. Principles

These hold on every surface, without exception.

1. **Neutral ground, dark or light (D-24).** Every app ships a dark and a light theme. Each device
   chooses System (the default, following the device), Light, or Dark. Both are the same brand.
2. **Square corners (D-37).** Radius is 0 on every frame, panel, card, picture, button, field,
   chip, menu, dialog, bar and track. Only things round by nature are round: status dots,
   avatars and radio buttons.
3. **Tone, not lines (D-37).** Nothing is separated by a ruled line. Space separates first, then
   a tonal step (a surface a little lighter or darker than the ground), then type weight. The
   one line allowed is the thin red outline of a field in error; a field's foot also carries a
   2px edge so it can be told from the ground (§5). State never carries a shadow; on the light
   theme a panel may carry a soft depth instead of a tone.
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
| Character | Calm: one statement per screen, generous space; the event page alone is rich | An instrument: dense, exact | An instrument: one decision at a time |
| Layout | A minimal top bar, one centred column, soft tonal panels; the event page opens on its picture | A full-width top bar, the figures in one instrument strip, tonal panels and tables without rules. No cards as decoration | Viewfinder and one verdict panel, in ruled cells (not part of D-37) |
| Body size | 17px | 13px (14px in the top bar) | Verdict word at 96px |
| Motion | Subtle: the living background, pictures fading in once, the reward tick. Text never moves | None at all: state changes are instant. Live data interpolates; nothing animates | State changes only |
| Imagery | The event picture, or the designed no-photo cover | None | None |
| Target | Mobile-first 360–430, deliberate two-column at 1024+ | 1440–1920; a phone layout below 640 | Venue-owned Android phone or tablet, one-handed |

The Attendee Portal is where Synan is allowed to feel premium and less generic. Admin and Scanner
are where it must be fast to read under pressure. Neither borrows the other's manner.

### 2.1 Attendee Portal structure (D-37)

The owner chose this structure from working mock-ups of three directions (D-37). It replaces the
earlier ruled structure (D-19, Direction A), whose hairline frame and ruled cells made the
screens read as confusing ("too many lines").

| Element | Where it applies |
| --- | --- |
| One minimal top bar: the wordmark, two words (Events, My pass), one action (Sign in, or the holder's initials). On a phone: the wordmark, the action and a menu button that opens a full-height menu of large words | Every attendee screen |
| One centred statement in display type, its second sentence in the muted tone, and the thing the person came for right under it | Every screen but the event page |
| The living background (§5) behind the page, calmer under text | Every screen; on the event page, below its picture |
| Events as pictures with their name, place and date set under them on the ground; no card frame | The showcase (A1) |
| The event picture full width (or the designed no-photo cover), the event's name very large between sky and building, a glass card of key facts with the Register action, a small "rooms now" panel, mono capital eyebrows. The top bar lies clear over the picture and turns solid as soon as the page moves | The event page (A2) only |
| Lists as rhythm: rows held apart by space; the current row lifted on a tonal step | Programme, agenda, updates |
| Choices as square tonal chips; the chosen one is ink | Registration choices, filters |
| A quiet footer of two lines of muted words | Every attendee screen |

Type roles on this surface: mono is for data only (dates, counts, identifiers) and for the event
page's eyebrows. Labels, navigation and buttons use the UI sans in sentence case.

The sample site's own identity is never copied (§6), and no endless decorative motion is taken
from any reference beyond the one field.

---

## 3. Colour

**Source: shadcn preset `b3rmZc8LB2` — nova / neutral / radius none, applied to `apps/attendee` on
2026-11-22.** The values below are the preset's own output, not approximations. Theme only: the preset
also specifies Noto Sans + Geist Mono headings and Phosphor icons, which were not adopted (see §4).

There are two themes (D-24). The dark theme is the preset's dark block plus our signals; the light
theme is ours, built to keep the dark theme's hierarchy step for step: a raised surface is lighter
than the ground and a muted one is a step away from it. The preset's own light block is not used.

```text
Token              Dark                              Light
--background       oklch(0.145 0 0)   #0A0A0A        #F7F5F0  warm off-white
--foreground       oklch(0.985 0 0)   #FAFAFA        #121110  near-black, a touch warm
--card, --popover  oklch(0.205 0 0)   #171717        #FFFFFF
--muted            oklch(0.269 0 0)   #262626        #E9E6DF
--muted-foreground oklch(0.708 0 0)   #A1A1A1        #5E5A52
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

**Why the accent deepens in light.** Daybreak blue is too pale to carry text or a focus ring on a
light ground (1.9:1). The light theme uses the identity's light accent, `#2F62D9`, the same hue,
also for the blue of the living background. Signals keep their meanings
and deepen until text in them passes AA on the ground and on their own tints.

There is one brand hue, `--brand`: Daybreak blue `#8AB4FF` (9.5:1 on the dark ground; chosen under
D-20), deepened to `#2F62D9` in the light theme. It is an accent, never a
large fill: focus rings and text selection, the short mark under the current section of a top
bar, the registration stepper's progress, checked boxes, the reward tick, and the blue of the
living background. It never fills buttons, cards or rows, never
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
| `--success-on-tint` | = `--success` | `#136334` | A success word on its own faint tint, such as a "Live now" chip (5.7:1) |
| `--warning-on-tint` | = `--warning` | `#6E4700` | A warning word on its own faint tint, such as a nearly full room |
| `--destructive-on-tint` | `#FF7073` | `#911B21` | A stop word on its own faint tint: a full room, the critical alert cell |
| `--qr-field`, `--qr-ink` | `#FFFFFF`, `#0A0A0A` | the same | The pass QR, black on white in both themes |
| `--scrim` | black at 60% | ink at 32% | Behind dialogs and sheets |
| `--surface` | white at 4.5% | `#FFFFFF` with soft depth | A panel or card |
| `--surface-2`, `--surface-3` | white at 8%, 12% | ink at 5%, 8% | A tonal block (buttons, chips, segmented choices, the avatar), and the same under the pointer |
| `--solid` | `#161616` | `#FFFFFF` | Opaque: menus, dialogs, sheets, the solid top bar |
| `--depth`, `--depth-pop` | none; a deep shadow | soft shadows | The depth under a light panel; under a menu or dialog |
| `--field`, `--field-hover` | white at 6%, 9% | ink at 5%, 8% | A text field, select or text area |
| `--field-edge` | `#767676` | `#77736B` | The 2px edge along a field's foot and round a checkbox (§5) |
| `--glass`, `--glass-ink`, `--glass-ink-2` | ground at 80%, `#F6F5F2`, `#DDDCD7` | ground at 84%, `#121110`, `#45423C` | Frosted ground over an event picture, and the words on it |
| `--field-dot`, `--field-tint` | white, Daybreak | ink, `#2F62D9` | The two colours of the living background |
| `--bg-motion` | 1 | 1 | How fast the living background moves (1 gentle, 0 still) |
| `--focus-width` | 2px | 2px | The square focus ring |
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

**Map colour rules** (Admin Command, D1). The map lies on a still dot grid. Zones are tonal
blocks with a name and floor. A room's fill rises from its floor to show how full it is: neutral
while it has space, a faint warning tint once it passes `warn_at_pct`, a faint stop tint once it
passes `block_at_pct`. Tints stay faint (8–20%) so a full room is noticed without the map shouting, and
every level also carries a word ("Nearly full", "Full") or a shape where the room is too small for
words. The map shows no figures: counts live in the rooms list and the room card. A selected room has a
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
the attendee portal its editorial voice; icons stay Lucide at a 1.5px stroke.

Scale: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56, plus 96 for the scanner's verdict word only,
and the event's name on its own page, which runs from 64 to 184px with the width of the screen.
Admin body is 13px. Attendee body is 17px, secondary text 15px. Nothing is set below 11px.

The scale is fixed. The Attendee Portal uses the upper end more freely; it does not add sizes.

| Role | Set as | Where |
| --- | --- | --- |
| Statement (`type-statement`) | Display 56, 40 on a phone; the second sentence muted | The one statement of an attendee screen; the Command Center's headline |
| Title (`type-title`) | Display 40, 28 on a phone | Screen and section titles |
| Event name (`type-event-name`) | Display 600, 64–184, tight | The event page only |
| Eyebrow (`eyebrow`) | UI sans 13, muted | Above a statement on the attendee side |
| Mono eyebrow (`eyebrow-mono`) | Geist Mono 12, capitals, 0.08em | The event page, and section labels in Admin Command |

---

## 5. Form and motion

**Form.** Radius 0. Tone instead of lines: a panel is a tonal step from the ground (white at
4.5% on dark, white with soft depth on light), a button or chip a stronger step, a menu or dialog
opaque. Spacing on an 8px scale: 64–120px between sections on the attendee side, 24–32px inside a
panel. Grid is 12 columns, with gutters of 24 (attendee) and 16 (admin).

**Controls.** The one filled action on a screen is ink (`--action`); every other button is a
tonal block or quiet words. A field is a tonal block with a 2px edge along its foot in
`--field-edge`: tone alone (about 1.1–1.2:1) cannot tell a field from the ground, and the edge
reaches 3:1 or more against the ground, the field and a panel in both themes (WCAG 2.2, 1.4.11),
while the page as a whole keeps no lines. On focus the field takes a 2px blue frame inside its
edge; in error a thin red outline and a red foot, with a sentence under it. A checkbox is a
tonal square with the same 2px edge; checked, it fills with the accent and the tick is drawn in
the ground colour. A button needs no edge: its words identify it. Focus everywhere is a square
2px accent ring, offset 2px from the control. Every control is 44px tall under a coarse pointer.

**Admin Command layout and density.** The admin's shared page and table parts hold these rules, so
every screen follows them without restating them.

| Element | Rule |
| --- | --- |
| Spacing | 4px base, 8px rhythm. Page gutter 16px on a phone, 24px from 640px, 32px from 1536px |
| Top bar | One full-width solid bar: the wordmark, the event switcher, the sections (the current one ink with a short accent mark), the live gate status in mono, and the account. There is no side rail |
| Page header | One per screen: a 28px display title, one line of context, actions on the right. No screen codes on screen |
| Section head | A mono capital eyebrow and a 13px title, set apart by space. Panel padding 16px in a side column, 20–24px in the main column |
| Figures | The four headline figures sit in one instrument strip: one tonal band, mono figures, a sans note under each |
| Type floor | Body and table cells 13px; labels 12px; 11px only for unit suffixes and the status bar. Figures, times and ids in mono |
| Measure | Prose stops at 68 characters; forms at 40rem |
| Controls | 32px tall for a mouse, 44px under a coarse pointer (touch) |
| Split pages | The side column is 20–26rem and drops below the main column under 1024px |
| Tables | 13px rows, 40px tall (44px for touch); a 36px head in 12px muted words; no row rules: rows are held apart by their height, and the row under the pointer or selected is lifted on a tonal step; numbers in mono, right-aligned; a sticky head. The table scrolls inside its own region; the page never does |
| Actions | At most one filled primary per screen. Row actions are quiet at rest, never a filled button in every row |

**Motion.**

| Use | Duration | Easing |
| --- | --- | --- |
| State change (hover, focus, toggle) | 120 ms | `cubic-bezier(.2,0,0,1)` |
| Panels, sheets, drawers | 180 ms | `cubic-bezier(.2,0,0,1)` |
| Attendee entrance and stagger | up to 240 ms | `cubic-bezier(.2,0,0,1)` |

- Live data interpolates on `requestAnimationFrame` and never animates through a CSS transition on
  the same property ([02 §9](02-architecture.md)).
- Bars grow with `transform: scaleX`, never `width`.
- No infinite decorative animation, with one exception: the Attendee Portal's living background
  (D-37), one full-screen canvas behind the page and below the event page's picture. Whatever it
  draws, the engine that runs it (`packages/ui/src/theme/living.tsx`) holds the rules: no frame
  loop (a timer asks for at most 12 frames a second), paused while the tab is hidden or the
  canvas is off screen, one still frame under reduced motion, a quarter of its strength behind
  the page's words, fields, buttons and the pass card, speed from `--bg-motion`, and loaded after
  the page has painted, in its own chunk, so no screen waits for it and the pass screen's size
  budget does not carry it. A frame loop drawn point by point measured about 20% of a slowed
  phone's main thread, CSS animations of large layers 4–13%, a timer at a few frames a second
  about 1%. Without a scene the ground is plain. Admin Command and the Gate Scanner have none.
  Admin Command has no animation at all: state changes are instant and a check appears already
  drawn.
- No animation while the tab is hidden.
- **Motion is spent on feedback, not atmosphere (D-22).** The interface is still by default. Every
  press is acknowledged within one frame. A button that starts work shows progress in place, then
  what happened. A short list of key moments earns a crafted confirmation of 200–400 ms, once,
  never looping, with a light haptic tick on phones. Reduced motion gets the state change without
  the movement.
- **Blue is the colour of interaction and reward (D-22).** Pressed and active states, progress
  inside a working button, the reward tick, the current section and step, focus, selection, and
  link hover all use the accent, the same way
  everywhere, so blue comes to mean "I can act here" or "I just acted". It is never a large
  fill and never a state colour.
- **The background carries a touch of blue (D-22).** On the Attendee Portal, the living
  background carries the accent in part. It is atmosphere, not a coloured surface, and never
  strong enough to affect text contrast. Admin Command's ground is plain.
- **A disabled button is a quiet tonal block with muted words**, never a grey ink block and never
  an outline. The filled action loses its ink; quiet and danger buttons fade to half strength. A
  disabled button never reacts to the pointer.
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
- `ThemeSwitch` is System · Light · Dark as one segmented tonal block over native radio
  buttons, so the keyboard and screen readers treat it as a labelled radio group. The chosen cell
  is ink with words in the ground colour. On the Gate Scanner it keeps its ruled cells and the
  accent rule under the chosen one. It is 44px tall under a coarse
  pointer. It appears in the attendee footer and account screen, the admin operator menu, and the
  scanner's Help screen.

`Button` (primary / quiet / destructive / ghost), `IconButton`, `Input`, `Textarea`, `Select`,
`Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `SegmentedControl`, `Tabs`, `Stepper`, `Dialog`,
`Sheet` (right drawer), `Popover`, `Tooltip`, `DropdownMenu`, `CommandPalette`, `Toast` + `Toaster`,
`Progress`, `Skeleton`, `Badge`, `Avatar`, `Separator`, `Kbd`, `ScrollArea`.

**Tier 2 — layout and structure**

`AppShell`, `TopBar` with `TopBarCell`, its section links (`topLinkClass`), `Avatar` and menu
ground (`MENU_PANEL`, `MENU_ROW`), `PageHeader` (eyebrow + title + actions), `Section`, `Grid`,
`Stack`, `StatusBar`, `Card` → `Panel` (a tonal step; soft depth on light),
`EmptyState`, `ErrorState`, `NotFound`, `ErrorBoundary`, `RouteFallback`, `OfflineBadge`,
`VirtualList`, `VisuallyHidden`.

**Tier 3 — data display**

`Table` (dense / comfortable, sticky head, row selection), `TableToolbar`, `ColumnPicker`,
`FilterChips`, `SearchField`, `Pagination`, `KpiCell`, `DeltaBadge`, `Sparkline`, `MiniBar`,
`OccupancyBar`, `CapacityMeter`, `StatusDot`, `ResultChip`, `MonoNumber`, `UidText`, `Timestamp`,
`Duration`, `Timeline`, `LogRow`, `DiffView`, `ChartFrame` (a tonal ground, mono axes, no grid lines).

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
| `@synan/ui/shell` | The admin frame: `AppShell`, `TopBar` and its parts, `StatusBar` |
| `@synan/ui/data` | Components that read contract copy, such as `ResultChip`, `KpiCell`, `OccupancyBar`, `CapacityMeter`, `LivePill`, `Sparkline` |
| `@synan/ui/mobile` | Phone behaviour: install, offline, wake lock, keyboard inset, and the build-time plugin that makes the Attendee Portal and the Gate Scanner installable |
| `@synan/ui/brand` | The name, wordmark, mark, and icons (§6) |
| `@synan/ui/theme.css` | The one theme file (below) |
| `@synan/ui/scanner-lines.css` | The Gate Scanner's ruled look: its hairlines, 1px focus ring and top-edge thread, and how the shared controls draw on it. Imported by the scanner only |

**Shared controls.** `Select`, `Field`, `TextInput`, `TextArea`, `Checkbox`, `Dialog`, `Button`,
and `ActionButton` are shared by all three apps, so a control looks and behaves the same
everywhere (§7).

**The theme module** (`packages/ui/src/theme`) is what the apps read and write for the theme
choice: the stored choice, the resolved theme, a `useTheme` hook, the `ThemeSwitch` control, and
`LivingBackground`, the slot that loads the Attendee Portal's living background (§5) after the
page has painted. It keeps in step with the small first-paint script in each app's page (§3).

**One theme file.** `packages/ui/src/styles/theme.css` is the only place a palette value is
declared, for both themes: dark under `:root`, light under `:root[data-theme="light"]`. All three
apps import it. The dark neutral values in §3 originally came from shadcn preset `b3rmZc8LB2`
(theme only); the light values, the signal colours, and the type-scale tokens (`text-11` …
`text-56`, and `text-96` for the scanner verdict) are ours. A change of palette is a change to this
one file.

**Fonts** are self-hosted through Fontsource variable packages and imported once in each app's
`index.css`. Nothing loads from a font CDN: a venue with poor connectivity must still render type.

**Icons** are Lucide at a 1.5px stroke.

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

We take **systems, not recipes**: grid and gutters, type scale, measure in `ch`, tonal steps,
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
- **Icons:** [Lucide](https://lucide.dev) — 1.5px stroke, matches the type's weight.
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
