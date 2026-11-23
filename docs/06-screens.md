# Synan — Screens

Every route and screen on the three surfaces. Behaviour behind the screens is in
[01-product.md](01-product.md); the visual language is in [05-design-system.md](05-design-system.md);
endpoints named in the Data columns are in [02 §5–§6](02-architecture.md).

Screen IDs (`A1`, `D1`, `S1`) are stable and are used in the roadmap and in code.

---

## 1. Attendee Portal

Editorial, mobile-first, dark neutral. Discovery is public; everything else is authenticated.

The structure of this surface is Direction A ([05 §2.1](05-design-system.md), D-19): a hairline
page frame, navigation in ruled cells, a scroll-following side list on the event page, and a footer
of ruled link columns. Where a screen description below still mentions tabs or a plain card grid,
Direction A takes precedence; each description is rewritten as its screen is rebuilt.

This surface uses the redesigned layouts (D-01): hero sections, card grids, tabs, and imagery are
allowed here and nowhere else. The hard rules in [05 §1](05-design-system.md) still apply — square
corners, hairlines, and the brand colour never as a fill.

A sticky site header carries the wordmark and navigation on every screen, collapsing to a `Menu`
button on narrow widths. A sticky bottom bar offers `My pass` to anyone with a credential.

### 1.1 Route map

Eleven screens plus two infrastructure routes. Everything under `/events/:slug/register` is a subroute so
a half-finished registration survives a refresh and can be re-entered from an emailed link.

| Route | Screen | Auth | Data | Key components |
| --- | --- | --- | --- | --- |
| `/` | A1 Discover | public | `GET /events?state=published,live` | `FeaturedEvent`, `EventCard`, filter tabs, `AnimatedBar`, `Badge`, `MyPassBar` |
| `/events/:slug` | A2 Event detail | public | `GET /events/:slug`, `stream/telemetry` (public scope) | Hero, tabs, `SessionRow`, `StatsPanel`, `StatusPanel` |
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
| `/invite/:token` | A10 Invitation | invite link | `POST /invitations/:token/rsvp` | `AuthCard`, `SummaryList`, `ConsentRow` |
| `/kiosk` | A11 Kiosk | on-site device | `POST /registrations` (Public tier) | not yet designed (O-10) |
| `/offline` | Shell | — | service worker | `OfflineBadge`, cached pass |
| `*` | 404 | — | — | `NotFound` |

### 1.2 Screens

**A1 · Discover `/`**
A **featured event** leads the page: status badge, the title in Fraunces at display size, date and
venue, and a hairline panel with live occupancy as a bar and a count. Below it, filters as a single
horizontal rule of text tabs (All · Live · Upcoming · Near me) with an animated underline on the
active one. Then the remaining events as a **card grid** — one column on phones, two on tablets,
three on desktop. Each card: status badge, date in mono, title in Fraunces, venue and city, and an
occupancy bar when the event is live. Cards are hairline-bordered and square; hover strengthens the
border toward the brand colour and never fills.

Only listed events appear. Private Invitation events are never shown here.

States: empty (no published events), loading (skeleton cards), error (offline copy with retry).

**A2 · Event detail `/events/:slug`**
A **hero** opens the page: status badge, event title at display size, date with the local timezone
labelled, venue, and optional event imagery. Below, **tabs** divide the content — overview (the
description), schedule, and venue. The schedule is grouped by day; each session row shows room, time,
and live occupancy as a bar (warn and stop colour past thresholds).

A **sidebar** on ≥1024 (stacked beneath on phones) holds two panels: event statistics with animated
counters and an occupancy bar, and `Your status` — not registered / registered / checked in, with the
call to action. If the event is `closed`, the call to action becomes `View your pass`.

**A3 · Registration `/events/:slug/register`**
Three steps with a hairline stepper: **Identity → Profile → Confirm**.
- Identity: full name, email, phone (optional).
- Profile: event-defined fields from `profile_jsonb` — rendered from a schema-driven form (text, select,
  multi-select, consent checkbox). Consent for zone presence is a separate, unticked-by-default row with
  a plain-language explanation and a `what we store` disclosure (P-12).
