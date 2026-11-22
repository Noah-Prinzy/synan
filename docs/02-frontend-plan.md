# Connexia — Frontend Plan v1.0

Companion to `01-addendum-gap-register.md`. Every `P-nn` reference points at a ratified patch.

---

## 1. Principles

1. **Three surfaces, not two.** Admin Command, Attendee Portal, **Gate Scanner** (P-08). They share a
   design language and a contract package, and nothing else.
2. **Contract-first.** A single Zod schema package defines every REST payload and WS event. The
   frontend builds against it with mocks; the backend is later written to the same file. No hand-written
   duplicate types.
3. **The UI must survive a bad venue.** Every screen declares its empty, loading, degraded, and
   offline states. The scanner is usable with zero network.
4. **Dense where it matters, editorial where it doesn't.** The command center is an instrument; the
   attendee portal is a publication. They share type, colour, and rules — not density.
5. **Legibility over decoration.** Live operational UI: no gradients on data, no rounded cards, no
   shadows on state. Colour is reserved for meaning.

---

## 2. Design system

Honours the locked direction: serif display, the supplied wordmark, square corners. **The ground is
dark and neutral** as of 2026-11-22; the teal-cast palette recorded below is superseded and is kept only
until the shadcn preset lands (§2.1).

**Source systems.** No paid kit. Three free, already-installed skills cover the same ground, and one of
them supplies a palette database already shaped like shadcn variables:

| Skill | Job here |
|---|---|
| `ui-ux-pro-max-skill:design-system` (+ `:design`, `:ui-styling`) | normative system — 85 style specs with implementation checklists, 193 palettes in shadcn variable order (`Primary / Background / Card / Muted / Border / Ring`), type pairing, and a 30-row interface do/don't list |
| `frontend-design` | composition and originality per screen; the anti-generic pass |
| `impeccable` | polish — spacing rhythm, optical alignment, contrast, state completeness |

Supporting free material: `awesome-design-md` and `awesome-claude-design` for design-system documents,
`designprompts.dev` for structured prompts.

We take **systems, not recipes**: grid and gutters, type scale, measure in `ch`, hairline rules,
contrast-checked tones, and the do/don't list. The two surface personalities are expressed with these
skills; nothing in the plan depends on a licensed package.

Surface split survives the palette change: admin and scanner stay dense and instrument-like, the
attendee portal stays editorial and slower. The difference is now density, measure, and type size rather
than hue — which is a stronger separation anyway, because it holds when a theme preset replaces every
colour at once.

### 2.1 Colour

**Source: shadcn preset `b3rmZc8LB2` — nova / neutral / radius none, applied to `apps/attendee` on
2026-11-22.** The values below are the preset's own output, not approximations. Theme only: the preset
also specifies Noto Sans + Geist Mono headings and Phosphor icons, which were not adopted (see §2.2).

Dark is the default and the only shipped mode; the light block exists because the preset ships it.

```
:root (light, reference only)          .dark (shipped)
--background  oklch(1 0 0)             --background  oklch(0.145 0 0)   #0A0A0A
--foreground  oklch(0.145 0 0)         --foreground  oklch(0.985 0 0)   #FAFAFA
--card        oklch(1 0 0)             --card        oklch(0.205 0 0)   #171717
--muted       oklch(0.97 0 0)          --muted       oklch(0.269 0 0)   #262626
--muted-fg    oklch(0.556 0 0)         --muted-fg    oklch(0.708 0 0)   #A1A1A1
--border      oklch(0.922 0 0)         --border      oklch(1 0 0 / 10%)
--input       oklch(0.922 0 0)         --input       oklch(1 0 0 / 15%)
--ring        oklch(0.708 0 0)         --ring        oklch(0.556 0 0)   #737373
--destructive oklch(0.577 0.245 27.3)  --destructive oklch(0.704 0.191 22.2)  #FF6467
--brand       #0AA7C2                  --brand       #0AA7C2
--radius      0                        --radius      0
```

There is one brand hue, and it is not available to the interface. The supplied wordmark carries teal
only in the X (`--brand #0AA7C2`); that is the single chromatic element in the identity and it is never
reused for buttons, links or states. Emphasis everywhere else comes from value contrast, type and rules.
One chromatic accent across a 60-room map would compete with the occupancy states, which are the only
things that should ever attract the eye.

Signals are the only chroma, added on top of the preset:

```
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

### 2.2 Type

| Role | Family | Notes |
|------|--------|-------|
| Display | **Fraunces** 300–600 | screen titles, event names, hero copy. Optical size axis on. |
| UI | **Geist Sans** 400–600 | all controls, tables, body. |
| Data | **JetBrains Mono** 400–600 | KPIs, UIDs, timestamps, coordinates, counts. Tabular by default. |

All three are self-hosted via Fontsource variable packages (`@fontsource-variable/fraunces`, `-geist`,
`-jetbrains-mono`) and imported once in each app's `index.css`. No Google CDN at a cold venue.

The preset proposed Noto Sans with Geist Mono headings and Phosphor icons. Only its **colour and radius**
were taken (`apply --only theme`). Mono headings would have made the admin read as a terminal and cost
the attendee portal its editorial voice; icons stay Lucide at 1.5px to match the hairline rule weight.

Scale: 11 / 12 / 13 / 15 / 17 / 21 / 28 / 40 / 56. Admin body is 13px. Attendee body is 17px.
Section eyebrows: mono, 11px, `+0.14em`, muted-foreground, with an editorial numeral (`01 —`).

### 2.3 Form

Radius **0px** everywhere. 1px hairline rules instead of shadow. Spacing on an 8px scale. Grid is
12 columns, gutters 24 (attendee) / 16 (admin). Admin targets 1440–1920; attendee is mobile-first
360–430 with a deliberate 1024+ two-column layout.

Motion: 120 ms for state, 180 ms for panels, `cubic-bezier(.2,0,0,1)`. No bounce, no spring, no
parallax. Live data interpolates via `requestAnimationFrame` and never animates through CSS transitions
on the same property (P-07).

Identity (**locked 2026-11-22**): the identity is the supplied wordmark, rebuilt as clean vectors — a
geometric sans with the final X set in `--brand`. Two files carry it:

- `apps/attendee/src/brand/wordmark.tsx` — full wordmark, `viewBox="0 0 170 30"`, cap height 20.8 units,
  letters `currentColor`, X upstroke `var(--brand)`. The X deliberately overshoots cap height top and
  bottom; that is part of the mark, not an error.
- `apps/attendee/src/brand/mark.tsx` — the X alone (`viewBox="0 0 34 34"`), used for the favicon
  (`public/favicon.svg`), `icon-512.png`, `apple-touch-icon.png` and the scanner splash.

No second icon, no serif wordmark, no lockup beyond the wordmark itself. On dark ground the letters
render `#FAFAFA`; the original navy is only for print on light stock. Type in the interface is
unchanged: Fraunces for display, Geist for UI, JetBrains Mono for data — the wordmark is an asset, not
a text style.

### 2.4 Component inventory

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

---

## 3. Surfaces & roles

| Surface | Route root | Primary roles | Default device |
|---------|-----------|---------------|----------------|
| Attendee Portal | `/` | Attendee (public + authenticated) | Phone |
| Admin Command | `/admin` | Admin, Organiser | Desktop |
| Gate Scanner | `/scan` | Security Staff | Phone / tablet (PWA) |

Route roots are separate builds, separate bundles, shared `packages/ui` and `packages/contracts`.

---

## 4. Attendee Portal

Editorial, mobile-first, dark neutral. Discovery is public; everything else is authenticated.

### 4.1 Route map

Nine screens plus two infrastructure routes. Everything under `/events/:slug/register` is a subroute so
a half-finished registration survives a refresh and can be re-entered from an emailed link.

| Route | Screen | Auth | Data | Key components |
|---|---|---|---|---|
| `/` | A1 Discover | public | `GET /events?state=published,live` | `Masthead`, `FilterChips`, `EventIndex`, `EventRow`, `CapacityMeter`, `MyPassBar` |
| `/events/:slug` | A2 Event detail | public | `GET /events/:slug`, `stream/telemetry` (public scope) | `EventHeader`, `SessionList`, `SessionRow`, `OccupancyChip`, `StatusPanel` |
| `/events/:slug/register` | A3 → redirect | public | — | redirects to `/identity` |
| `/events/:slug/register/identity` | A3 step 1 | public | — | `RegistrationStepper`, `IdentityForm` |
| `/events/:slug/register/profile` | A3 step 2 | public | `GET /events/:slug/profile-schema` | `DynamicProfileForm`, `ConsentRow` |
| `/events/:slug/register/confirm` | A3 step 3 | public | `POST /users/register` | `SummaryList`, `ConsentRow` |
| `/pass` ★ | A4 My pass | attendee | `GET /me/credential`, `stream/me` | `QrPass`, `CredentialState`, `BandRow`, `CredentialActions`, `RevokedOverlay`, `OfflineBadge` |
| `/pass/pair` | A5 Bind band | attendee | `POST /me/credential/bind`, Web NFC | `BindTarget`, `BindCode`, `BindResult` |
| `/agenda` | A6 Agenda | attendee | `GET /me/sessions`, `stream/telemetry` | `AgendaSection`, `AgendaRow`, `OccupancyChip` |
| `/notifications` | A7 Updates | attendee | `GET /me/notifications` | `NotificationRow`, `EmptyState` |
| `/account` | A8 Account | attendee | `PATCH /users/:id/profile` | `ProfileForm`, `CredentialSummary`, `PrivacyBlock`, `Dialog` |
| `/sign-in`, `/verify` | A9 Auth | public | `POST /auth/login`, `POST /auth/verify` | `AuthCard`, `OtpInput` |
| `/offline` | Shell | — | service worker | `OfflineBadge`, cached pass |
| `*` | 404 | — | — | `NotFound` |