- Confirm: summary, `Send my pass` primary action.
Success replaces the step body with an inline confirmation and moves to A4. Failure keeps the user in
place with field-level errors; a duplicate email routes to sign-in instead of erroring.

This flow creates an **Ordinary** registration. The other tiers arrive differently: VIP by operator
approval (D7), Private Invitation through A10, Public through A11
([01 §4](01-product.md)).

**A4 · My pass `/pass` ★**
The single most important attendee screen. One hairline card, centred, max 600:
- Credential state verbatim: `READY` / `NOT YET BOUND` / `UNDER REVIEW` / `REVOKED` / `REPLACED`.
- QR on pure white with a 1px ink frame and the attendee's name + tier beneath in mono. The code
  **rotates** on a short interval (D-05); a thin progress rule shows time to the next code, so the
  change never looks like a glitch.
- The screen says what the QR is for: `Show this when you arrive to collect your wristband`. Once a
  band is bound, the wristband row moves to the top and the QR folds beneath it, because inside the
  venue the band is the key (D-11).
- Wristband row: `Bound · uid 04A2…9F` with a green dot, or `Not bound — bind at the desk` with the
  nearest desk location.
- Actions as a three-up icon grid: `Add to Wallet`, `Email me a copy`, `Keep screen on` (stops the
  phone dimming or locking while the pass is shown; a web page cannot set brightness itself). The
  emailed copy is single-use, and the screen says so.
- `NOT YET BOUND` is shown as a neutral state, not a warning: having no wristband before arriving is
  normal.
- Live region: if the credential is revoked while the screen is open, the QR is replaced in place by a
  stop-coloured panel. This is driven by `stream/me` (P-16).

Offline: the QR keeps rotating through the codes fetched ahead of time, and a quiet `Offline — pass
remains valid` line appears. If the phone stays offline past those codes, the screen says so and
points to the emailed copy or the desk.

**A5 · Bind wristband `/pass/pair`**
Two modes in one screen: **Tap** (Web NFC, Android Chrome) — a pulsing target area, reads the UID, shows
it in mono, confirm. **Desk code** — 6-character code from the provisioning clerk. On success, a
confirmation panel with the band UID and a `this band is now you` line. Failure states are explicit:
`Already bound to another attendee` (with a `get help` action), `Unknown band`, `NFC unavailable on this
device → use the desk`.

**A6 · My agenda `/agenda`**
Chronological list of the attendee's sessions, grouped `Now · Next · Later`, with sessions that have
ended kept under `Earlier` and each day labelled. Each row: time (mono), title,
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

**A10 · Invitation `/invite/:token`**
The landing page for a Private Invitation link. Shows the event (which is not publicly listed), the
invitee's name, and the RSVP. Accepting collects any event-defined profile fields and the
zone-presence consent row, then issues the pass and routes to A4. The link works once; a used or
expired link shows a plain explanation and a way to contact the organiser.

**A11 · Kiosk `/kiosk`**
On-site onboarding for the Public tier, on a venue-owned device. No personal data is requested. The
visitor is issued a temporary session QR or handed a basic wristband bound to an anonymous ID. Design
not started (O-10).

---

## 2. Admin Command

Neutral dark, one step deeper than the attendee portal. Desktop-first, 1440 target, dense 13px. Every
screen assumes a wall display is watching and a phone is in the operator's hand.

This surface keeps the strict instrument rules (D-01): tables, rails, and hairline panels. No hero
sections, no imagery, no decorative cards, no entrance animation.

Operators sign in with a password and a second factor. Privileged actions — tier change, wristband
override, credential re-issue, report export — ask for the second factor again
([03 §3](03-security-privacy.md)).

### 2.1 Route map

Sixteen routes, but only six top-level ideas: watch, configure, people, access, response, records. Event
workspace tabs are real subroutes so an operator can send `…/events/:id/rooms` in a chat and it lands
correctly on a shift handover.

| Route | Screen | Role | Data | Key components |
| --- | --- | --- | --- | --- |
| `/admin/sign-in` | — | public | `POST /auth/login`, `POST /auth/mfa/verify` | `AuthCard`, `OtpInput` |
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

### 2.2 Chrome

Persistent top bar: wordmark, event selector (the global context for every screen), a live pill
(`● LIVE 4 Hz` / `RECONNECTING` / `OFFLINE`), venue-local clock, shift label, operator menu.
A second, thinner strip carries **only** alert banners — the highest open severity, one line, with
`Acknowledge` and `Open`. Status bar at the bottom: WS latency, last snapshot age, queue depth across
gates.

### 2.3 Screens

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
  click drills into the room. The room card offers `Recount`, which sets the count to a headcount and
  is audited (D-10). Panels animate only via interpolation.
- **Right rail (4 cols):** `Rooms` list sorted by utilisation descending (name, count/capacity, bar,
  three-state dot); below it `Live feed` — the last 12 events (scan, alert, gate status) in a compact
  timeline with mono timestamps.
- **Alert treatment:** critical alerts also flash the top strip and the offending room outline, then
  settle. Acknowledge is always one click; resolution lives in D10.

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
scan history, actions `Resend pass`, `Revoke credential`, `Rebind band`, `Change tier`, `View audit`.
Bulk select supports `Export CSV` and `Resend passes` (rate-limited with a confirm dialog showing the
count).

Tiers are the four in [01 §4](01-product.md). `Change tier` is how a registration becomes VIP; it
asks for the second factor and is audited. `Invite` sends Private Invitation links to a pasted or
imported recipient list and shows each invitation as sent / opened / accepted / expired. Viewing
scan history is a credential access-history lookup and is itself audited.

**D8 · Wristbands & provisioning `/admin/credentials`**
Two panes. Left: inventory counts by state (`stock / assigned / bound / active / lost / retired`) as
large mono numerals. Right: the provisioning console — scan band, paste or scan a registration ID, verify
identity against the sheet (name + photo if present), then `Bind`. Explicit replacement flow: pick the
lost band, pick the new one, confirm — old credential revoked, new bound, audit entry written (P-10).
Bulk import lives here as a secondary action with a column-mapping preview.

**D9 · Access log `/admin/access-log`**
A virtualised, searchable stream. Columns: time (mono, ms), checkpoint, credential (truncated UID +
tier), result chip, latency. The result vocabulary is fixed and defined in [01 §7](01-product.md).
Filters by result, gate, room, and a credential search. Sticky detail row on click. Export defers to
the report job (P-14).

The log shows the current event's scans. After the post-event purge it is empty for that event by
design, and says so ([03 §6](03-security-privacy.md)).

**D10 · Security alerts `/admin/alerts`**
Inbox with severity bands (`critical / high / medium / low`). Each row: kind, zone/room, time, age, state
(`open / acked / resolved`), assignee. Detail sheet shows the triggering scan, the credential, the rule
that fired, and a resolution note field. Resolution is required before an alert leaves the list.
An impossible-travel alert shows the last two checkpoints and offers `Clear credential` or `Revoke`;
the credential stays suspended until a supervisor chooses one (D-06).
An offline-conflict alert — raised when gates sync — lists every scan involved side by side, with the
gate and corrected time of each (D-13).
A separate tab shows webhook delivery attempts with status codes and retry state.

**D11 · Staff & shifts `/admin/staff`**
Table of staff: name, role, assigned checkpoint, shift window, last active, device. Invite flow by email.
Assignment is a two-field editor (checkpoint + shift); overlapping assignments are rejected inline.
`Handover` action ends a shift and prints the queued-scan summary. Roles matrix (Admin / Organiser / Security Staff / Speaker / Crew)
shown read-only for the current plan.

**D12 · Gate health `/admin/gates`**
Every checkpoint as a row: label, direction, perimeter or interior, hardware ID, link state,
heartbeat age, queue depth, clock offset (flagged past two minutes, D-14),
last scan, throughput (last 15 min as a sparkline). A card per gate for the wall display, sorted
faults-first. This is where "gate 3 is offline" gets escalated.

**D12b · Gate detail `/admin/gates/:id`**
One checkpoint: hardware ID, direction, link history for the shift, throughput by 5-minute bucket, failure
breakdown by result code, last 50 scans, currently assigned staff. Actions: `Reassign`, `Mark for
maintenance`, `Test read` (a synthetic scan that is not logged as attendance).