### 4.2 Screens

**A1 · Discover `/`**
Full-bleed masthead built on the locked wordmark (§2.3) over a hairline rule, one-line premise, then a
vertical list of events —
date on the left in mono, title in Fraunces 28, venue + city beneath, a thin live/capacity line on the
right. Filters as a single horizontal rule of text toggles (All · Live · Upcoming · Near me). No cards,
no images in v1. Sticky bottom bar: `My pass`.

States: empty (no published events), loading (three hairline skeletons), error (offline copy with retry).

**A2 · Event detail `/events/:slug`**
Editorial header: event title, date + local timezone label, venue, one-paragraph description. Below, a
schedule list grouped by day; each session row shows room, time, and a live occupancy chip (`62%` in
mono, warn/stop colour past thresholds). Right rail on ≥1024: `Your status` panel — not registered /
registered / checked in, with the CTA. If the event is `closed`, the CTA becomes `View your pass`.

**A3 · Registration `/events/:slug/register`**
Three steps with a hairline stepper: **Identity → Profile → Confirm**.
- Identity: full name, email, phone (optional).
- Profile: event-defined fields from `profile_jsonb` — rendered from a schema-driven form (text, select,
  multi-select, consent checkbox). Consent for zone presence is a separate, unticked-by-default row with
  a plain-language explanation and a `what we store` disclosure (P-12).
- Confirm: summary, `Send my pass` primary action.
Success replaces the step body with an inline confirmation and moves to A4. Failure keeps the user in
place with field-level errors; a duplicate email routes to sign-in instead of erroring.

**A4 · My pass `/pass` ★**
The single most important attendee screen. One column, centred, max 420:
- Credential state verbatim: `READY` / `NOT YET BOUND` / `REVOKED` / `REPLACED`.
- QR rendered at 280px on pure white with a 1px ink frame and the attendee's name + tier beneath in mono.
- Wristband row: `Bound · uid 04A2…9F` with a green dot, or `Not bound — bind at the desk` with the
  nearest desk location.
- Actions as a hairline list: `Add to Wallet`, `Email me a copy`, `Brightness up` (forces max brightness
  while the pass is shown — needed at real gates).
- Live region: if the credential is revoked while the screen is open, the QR is replaced in place by a
  stop-coloured panel. This is driven by `stream/me` (P-16).

Offline: the QR still renders from cache; a quiet `Offline — pass remains valid` line appears.

**A5 · Bind wristband `/pass/pair`**
Two modes in one screen: **Tap** (Web NFC, Android Chrome) — a pulsing target area, reads the UID, shows
it in mono, confirm. **Desk code** — 6-character code from the provisioning clerk. On success, a
confirmation panel with the band UID and a `this band is now you` line. Failure states are explicit:
`Already bound to another attendee` (with a `get help` action), `Unknown band`, `NFC unavailable on this
device → use the desk`.

**A6 · My agenda `/agenda`**
Chronological list of the attendee's sessions, grouped `Now · Next · Later`. Each row: time (mono), title,
room, and a live `space left` indicator sourced from telemetry. `Now` rows get a 2px foreground left rule.
Tapping opens the event detail scrolled to the session.

**A7 · Notifications `/notifications`**
Chronological feed: room at capacity, schedule change, credential update, event-wide announcements.
Unread uses a 2px foreground left rule. Empty state: `Nothing yet — we'll only message you when it matters.`

**A8 · Account `/account`**
Sections as hairline blocks: Profile (editable JSONB fields), Credentials (active credential, band UID,
`report lost band`), Privacy (`what we store`, retention window, `export my data`, `delete my data`),
Sign out.

**A9 · Auth `/sign-in`, `/verify`**
Email-only. Single field, `Email me a link`. `/verify` handles the token, shows a 3-second confirmation,
then routes to `/pass`. No password anywhere on the attendee side.

---

## 5. Admin Command

Neutral dark, one step deeper than the attendee portal. Desktop-first, 1440 target, dense 13px. Every
screen assumes a wall display is watching and a phone is in the operator's hand.

### 5.1 Route map

Sixteen routes, but only six top-level ideas: watch, configure, people, access, response, records. Event
workspace tabs are real subroutes so an operator can send `…/events/:id/rooms` in a chat and it lands
correctly on a shift handover.

| Route | Screen | Role | Data | Key components |
|---|---|---|---|---|
| `/admin/sign-in` | — | public | `POST /auth/login` | `AuthCard` |
| `/admin/setup` | First run | org admin | `POST /organizations`, `POST /venues` | `Stepper`, `OrganizationForm`, `VenueForm` |
| `/admin` ★ | D1 Command Center | admin, organiser | `stream/telemetry`, `stream/alerts`, `GET /dashboard` | `KpiStrip`, `ZoneMap`, `RoomsRail`, `LiveFeed`, `AlertBanner` |
| `/admin/venues` | D2 Venues | admin | `GET /venues` | `Table`, `TableToolbar` |
| `/admin/venues/new` | D2b New venue | admin | `POST /venues` | `VenueForm` |
| `/admin/venues/:id` | D3 Spatial editor | admin | `GET /venues/:id`, `PUT /zones`, `PUT /rooms/:id` | `ZoneMap`, `ZonePolygon`, `RoomBlock`, `Sheet`, `DiffView` |
| `/admin/events` | D4 Events | admin, organiser | `GET /events` | `Table`, `FilterChips`, `Badge` |
| `/admin/events/new` (+`/:step`) | D5 Wizard | admin, organiser | draft endpoints | `Stepper`, `ReadinessChecklist`, `TierMatrix`, `PassTemplatePreview` |
| `/admin/events/:id/overview` | D6.1 | both | `GET /events/:id/summary` | `KpiStrip`, `ReadinessChecklist` |
| `/admin/events/:id/schedule` | D6.2 | both | `GET /events/:id/sessions` | `SessionList`, `Dialog`, `Timestamp` |
| `/admin/events/:id/rooms` | D6.3 | admin | `GET · PUT /events/:id/access-rules` | `TierMatrix`, `RuleDiff`, `DiffView` |
| `/admin/events/:id/attendees` | D6.4 | both | scoped `GET /attendees` | `Table`, `TableToolbar`, `BulkActionBar` |
| `/admin/events/:id/credentials` | D6.5 | both | scoped `GET /credentials` | `BandInventory`, `ProvisioningConsole` |
| `/admin/events/:id/staff` | D6.6 | admin | `GET /staff-assignments` | `ShiftEditor`, `AssignmentConflict`, `HandoverSummary` |
| `/admin/events/:id/reports` | D6.7 | both | `GET /reports?eventId=` | `ReportRow`, `ExportJob`, `ReportChart` |
| `/admin/events/:id/settings` | D6.8 | admin | `PATCH /events/:id` | `SettingsSection`, `Dialog` (danger zone) |
| `/admin/attendees` | D7 Attendees | both | `GET /attendees` | `Table`, `Sheet`, `BulkActionBar`, `ConfirmCount` |
| `/admin/credentials` | D8 Provisioning | both | `GET /credentials/inventory` | `BandInventory`, `ProvisioningConsole`, `ColumnMappingPreview` |
| `/admin/access-log` | D9 Access log | both | `GET /scans` (paged), `stream/scans` | `VirtualList`, `LogRow`, `ResultChip`, `SearchField` |
| `/admin/alerts` | D10 Alerts | both | `GET /breach-alerts`, `stream/alerts` | `AlertRail`, `SeverityBar`, `AlertDetail`, `WebhookDeliveryRow` |
| `/admin/staff` | D11 Staff | admin | `GET /staff` | `Table`, `ShiftEditor`, `AssignmentConflict` |
| `/admin/gates` | D12 Gate health | both | `stream/scans`, `GET /checkpoints` | `GateCard`, `GateHealthRow`, `Sparkline`, `QueueBadge` |
| `/admin/gates/:id` | D12b Gate detail | both | `GET /checkpoints/:id/scans` | `GateHeader`, `ScanFeed`, `Sparkline`, `Table` |
| `/admin/reports` | D13 Reports | both | `GET /reports` | `ReportRow`, `ExportJob`, `Table` |
| `/admin/reports/:eventId` | D13b Event report | both | `GET /reports/:eventId`, `GET /reports/:eventId/:kind` | `ReportChart`, `ChartFrame`, `ExportJob`, `Tabs` |
| `/admin/settings` (+`/:tab` = org · email · integrations · retention · audit · keys) | D14 Settings | admin | various | `SettingsSection`, `WebhookDeliveryRow`, `AuditRow` |
| `*` | 404 | — | — | `NotFound` |