**D13 · Reports `/admin/reports`**
List of generated reports with kind, event, state (`queued / running / ready / failed`), and download.
Event report view has tabs per report type; charts are drawn with the same tokens (hairline grid, mono
axes, no fills except one accent). `Export` starts the async job and shows progress (P-14).

**D14 · Settings `/admin/settings`**
Sections: Organization, Email (sending domain, delivery health, pass template preview with a live sample),
Integrations & Webhooks (endpoints, signing secret, delivery log), Retention & Privacy (the purge grace
period, the next scheduled purge per closed event, the queue of attendee export and erasure
requests), Audit log (with chain-integrity status), API keys.

---

## 3. Gate Scanner

Installable PWA. Must be operable one-handed, in the dark, by a temp staffer with 30 seconds of training.

It runs on venue-owned Android devices, because tapping a wristband from a web app works only in
Chrome on Android (D-09). On any other device the tap target is replaced by the manual entry field,
which also accepts input from a USB or Bluetooth NFC reader.

The scanner adapts to its gate (D-11). At a **perimeter** gate or desk it opens on the camera
viewfinder for QR codes, with wristband tap alongside. At an **interior** gate there is no viewfinder:
the screen is a tap target, and a QR shown to it is answered with `Use your wristband`.

### 3.1 Route map

Five routes. The scanner never nests deeper than one level, because a staffer two days into the job must
be able to get back to the viewfinder with one tap from anywhere.

| Route | Screen | Auth | Data | Key components |
| --- | --- | --- | --- | --- |
| `/scan/pair` | S1 Choose gate | staff | `GET /me/assignments` | `GatePicker`, `ShiftRefusal` |
| `/scan` ★ | S2 Scan | staff | `POST /scans`, `stream/scans` fallback | `ScannerViewfinder`, `Reticle`, `VerdictPanel`, `PermittedChips`, `ReasonLine`, `LocalTag`, `QueueHeader`, `ManualUidEntry`, `TorchToggle`, `HapticsToggle` |
| `/scan/recent` | S3 Recent | staff | local store, then `GET /scans?checkpoint=` | `ScanHistoryRow`, `UndoStrip`, `ResultChip` |
| `/scan/queue` | S4 Offline queue | staff | local queue | `QueueSummary`, `QueueHeader`, `Dialog` (retry confirmation) |
| `/scan/help` | S5 Reference | staff | static | `HelpBlock` |

Shift end is a `Dialog` over `/scan`, not a route: it summarises admitted / refused / queued counts and
confirms handover before the device locks.

### 3.2 Screens

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
    `Under review`, `Pass already used`, `Use your wristband`, `Unknown band`), name if known, and
    `Call supervisor`.
  - The words above illustrate the layout. The exact label and instruction for every result are
    taken from the contracts' scan-result copy, which is the single source of that wording
    ([02 §7](02-architecture.md)).
- Haptics + distinct tones per verdict (site-configurable, default on).
- `123` (manual UID) and `NFC` toggles in thumb reach. Torch toggle at the top right.
- Offline: the verdict panel gains a `LOCAL` tag and the count of queued scans appears in the header.
  Verdicts are still instant (P-09).

**S3 · Recent `/scan/recent`**
Last 50 scans with result chips and a 60-second `Undo` on admission errors only (writes a correction
record; never deletes). Synced/unsynced marker per row.

**S4 · Queue `/scan/queue`**
Pending sync count, oldest age, per-result breakdown, `Retry now`, and a hard warning if the allowlist
is stale beyond the fail-open window (P-09). After a sync, any scans the server found in conflict
with another gate are listed here with the outcome, so the operator learns what the gate could not
have known (D-13). The device's clock offset is shown, with a warning past two minutes (D-14).

**S5 · Help `/scan/help`**
One screen: what green/amber/red mean, when to call a supervisor, how to switch gates, how to end a
shift. No nested navigation.

---

## 4. Later additions

Edge AI (Phase 6) adds elements to D1, D6, D10, and A6 without changing their structure. They are
listed in [04 §5](04-edge-ai.md).