Deep-link conventions: `?attendee=:id` and `?alert=:id` open the detail sheet over the list, so a
pasted link resolves to the same row rather than a bare table. Filters and search live in the URL.

### 5.2 Chrome

Persistent top bar: wordmark, event selector (the global context for every screen), a live pill
(`● LIVE 4 Hz` / `RECONNECTING` / `OFFLINE`), venue-local clock, shift label, operator menu.
A second, thinner strip carries **only** alert banners — the highest open severity, one line, with
`Acknowledge` and `Open`. Status bar at the bottom: WS latency, last snapshot age, queue depth across
gates.

### 5.3 Screens

**D0 · First run `/admin/setup`**
Only reachable while the organization has no published venue. Three steps: Organization (name, timezone,
support email) → Venue (name, city, floors) → Done. It writes the org and seeds one venue, then hands off
to D5. Skipped permanently once a venue exists.

**D1 · Command Center `/admin` ★**
The hero screen. Layout: 12 columns.
- **KPI strip** (5 cells, hairline dividers, mono numerals 40px, delta + sparkline beneath):
  Registered · Checked in · On site now · Capacity risk (rooms over warn) · Open alerts.
- **Main (8 cols): `MapCanvas`** — zones as polygons on the venue floor, rooms as inert blocks with an
  occupancy bar at the bottom edge and a mono count. Colour by threshold. Hover reveals a room card;
  click drills into the room. Panels animate only via interpolation.
- **Right rail (4 cols):** `Rooms` list sorted by utilisation descending (name, count/capacity, bar,
  three-state dot); below it `Live feed` — the last 12 events (scan, alert, gate status) in a compact
  timeline with mono timestamps.
- **Alert treatment:** critical alerts also flash the top strip and the offending room outline, then
  settle. Acknowledge is always one click; resolution lives in D8.

Degraded states are designed, not incidental: each gate in the rail shows `offline 4m · 182 queued`
(P-09); the live pill changes to amber; the map dims to `last known` with a timestamp watermark.

**D2 · Venues `/admin/venues`**
Table of venues: name, city, rooms, capacity, active events. Single primary action `New venue`.

**D2b · New venue `/admin/venues/new`**
Name, city, IANA timezone, floors, optional capacity default. Creating an empty venue routes straight into
D3 so a venue is never left with zero zones; `Cancel` returns to the list with the draft kept in local
storage for the session.

**D3 · Spatial editor `/admin/venues/:id`**
Canvas with the floor plan as an underlay. Zones list on the left (add, rename, drag to reorder by floor).
Rooms as drawable rectangles bound to a zone, each with capacity + warn/block thresholds in a right
sheet. This is the only screen with a drawing mode; it has an explicit `Edit layout` toggle so the
viewport stays inert day to day. Changes are drafts until `Publish layout`.

**D4 · Events `/admin/events`**
Table: title, venue, dates (event-local), state chip, registrations, last edited. Filter by state.
Row action `Duplicate` is prominent — most events are repeats.

**D5 · Event wizard `/admin/events/new`**
Five steps: `Basics → Venue & rooms → Access rules → Pass template → Review`. Guarded publish (P-13):
the final step disables `Publish` and lists unmet requirements inline. Every step is resumable; the
wizard writes a draft on each step.

**D6 · Event workspace `/admin/events/:id`**
Tabs: Overview · Schedule · Rooms & rules · Attendees · Credentials · Staff · Reports · Settings.
- *Overview:* the same KPI strip scoped to the event, plus readiness checklist (rooms set, pass template
  live, email domain verified, staff assigned).
- *Rooms & rules:* a matrix of tier × room with permit/deny cells (P-04). Changes show a diff and a
  `republish rules` action, because silently changing access mid-event is dangerous.
- *Settings:* timezone, capacity policy overrides, retention, danger zone (close / archive).

**D7 · Attendees `/admin/attendees`**
Dense table: name, email, tier, state, credential state, band UID (mono, truncated), last scan. Filters:
tier, credential state, not-yet-bound, breached. Row opens a right `Sheet`: profile JSONB fields, full
scan history, actions `Resend pass`, `Revoke credential`, `Rebind band`, `View audit`. Bulk select
supports `Export CSV` and `Resend passes` (rate-limited with a confirm dialog showing the count).

**D8 · Wristbands & provisioning `/admin/credentials`**
Two panes. Left: inventory counts by state (`stock / assigned / bound / active / lost / retired`) as
large mono numerals. Right: the provisioning console — scan band, paste or scan a registration ID, verify
identity against the sheet (name + photo if present), then `Bind`. Explicit replacement flow: pick the
lost band, pick the new one, confirm — old credential revoked, new bound, audit entry written (P-10).
Bulk import lives here as a secondary action with a column-mapping preview.

**D9 · Access log `/admin/access-log`**
A virtualised, searchable stream. Columns: time (mono, ms), checkpoint, credential (truncated UID +
tier), result chip, latency. Result vocabulary is fixed: `admitted · already_inside · duplicate_read ·
denied_room · capacity_block · revoked · unknown_token · offline_queued`. Filters by result, gate,
room, and a credential search. Sticky detail row on click. Export defers to the report job (P-14).

**D10 · Security alerts `/admin/alerts`**
Inbox with severity bands (`critical / high / low`). Each row: kind, zone/room, time, age, state
(`open / acked / resolved`), assignee. Detail sheet shows the triggering scan, the credential, the rule
that fired, and a resolution note field. Resolution is required before an alert leaves the list.
A separate tab shows webhook delivery attempts with status codes and retry state.

**D11 · Staff & shifts `/admin/staff`**
Table of staff: name, role, assigned checkpoint, shift window, last active, device. Invite flow by email.
Assignment is a two-field editor (checkpoint + shift); overlapping assignments are rejected inline.
`Handover` action ends a shift and prints the queued-scan summary. Roles matrix (Admin / Organiser /
Security Staff) shown read-only for the current plan.

**D12 · Gate health `/admin/gates`**
Every checkpoint as a row: label, direction, hardware ID, link state, heartbeat age, queue depth,
last scan, throughput (last 15 min as a sparkline). A card per gate for the wall display, sorted
faults-first. This is where "gate 3 is offline" gets escalated.

**D12b · Gate detail `/admin/gates/:id`**
One checkpoint: hardware ID, direction, link history for the shift, throughput by 5-minute bucket, failure
breakdown by result code, last 50 scans, currently assigned staff. Actions: `Reassign`, `Mark for
maintenance`, `Test read` (a synthetic scan that is not logged as attendance).
List of generated reports with kind, event, state (`queued / running / ready / failed`), and download.
Event report view has tabs per report type; charts are drawn with the same tokens (hairline grid, mono
axes, no fills except one accent). `Export` starts the async job and shows progress (P-14).

**D14 · Settings `/admin/settings`**
Sections: Organization, Email (sending domain, delivery health, pass template preview with a live sample),
Integrations & Webhooks (endpoints, signing secret, delivery log), Retention & Privacy (windows per data
class, DSAR queue), Audit log, API keys.

---

## 6. Gate Scanner

Installable PWA. Must be operable one-handed, in the dark, by a temp staffer with 30 seconds of training.

### 6.1 Route map

Five routes. The scanner never nests deeper than one level, because a staffer two days into the job must
be able to get back to the viewfinder with one tap from anywhere.

| Route | Screen | Auth | Data | Key components |
|---|---|---|---|---|
| `/scan/pair` | S1 Choose gate | staff | `GET /me/assignments` | `GatePicker`, `ShiftRefusal` |
| `/scan` ★ | S2 Scan | staff | `POST /scans`, `stream/scans` fallback | `ScannerViewfinder`, `Reticle`, `VerdictPanel`, `PermittedChips`, `ReasonLine`, `LocalTag`, `QueueHeader`, `ManualUidEntry`, `TorchToggle`, `HapticsToggle` |
| `/scan/recent` | S3 Recent | staff | local store, then `GET /scans?checkpoint=` | `ScanHistoryRow`, `UndoStrip`, `ResultChip` |
| `/scan/queue` | S4 Offline queue | staff | local queue | `QueueSummary`, `QueueHeader`, `Dialog` (retry confirmation) |
| `/scan/help` | S5 Reference | staff | static | `HelpBlock` |

Shift end is a `Dialog` over `/scan`, not a route: it summarises admitted / refused / queued counts and
confirms handover before the device locks.

### 6.2 Screens

**S1 · Pair `/scan/pair`**
`Scan the gate code` (camera) or pick from a list filtered to the staff member's assignments for the
current shift (P-15). Shows shift window and event name. Refuses gates outside the shift with a plain
reason.

**S2 · Scan `/scan` ★**
- Viewfinder dominates the top 60%. A thin foreground reticle; no chrome.
- Below: the verdict panel. Persistent last-result until replaced, minimum 2 s dwell.
  - `ADMITTED` — go colour, name, tier, rooms permitted (chips).
  - `ALREADY INSIDE` — warn, name, room, `last in 4m ago`.
  - `DENIED` — stop, reason code in words (`Restricted room`, `Capacity reached`, `Band revoked`,
    `Unknown band`), name if known, and `Call supervisor`.
- Haptics + distinct tones per verdict (site-configurable, default on).
- `123` (manual UID) and `NFC` toggles in thumb reach. Torch toggle at the top right.
- Offline: the verdict panel gains a `LOCAL` tag and the count of queued scans appears in the header.
  Verdicts are still instant (P-09).

**S3 · Recent `/scan/recent`**
Last 50 scans with result chips and a 60-second `Undo` on admission errors only (writes a correction
record; never deletes). Synced/unsynced marker per row.

**S4 · Queue `/scan/queue`**
Pending sync count, oldest age, per-result breakdown, `Retry now`, and a hard warning if the allowlist
is stale beyond the fail-open window (P-09).

**S5 · Help `/scan/help`**
One screen: what green/amber/red mean, when to call a supervisor, how to switch gates, how to end a
shift. No nested navigation.

---

## 7. Shared contract package

```
packages/contracts/
  src/rest/          zod schemas per endpoint → inferred TS types
  src/ws/            discriminated unions per channel event
  src/enums/         ScanResult, AlertKind, Severity, CredentialState, CarrierState, EventState
  src/errors/        canonical error codes + human strings (single source for UI copy)
```

Rules:
- UI copy for result and error states is imported from `src/errors`, never retyped per screen. A new
  server result code becomes a type error until the UI handles it.
- `packages/contracts` is the only place a payload shape is declared. Backend imports it directly.
- Versioned by git tag; schema changes are a breaking change for all three apps.

---

## 8. Mock-first data strategy

Until the backend exists, all three apps run against a deterministic mock layer:

- **REST:** MSW handlers built from the same Zod schemas, backed by seeded fixtures (2 venues, 60 rooms,
  1,400 attendees, 40k scans).
- **WS:** `MockRealtime` implementing the same client interface as the real socket, able to replay named
  scenarios: `doors_open` (burst of 40/s), `capacity_overflow`, `breach_restricted_room`,
  `gate_offline`, `credential_revoked_mid_pass`.
- **Time:** a controllable clock so event states and retention windows are testable.

Scenario names are used in the demo script and in acceptance tests, so "show me a breach" is one click.

---

## 9. Performance budget (P-07, P-17)

| Metric | Budget |
|--------|--------|
| Admin map, 60 rooms, 4 Hz deltas | ≥55 FPS sustained |
| Telemetry ingest | ≤4 Hz per channel, coalesced 250 ms |
| Scan verdict render | <16 ms after local decision |
| Admin initial JS (route-split) | ≤180 KB gzip per surface |
| Attendee passport screen | ≤90 KB gzip, first paint <1.2 s on 4G |
| Scanner first interactive | <1.5 s, fully usable offline thereafter |

Implementation notes: occupancy bars animate with `transform: scaleX`, not width. The map is a canvas
(or SVG for ≤80 rooms) with `requestAnimationFrame`, never React re-render per frame. Lists beyond 100
rows are virtualised. No animation runs while the tab is hidden.

---

## 10. Build phases

**Checkpoint 0 — initial look (agreed before any code).** Editorial for the attendee portal; instrument-
dense for admin and scanner; neutral dark ground; Fraunces / Geist / JetBrains Mono;
0px radius; the abstract zone grid as the only map in v1. Nothing is scaffolded until this is signed
off — a visual direction changed after Phase 2 costs a rewrite of every screen.

**Phase 0 — Foundations.** Monorepo (`pnpm` workspaces: `apps/attendee`, `apps/admin`, `apps/scanner`,
`packages/ui`, `packages/contracts`, `packages/mock`), Vite + React + TS, router, tokens, component kit,
mock layer, scenario harness.

The preset is applied per app, theme only:

```
npx shadcn@latest apply b3rmZc8LB2 --only theme -y -c apps/<app>
```

`apps/attendee` is scaffolded and running this way. `apps/admin` and `apps/scanner` take the same command
and then hand-add the `--success` / `--warning` block from §2.1, since those are ours, not the preset's.

**Phase 1 — Attendee Portal.** A1–A4 first (discover → event → register → pass). A5–A9 after. This is
the phase that proves the credential story end to end (P-01, P-02).

**Phase 2 — Admin Command.** D1 (command center) and D9/D10 (log, alerts) first — they define the
telemetry contract. Then D7, D8, D12. Then D3–D6, D11, D13, D14.

**Phase 3 — Gate Scanner.** S1–S3 with the offline path simulated from the start, not retrofitted.
The scanner is the hardest surface; it is deliberately third because it consumes every contract the
first two phases stabilise.

**Phase 4 — Backend & database.** Express + PostgreSQL + WS, written against `packages/contracts`, with
the mock layer flipped off per endpoint as each is completed. Auth, RBAC, scan ingest, telemetry
aggregation, alerts, email.

**Phase 5 — Hardening.** Load profiles from P-17, offline soak test, DSAR/retention jobs, report export
pipeline, observability.

### Acceptance gates

- Phase 1 done when a new attendee can register, receive a pass, bind a band (mock NFC), and see the
  credential revoke live.
- Phase 2 done when 60 rooms update at ≥55 FPS under the `doors_open` scenario while a breach alert
  reaches the banner within 500 ms.
- Phase 3 done when a device in airplane mode admits an allowlisted credential in <120 ms, queues the
  scan, and reconciles exactly once on reconnect.
- Phase 4 done when the mock layer is removed and every screen passes against the real API with no copy
  changes — only transport swaps.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Data model churn after frontend starts | Patches P-02…P-06 fixed now; contracts package makes churn visible as type errors |
| Web NFC is Android-only | Desk provisioning is the documented primary path; NFC-in-browser is an accelerator |
| Offline reconciliation disputes | Idempotency keys + server-side `occurred_at` ordering + an explicit reconciliation report |
| Admin density vs. small laptops | Admin has a single breakpoint at 1280 that collapses the right rail into a tab |
| Scope creep into ticketing/payments | Declared out of scope in Addendum A §A.5 |

---

## 12. Appendix — references, tooling, working loop

Kept here rather than in a separate file. Everything has a job; the long tail of bookmarks is not repeated.

### 12.1 Project skills

| Job | Skill |
|---|---|
| Brief, sitemap, flow-web / flow-mobile, journey, stories | `product-design:*` |
| System, palette, type, styling | `ui-ux-pro-max-skill:brand`, `:design-system`, `:ui-styling` |
| Build the surfaces | `frontend-design:frontend-design` |
| Polish pass | `impeccable:impeccable` |
| QA, a11y, responsive, alignment, visual regression | `design-review:*` |
| Stakeholder deck | `Presentations:pptx` |
| Verify the running build | `chrome-devtools-mcp:chrome-devtools` |

All free and already installed. No paid agent kit is used — see §2 for what replaced it.

### 12.2 External references worth using

- **Flow research:** [Page Flows](https://pageflows.com), [Mobbin](https://mobbin.com),
  [Refero](https://refero.design) — real screen sequences, not inspiration grabs.
- **Block structure:** [21st.dev](https://21st.dev), [Preline UI](https://preline.co). Structure only —
  they are Tailwind/shadcn and we are on hand-written tokens.
- **Behaviour primitives:** [Radix UI](https://www.radix-ui.com) — unstyled dialog, select, tabs,
  tooltip. Adopt for behaviour, style entirely with our tokens.
- **Wordmark:** [Fonts In Use](https://fontsinuse.com), [Another Graphic](https://anothergraphic.org),
  [Typewolf](https://www.typewolf.com). A wordmark comes out of a typeface, not a logo generator.
- **Colour validation:** [Realtime Colors](https://realtimecolors.com) — palette on a real layout.
- **Icons:** [Lucide](https://lucide.dev) — 1.5px stroke, matches the hairline language.
- **Type hosting:** [Fontsource](https://fontsource.org) / [Bunny Fonts](https://fonts.bunny.net) —
  self-host rather than depend on Google's CDN at a cold venue.
- **Presentation:** [Shots](https://shots.so) for device mockups of the pass and command center.

### 12.3 Avoid

Aceternity UI, Magic UI, HeroUI, Mantine, daisyUI, Flowbite, Hover.dev, Motion Primitives, React Bits
Shape Magic, GSAP, Spline, Three.js, Rive, Lottie. They are built around the rounded, gradient, motion-
first aesthetic the project rejects, and a 60 FPS ops map cannot share the main thread with decoration.

### 12.4 Working loop

```
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

Rules: no new colour or size without a token; every screen declares default / empty / loading /
degraded-offline before it is done; one filled primary action per screen; serif for identity and
section titles, mono for numbers, sans for everything interactive; review at 390px and 1440px, always.
