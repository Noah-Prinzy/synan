# Synan — Screens

Every route and screen on the three surfaces. Behaviour behind the screens is in
[01-product.md](01-product.md); the visual language is in [05-design-system.md](05-design-system.md);
endpoints named in the Data columns are in [02 §5–§6](02-architecture.md).

Screen IDs (`A1`, `D1`, `S1`) are stable and are used in the roadmap and in code.

---

## 1. Attendee Portal

Calm, mobile-first, neutral in either theme ([05 §3](05-design-system.md)). Discovery is
public; everything else is authenticated. The theme switch (System · Light · Dark) sits in the
footer and on the account screen.

The structure of this surface is D-37 ([05 §2.1](05-design-system.md)): one statement per screen,
generous space, soft tonal panels and no ruled lines, over Arrivals, the living background (a festival ground drawn in glyphs). The event page
alone is richer: its picture, the event's name set large, a glass card of key facts and a small
"rooms now" panel. The hard rules in [05 §1](05-design-system.md) apply: square corners, tone
instead of lines, and the brand colour never a large fill.

One minimal **top bar** on every screen: the wordmark, `Events` and `My pass`, and one action:
`Sign in`, or the holder's initials once signed in (they open the account). On a phone it keeps
the wordmark and the action, and a `Menu` button opens a full-height menu of large words (Events,
My pass, Agenda, Updates, Account or Sign in, each with one quiet line), `Show my pass`, and who is
signed in; Escape or Close returns focus to the button. Agenda and Updates are reached from that
menu and from the footer. The **footer** is two quiet lines of words and the theme switch. A tonal
bottom bar offers `My pass` to anyone with a credential.

### 1.1 Route map

Eleven screens plus two infrastructure routes. Everything under `/events/:slug/register` is a subroute so
a half-finished registration survives a refresh and can be re-entered from an emailed link.

| Route | Screen | Auth | Data | Key components |
| --- | --- | --- | --- | --- |
| `/` | A1 Discover | public | `GET /events?state=published,live` | statement, filter chips, `EventPicture`, `Badge`, `MyPassBar` |
| `/events/:slug` | A2 Event detail | public | `GET /events/:slug`, `GET /events/:id/occupancy` (public scope), `GET /me/registration` | `EventPicture`, glass key facts, rooms now, `SessionRow` |
| `/events/:slug/register` | A3 → redirect | public | — | redirects to `/identity` |
| `/events/:slug/register/identity` | A3 step 1 | public | — | `RegistrationStepper`, `IdentityForm` |
| `/events/:slug/register/profile` | A3 step 2 | public | `GET /events/:slug/profile-schema` | `DynamicProfileForm`, `ConsentRow` |
| `/events/:slug/register/confirm` | A3 step 3 | public | `POST /users/register`; signed in as that address, `POST /registrations` | `SummaryList`, `ConsentRow` |
| `/pass` ★ | A4 My pass | attendee | `GET /me/registrations`, `GET /me`, `GET /me/credential`, `GET /me/credential/codes`, `POST /me/credential/resend`, `stream/me` | `QrPass`, pass switch, `CredentialState`, `BandRow`, `CredentialActions`, `RevokedOverlay`, `OfflineBadge` |
| `/pass/pair` | A5 Bind band | attendee | `POST /me/credential/bind`, Web NFC | `BindTarget`, `BindCode`, `BindResult` |
| `/agenda` | A6 Agenda | attendee | `GET /me/sessions`, `GET /events/:id/occupancy` | `AgendaSection`, `AgendaRow`, `OccupancyChip` |
| `/notifications` | A7 Updates | attendee | `GET /me/notifications`, `POST /me/notifications/read` | `NotificationRow`, `EmptyState` |
| `/account` | A8 Account | attendee | `GET /me`, `PATCH /me/profile`, `POST /me/credential/report-lost`, `POST /me/data-export`, `POST /me/data-erasure` | `ProfileForm`, `CredentialSummary`, `PrivacyBlock`, `ThemeSwitch`, `Dialog` |
| `/sign-in`, `/verify`, `/auth/verify` | A9 Auth | public | `POST /auth/email-link`, `POST /auth/verify` | `AuthCard` |
| `/invite`, `/invite/:token` | A10 Invitation | invite link | `POST /invitations/read`, `POST /invitations/rsvp` | `AuthCard`, `SummaryList`, `ConsentRow` |
| `/kiosk` | A11 Kiosk | on-site device | `POST /kiosk/registrations` (Public tier) | not yet designed (O-10) |
| `/offline` | Shell | — | service worker | `OfflineBadge`, cached pass |
| `*` | 404 | — | — | `NotFound` |

### 1.2 Screens

**A1 · Discover `/`**
One centred statement, worked out from the listing ("Two events are on right now. Three more
events are coming up."), with a quiet line above it (the greeting, the date). Under it the filters
as tonal chips (All · Live · Upcoming, each with its count), the chosen one ink. Then the events in
two shelves, **On now** and **Coming up**: each event is its picture (or its designed cover: the
date set large on a soft light) with the state, title, venue and date set under it on the ground,
no frame. Opening an event carries its picture into the event page where the browser can (a short
morph; none under reduced motion).

Only listed events appear. Private Invitation events are never shown here.

States: empty (no published events), loading (skeleton cards), error (offline copy with retry).

**A2 · Event detail `/events/:slug`**
The richer page. It opens on the event's **picture**, full width and full height, or the designed
no-photo cover when the event has none. The top bar lies clear over the picture and turns solid as
soon as the page moves; its action there is `Register` (`View your pass` once registered). On the
picture: `All events`, a mono capital eyebrow (dates · venue), and the event's **name** set very
large. At its foot a **glass card** of key facts (state, when, where, how busy it is right now) with
the call to action, and on wide screens a small **Rooms now** panel (each room's word and bar). On a
phone the rooms panel follows the picture. Below the picture, on Arrivals: **About**, the
**Programme** (today's sessions as a rhythm list; the session on now is lifted on a tonal step),
**Venue** (a short list), and **Questions**. If the event is `closed`, the call to action becomes
`View your pass`.

Occupancy here and on A6 is the public view ([03 §5](03-security-privacy.md)), read without
signing in and refreshed about every 10 seconds while the event is live, every minute otherwise,
and never while the tab is hidden or the phone is offline. A count below the minimum crowd size is
not shown: a room bar appears only when there is a count to show, and `Here now` only when the
on-site total is shown. On A6 the indicator reads `Full`, `Nearly full · N places left` (15% or
less), `N places left`, `Not open yet`, or `Places available` when the count is withheld.

**A3 · Registration `/events/:slug/register`**
Three steps: **Your details → A few questions → Check and send**. Each step's name is the
screen's statement ("Your details. Your pass arrives by email."), with the event and "Step N of 3"
above it and a stepper whose done part is a soft accent track. The form sits on one tonal panel in
a single centred column; "You're registering for" and "What happens next" follow it.
- Identity: full name, email, phone (optional, with the note "Only used if the desk needs to reach
  you on the day").
- Profile: event-defined fields from `profile_jsonb` — rendered from a schema-driven form (text, select,
  multi-select, consent checkbox). Consent for zone presence is a separate, unticked-by-default row with
  a plain-language explanation and a `what we store` disclosure (P-12).
- Confirm: summary, `Send my pass` primary action.
Success replaces the step body with an inline confirmation, "You're in.": the pass link has been
emailed (`POST /users/register` answers 202), "Open it on your phone: it signs you in and opens your
pass", with an action to send it again. The answers wait on the server with the emailed link
([03 §5](03-security-privacy.md)), so the link completes the registration on whichever device
opens it, then opens A4 on that pass. If the registration is somehow not complete when the link is
opened, the attendee lands back on the form, now signed in, and finishes it there. Someone already
signed in as that address registers at once and goes straight to "Your pass is ready". Failure
keeps the user in place with field-level errors. The answer never reveals whether an address is
already known; an address already registered for the event simply gets its link.

This flow creates an **Ordinary** registration. The other tiers arrive differently: VIP by operator
approval (D7), Private Invitation through A10, Public through A11
([01 §4](01-product.md)).

**A4 · My pass `/pass` ★**
The single most important attendee screen, in one centred column: the state and the event on one
line, the statement ("Your pass, Amara." and what it is for, muted), then the code on its card.
- **Pass switch.** Someone registered for more than one event sees a row of chips above the code,
  one per pass (event title and day), soonest first; the chosen one is ink. The
  choice is remembered on the device. Cancelled registrations and registrations without a pass are
  not offered.
- Credential state verbatim: `READY` / `NOT YET BOUND` / `UNDER REVIEW` / `REVOKED` / `REPLACED`.
- QR on an opaque white card, black on white in both themes, with the holder's name + tier beneath. The name is the one on
  the account; without one, the start of the email address. The code **rotates** on a short
  interval (D-05); a thin progress bar shows time to the next code, so the change never looks like
  a glitch.
- The screen says what the QR is for: `Show this when you arrive to collect your wristband`. Once a
  band is bound, the wristband row moves to the top and the QR folds beneath it as "Arrival code,
  for the entrance and desk", because inside the venue the band is the key (D-11). At an event
  without wristbands (D-32), the QR is the pass at every gate, and the screen says so.
- Wristband line, one of three: `Bound ••9F3A` (the band's last four characters, never the whole
  UID) with a green dot; `Not bound yet`, with `Bind a band` and where to bind one; or `Reported
  lost`, with `Bind a new band`. Reporting a band lost is on A8.
- Actions: `Email me a copy` and `Keep screen on` (a toggle remembered on the device; it stops the
  phone dimming or locking while the pass is shown; a web page cannot set brightness itself).
  `Add to Wallet` returns when wallet passes are built ([01 §5](01-product.md), [07 §5](07-roadmap.md)).
- On a phone the whole QR is visible without scrolling, in portrait and in landscape. The
  emailed copy is single-use, and the screen says so.
- `NOT YET BOUND` is shown as a neutral state, not a warning: having no wristband before arriving is
  normal.
- Live region: if the credential is revoked while the screen is open, the QR is replaced in place by a
  stop-coloured panel. This is driven by `stream/me` (P-16).

Offline: the device keeps the last pass and the codes fetched ahead, so the pass opens at once and
works without signal. The QR keeps rotating through those codes, and a quiet `Offline — your pass
still works.` line appears. If the phone stays offline past those codes, the screen says "Your pass
needs a connection" and points to the emailed copy or the desk.

**A5 · Bind wristband `/pass/pair`**
Two modes in one screen, chosen with a segmented tonal control: **Tap** (Web NFC, Android Chrome) — a pulsing target area, reads the UID, shows
it in mono, confirm. **Desk code** — 6-character code from the provisioning clerk. On success, a
confirmation panel with the band UID and a `this band is now you` line. Failure states are explicit:
`Already bound to another attendee` (with a `get help` action), `Unknown band`, `NFC unavailable on this
device → use the desk`.

**A6 · My agenda `/agenda`**
Chronological list of the attendee's sessions, grouped `Now · Next · Later`, with sessions that have
ended kept under `Earlier` and each day labelled. Each row: time (mono), title,
room, and a live `space left` indicator sourced from telemetry. The list is a rhythm of rows; `Now`
rows are lifted on a tonal step.
Tapping opens the event detail scrolled to the session.

**A7 · Notifications `/notifications`**
Chronological feed: room at capacity, schedule change, credential update, event-wide announcements.
Unread rows are lifted on a tonal step. Empty state: `Nothing yet — we'll only message you when it matters.`

**A8 · Account `/account`**
Sections as titled tonal panels:
- **Profile.** Name and phone, edited with `Edit details`; the email is shown but not editable. The
  phone is shown masked (`••••• 4567`); the field starts empty with the mask as its hint, and
  leaving it empty keeps the number on file.
- **Pass and wristband** (when there is a pass): the pass being shown, its band by its last four
  characters, and `Report lost band` when a band is bound. Reporting asks first ("Mark your band as
  lost?"), then stops the band at every gate at once; the desk binds a new one
  ([03 §8.2](03-security-privacy.md)).
- **Privacy:** `what we store`, retention window, `Export my data`, `Delete my data` (confirmed
  first).
- **Appearance:** System · Light · Dark.
- Sign out.

**A9 · Auth `/sign-in`, `/verify`**
Email-only. One statement ("Welcome back. Sign in with your email and we'll send you a link."),
one field with the hint "No password needed. The link signs you in here.", `Email me a link`, and
"First time here? Register for an event". The emailed link opens `/auth/verify` with the token
after a `#`; `/verify` is the same screen. It handles the token, shows a 3-second confirmation,
then routes to `/pass`, or back into a registration the link was sent for. No password anywhere on
the attendee side.

**A10 · Invitation `/invite`**
The landing page for a Private Invitation link. Two link forms work: `/invite#token=…`, the form
emailed, which keeps the token off servers and logs; and `/invite/:token`, which moves the token
after the `#` at once. A link whose token is malformed says "This invitation link is incomplete."

The page reads the invitation before anything is asked (`POST /invitations/read`): the event
(which is not publicly listed), who invites, the organiser contact, and the reply-by time. Then:
1. The guest gives the email address the invitation was sent to, and chooses `Accept` or `Decline`.
2. Accepting collects the name, any event-defined profile fields, and the zone-presence consent
   row, then `Accept and send my pass` issues the pass and routes to A4.
3. Declining asks to confirm, and sends no name or answers.

The link works once. A used, withdrawn, or declined link, or an address that does not match, says
plainly that the invitation no longer opens; an expired one says it has expired; an address
already registered says so. Each shows how to reach the organiser ("{name} at {email}", else the
person who invited you). A device that has already replied remembers it and says so.

**A11 · Kiosk `/kiosk`**
On-site onboarding for the Public tier, on a venue-owned device. No personal data is requested. The
visitor is issued a temporary session QR or handed a basic wristband bound to an anonymous ID. Design
not started (O-10).

---

## 2. Admin Command

Neutral, in either theme, on a plain ground ([05 §5](05-design-system.md)).
Desktop-first, 1440 target, dense 13px, with a phone layout below 640px. Every
screen assumes a wall display is watching and a phone is in the operator's hand.

This surface is the instrument (D-01, D-37): a full-width top bar, the figures in one instrument
strip, tonal panels, tables without rules, mono times and ids. No hero imagery, no decorative
cards, and no animation at all.

**Sign-in and the second factor.** Operators sign in with email and password. The sign-in screen
replaces whatever screen was asked for, and returns to it afterwards if the role may open it;
otherwise to the role's landing page. Its heading says why it is shown: a fresh visit, signed out,
the session expired, or signed out elsewhere. Wrong passwords, a lock after too many tries (with
the minutes left), and no connection each have their own message. A forgotten password is reset by
an admin.

The second factor is asked when it is needed, not at sign-in: a privileged action
([03 §3](03-security-privacy.md)) opens a prompt that names the action and takes the six-digit code
from an authenticator app in six boxes (paste fills them; the sixth digit submits). Three tries per
prompt; cancelling does nothing. A confirmed code lasts 15 minutes, and the operator menu shows
"Code confirmed until HH:MM". Someone without an authenticator is taken through set-up instead:
three short instructions, then `Show my set-up key`, which shows a QR code and the key in groups
to type, with `Copy key` and how long it is valid. The first code confirms set-up and lets the
waiting action go ahead. Set-up is also in the operator menu.

**Role views (D-23).** Each role sees only its own screens; the server enforces the same limits on
every request ([03 §3](03-security-privacy.md)). The console narrows its screens further from what
the server says the role may call, never widens them.

| Role | Sees | Lands on |
| --- | --- | --- |
| Admin | Everything | D1 |
| Organiser | Everything except venues, staff and shifts, settings, and first-run set-up | D1 |
| Supervisor | D1, alerts, gate health, the access log, and attendee lookup | D1 |
| Desk clerk | The wristband desk only, for the events of their current desk assignment: no sections, no alert notice, no gate status, no status bar | D8 |
| Security staff, speaker, crew | No console. A plain page says the account uses the Gate Scanner, or that the person's access is their credential, with the account, its role, and `Sign out` | — |

A screen the role may not open says "This screen is not part of your console" with a link to the
role's landing page.

### 2.1 Route map

The routes group into six ideas: watch, configure, people, access, response, records. Event
workspace tabs are real subroutes so an operator can send `…/events/:id/rooms` in a chat and it lands
correctly on a shift handover. In the Role column, "both" means admin and organiser.

| Route | Screen | Role | Data | Key components |
| --- | --- | --- | --- | --- |
| `/admin/sign-in` | Sign-in | public | `POST /auth/login`, `GET /me/operator` | `SignIn` (shown in place of any screen when signed out; this path leads to `/admin`) |
| `/admin/setup` | First run | org admin | `POST /organizations`, `POST /venues` | `Stepper`, `OrganizationForm`, `VenueForm` |
| `/admin` ★ | D1 Command Center | both, supervisor | `stream/telemetry`, `stream/alerts`, `GET /dashboard`, `GET /events/:id/summary` | `KpiStrip`, `ZoneMap`, `RoomsList`, `LiveFeed`, `RecountDialog` |
| `/admin/venues` | D2 Venues | admin | `GET /venues` | `Table`, `TableToolbar` |
| `/admin/venues/new` | D2b New venue | admin | `POST /venues` | `VenueForm` |
| `/admin/venues/:id` | D3 Spatial editor | admin | `GET /venues/:id`, `PUT /zones`, `PUT /rooms/:id` | `ZoneMap`, `ZonePolygon`, `RoomBlock`, `Sheet`, `DiffView` |
| `/admin/events` | D4 Events | admin, organiser | `GET /events` | `Table`, `FilterChips`, `Badge` |
| `/admin/events/new` (+`/:step`) | D5 Wizard | admin, organiser | draft endpoints | `Stepper`, `ReadinessChecklist`, `TierMatrix`, `PassTemplatePreview` |
| `/admin/events/:id/overview` | D6.1 | both | `GET /events/:id/summary` | `KpiStrip`, `ReadinessChecklist` |
| `/admin/events/:id/schedule` | D6.2 | both | `GET /events/:id/sessions` | `SessionList`, `Dialog`, `Timestamp` |
| `/admin/events/:id/rooms` | D6.3 | both | `GET · PUT /events/:id/access-rules` | `TierMatrix`, `RuleDiff`, `DiffView` |
| `/admin/events/:id/attendees` | D6.4 | both | scoped `GET /attendees` | `Table`, `TableToolbar`, `BulkActionBar` |
| `/admin/events/:id/credentials` | D6.5 | both | scoped `GET /credentials` | `BandInventory`, `ProvisioningConsole` |
| `/admin/events/:id/staff` | D6.6 | admin | `GET /staff-assignments` | `ShiftEditor`, `AssignmentConflict`, `HandoverSummary` |
| `/admin/events/:id/reports` | D6.7 | both | `GET /reports?eventId=` | `ReportRow`, `ExportJob`, `ReportChart` |
| `/admin/events/:id/settings` | D6.8 | admin | `PATCH /events/:id` | `SettingsSection`, `Dialog` (danger zone) |
| `/admin/attendees` | D7 Attendees | both: the event's attendee table (D6.4); supervisor: attendee lookup | `GET /attendees`, `GET /events/:id/registrations` | `Table`, `Sheet`, `BulkActionBar`, `ConfirmCount` |
| `/admin/desk` | D8 Wristband desk | both, desk clerk | `GET /admin/events` or `GET /events?scope=work`, `GET /events/:id/registrations`, `GET /registrations/:id`, `GET /credentials/inventory`, `POST /carriers/bind`, `POST /carriers/:id/rebind`, `POST /carriers/desk-code`, `POST /credentials/:id/resend` | `DeskSearch`, `AttendeeCard`, `BindFlow`, `ReplaceFlow`, `DeskCode` (`/admin/credentials` leads here) |
| `/admin/access-log` | D9 Access log | both, supervisor | `GET /scans` (paged, with totals), `stream/scans` | `VirtualList`, `LogRow`, `ResultChip`, `SearchField` |
| `/admin/alerts` | D10 Alerts | both, supervisor | `GET /breach-alerts`, `GET /alerts/:id`, `stream/alerts` | `AlertRail`, `SeverityBar`, `AlertDetail`, `WebhookDeliveryRow` |
| `/admin/staff` | D11 Staff | admin | `GET /staff` | `Table`, `ShiftEditor`, `AssignmentConflict` |
| `/admin/gates` | D12 Gate health | both, supervisor | `GET /gates/health`, `gate.health` on `stream/alerts` | `GateCard`, `GateHealthRow`, `Sparkline`, `QueueBadge` |
| `/admin/gates/:id` | D12b Gate detail | both, supervisor | `GET /checkpoints/:id/scans`, `GET /checkpoints/:id/activity`, `GET /staff-assignments` | `GateHeader`, `ScanFeed`, `Sparkline`, `Table` |
| `/admin/reports` | D13 Reports | both | `GET /reports` | `ReportRow`, `ExportJob`, `Table` |
| `/admin/events/:id/summary` | D13c Event summary | both | `GET /events/:id/post-event-summary`, `POST /reports/:id/export` | `KpiStrip`, `ChartFrame`, `Table`, `ExportJob` |
| `/admin/reports/:eventId` | D13b Event report | both | `GET /reports/:eventId`, `GET /reports/:eventId/:kind` | `ReportChart`, `ChartFrame`, `ExportJob`, `Tabs` |
| `/admin/settings` (+`/:tab` = org · email · integrations · retention · audit · keys) | D14 Settings | admin | various | `SettingsSection`, `WebhookDeliveryRow`, `AuditRow` |
| `*` | 404 | — | — | `NotFound` |

Deep-link conventions: `?attendee=:id` and `?alert=:id` open the detail sheet over the list, so a
pasted link resolves to the same row rather than a bare table. Filters and search live in the URL.

### 2.2 Chrome

**Top bar**, one full-width solid bar, no rules, left to right:
- The wordmark (the mark alone on a phone), which leads to the role's landing page.
- The **event switcher**, the global context for every screen: a state dot, the event's title, its
  state word and a chevron. Its accessible name reads "Event: {title} {state}. Change event". Its
  menu lists the events with date and state and, for roles that watch the live event, a line across
  the organisation: live events, people on site, open alerts; and `All events`. A desk clerk's menu
  reads "Your events".
- The **sections**, filtered by role; a section with nothing the role may open is dropped, and a
  role with a single screen (the desk clerk) gets none. Each section is a button that opens a menu of
  its pages, each with a one-line note:

  | Section | Pages |
  | --- | --- |
  | Live | Command Center, Alerts, Gate health, Access log |
  | Events | All events, New event |
  | People | Attendees, Wristband desk, Staff & shifts |
  | Setup | Venues, Reports, Settings |

  Exactly one section is current, set in ink with a short accent mark under it, and inside its menu
  the current page is marked; inside an event workspace the current section is Events, and the
  wizard counts as New event.
- The **alert notice** (roles that see alerts), a tonal block. Calm: a bell and "No open alerts",
  muted. With open alerts: "N open · Severity" in the colour of the most serious; a critical alert
  tints the block red. Under 768px it shrinks to a bell with a count. Pressing it opens a **panel**
  under the bar: the open alerts, most serious first, each with severity, kind, place, age,
  `Acknowledge` (one click) and `Open` (D10 with that alert); at the foot, how many are
  acknowledged and awaiting resolution, and `All alerts`. The panel resolves nothing; resolution
  lives in D10. Screen readers hear new alerts politely, and critical ones at once. There is no
  separate alert strip.
- The **gate status** (roles that watch), in mono: "28/28 gates online · last scan 0 s · 130 / min",
  from gate health and the live scans; when the connection is down it says `Reconnecting…`,
  `Offline` or `Not live` in words.
- The **account**, a round avatar with the operator's initials. Its menu holds the name, email,
  role, the current shift when there is one, the venue's local time with its UTC offset, the
  second-factor item, **Appearance** (System · Light · Dark as three cells), Settings for admins,
  and `Sign out`.

**Status bar**, one line, for roles that watch: "Counts are live", or "Showing the last known
counts, Ns old" in warning colour, or "No live data for this event"; plus "N scans waiting to sync
· N gates offline" when there are any. `Details` opens round-trip time, last update, and queued
scans per gate.

**Phone.** Below 640px the bar keeps the mark, the event switcher, the alert bell, the avatar and
a `Menu` button at its end, which opens a full-height sheet with each section's name in mono
capitals and its pages in large words (44px rows). The gate status moves to a strip under the bar.

### 2.3 Screens

**D0 · First run `/admin/setup`**
Only reachable while the organization has no published venue. Three steps: Organization (name, timezone,
support email) → Venue (name, city, floors) → Done. It writes the org and seeds one venue, then hands off
to D5. Skipped permanently once a venue exists.

**D1 · Command Center `/admin` ★**
The hero screen, made calm (D-22, D-37): a statement, four figures in one strip, a map without
numbers, and the rooms list beside it.
- **Statement**: a mono capital line (live state, venue, date, time), then one headline and one
  sentence built from live data: "All calm at {venue}." when no alert is open and every gate is
  online; "{Room} needs you." for a high or critical alert; "One alert open at {venue}." for a
  medium or low one; "{Gate} is offline." when a gate is down. The most serious open alert sits
  under it with `Open alert` and `Acknowledge`.
- **Four figures**, in one tonal instrument strip, mono, each with a line of words beneath rather
  than a delta or sparkline:
  - *On site now*, "inside the venue now".
  - *Checked in*, "of N registered".
  - *Rooms filling up* (nearly full plus full), in words ("2 full · 3 nearly full", or "Every room
    has space"), in warning or stop colour when above zero.
  - *Open alerts*, with the most serious named ("Nothing needs action" when none), coloured by
    the worst severity.
- **Map**, on a still dot grid: zones as tonal blocks with name and floor; rooms as blocks whose
  shading rises from the floor to show how full they are; perimeter gates as small chips outside the
  zone, with a problem in words; a badge on a room's faulty door; a key (Space · Busy · Nearly full ·
  Full · Gate). **No figures on the map**: counts are in the rooms list and the room card. Colour by
  threshold, always with a word or a shape too ([05 §3](05-design-system.md)). Hover or keyboard
  focus shows a **room card**: count against the thresholds, the change in the last minute, its
  door, `Recount`, and `Open room`. `Recount` sets the count to a headcount with a note, and is
  audited (D-10). Clicking a room selects it and opens it in the rooms list. The map is
  keyboard-operable (arrows, Home, End, Enter, Escape); each room's accessible name begins with its
  visible name and level word. A venue with no floor plan says "No floor plan drawn yet". Figures
  change by interpolation, never by animation.
- **Rooms**, beside the map: fullest first, each with its name, level word, count, zone and a bar;
  re-sorted no more than every two seconds and held still under the pointer; a selected room shows
  its meter, a three-minute trend, its doors, and its recent scans.
- **Below**: **Gates**, as one line ("All gates online") or the gates that need attention, with a
  link to D12; and **Recent activity**, the last six refusals, alerts, gate changes, and recounts,
  with a link to D9.
- **Alert treatment:** a room with an open high or critical alert carries a stop frame until it is
  acknowledged, and a critical alert flashes it once. Acknowledge is always one click, in the top
  bar's alert notice; resolution lives in D10.

Degraded states are designed, not incidental: a gate that needs someone says so under Gates
(`offline 4m · 182 queued`, P-09); the gate status in the bar changes; the status bar says how old the counts
are; the map dims to the last known state with its time shown. An event that is not live shows
dashed figures, says so, and lists the live events with `Watch this event`; a closed one links to
its summary. Below 1024px the sections stack; below 640px rooms show as a list, with a switch to
the map.

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
Each role sees only its own tabs: the organiser has no Staff tab. The bare workspace address opens
Overview, or the summary (D13c) for a closed event.
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

For admins and organisers this route opens the current event's attendee table (D6.4). A
**supervisor** gets **attendee lookup** instead: search by name, email, or band (at least two
characters), or list the passes under review; the first 25 matches show. Choosing one shows the
facts needed to act on a pass: name, email, tier, registration, pass state, band hint, check-in,
last scan, and registration ID. For a pass under review it offers `Clear` or `Revoke`, each with a
note and a fresh second factor (D-06, [03 §3](03-security-privacy.md)).

**D8 · Wristband desk `/admin/desk`**
One screen for the registration desk, built for a clerk at a counter (D-23). `/admin/credentials`
leads here.
- **Find the attendee** with one search field: name, email, pass reference, band number, or a
  band's last four. Results are 56px rows. The search is not written to the address bar. A line
  reminds the clerk to check photo ID.
- **The attendee card:** tier, name, email (or "public visitor"), registration, pass, and band (by
  its last four only), with when they checked in and when their pass was last emailed. A revoked
  pass, a pass under review, or an unconfirmed registration blocks the actions and says why.
- **Actions:** with no band, `Bind`, either by scanning the band or by a **desk code**: six
  characters, valid 10 minutes, used once, that the attendee types on A5; the screen waits until
  the band is bound. With a band: `Rebind` (a damaged band) and `Lost band` (check photo ID, mark
  the band lost, replace the pass, bind a new band). A band the attendee reported lost offers
  `Replace the lost band` directly. `Resend the pass`. Rebinding, replacing, and resending ask for
  the second factor (P-10, [03 §3](03-security-privacy.md)); every action is audited.
- **Stock:** bands in stock, in warning colour below 50 ("Running low"), and today's binds,
  replacements, and resends.
- **Offline:** a banner says binding, replacing, and resending wait for the connection; the search
  and the attendee stay on screen, the actions are disabled, and `Try again` is offered.
- A closed event is read-only; a draft shows a notice. An event picker appears only when the clerk
  has more than one event.

Bulk import of bands, with a column-mapping preview, is a secondary action here for admins and
organisers only.

**D9 · Access log `/admin/access-log`**
A virtualised stream of the event's scans. Columns: time (mono, ms), checkpoint, credential
(truncated band hint + tier), result chip, latency. The result vocabulary is fixed and defined in
[01 §7](01-product.md). Filters by result, gate, and room, all kept in the address bar; `Pause` and
`Resume`, with "N new scans waiting" while paused; a window of 200 rows with `Load older`. The foot
says "Showing X of Y scans" (or "at least Y" when the total is capped). No person is named.
`Find a pass` searches by band or its last four and is a credential access-history lookup: admins
and organisers only, and audited ([03 §5](03-security-privacy.md)). Sticky detail row on click.
Export defers to the report job (P-14).

The log shows the current event's scans. After the post-event purge it is empty for that event by
design, and says so ([03 §6](03-security-privacy.md)).

**D10 · Security alerts `/admin/alerts`**
Inbox with severity bands (`critical / high / medium / low`) and filter chips with counts: Needs
action · Open · Acknowledged · Resolved. Each row: kind, zone/room, time, age, state
(`open / acked / resolved`), assignee, and an inline `Acknowledge`. `?alert=:id` opens the detail
beside the list from 1280px, as a dialog below. The detail shows severity, where (linking to the
gate), when, who acknowledged it and when, the rule that fired, the triggering or nearby scans, the
credential, and a resolution note field (3–1,000 characters; resolving also acknowledges).
Resolution is required before an alert leaves the list.
An impossible-travel alert shows the last two checkpoints and the gap between them, and offers
`Clear credential` or `Revoke`, each with a note; the credential stays suspended until a supervisor
chooses one (D-06).
An offline-conflict alert — raised when gates sync — lists every scan involved side by side, with the
gate and corrected time of each (D-13).
A separate tab shows webhook delivery attempts with status codes and retry state.

**D11 · Staff & shifts `/admin/staff`**
Table of staff: name, role, assigned checkpoint, shift window, last active, device. Invite flow by email.
Assignment is a two-field editor (checkpoint + shift); overlapping assignments are rejected inline.
`Handover` action ends a shift and prints the queued-scan summary. Roles matrix (Admin / Organiser /
Supervisor / Desk clerk / Security Staff / Speaker / Crew, D-23) shown read-only for the current
plan; an admin may change another person's role, with the second factor.

**D12 · Gate health `/admin/gates`**
Every checkpoint as a row, faults first: label, direction, perimeter or interior, hardware ID, link
state, heartbeat age, queue depth, clock offset (flagged past two minutes, D-14), allowlist age
(flagged when stale, O-05), last scan. One figure per gate, the scans in the last 15 minutes; the
rest is said in words. A `Wall` view from 1280px shows a card per gate for the wall display, sorted
faults-first. It updates as gate health changes. This is where "gate 3 is offline" gets escalated.

**D12b · Gate detail `/admin/gates/:id`**
One checkpoint: hardware ID, direction, status (link, heartbeat, queue, clock, scans in the last 15
minutes), link history for the shift, throughput by 5-minute bucket for the last hour, failure
breakdown by result code, last 50 scans, and the staff assigned now and next (display name and
shift only). Actions: `Reassign` (to the event's Staff tab, for admins), `Mark for maintenance`,
`Test read` (a synthetic scan that is not logged as attendance).

**D13 · Reports `/admin/reports`**
List of generated reports with kind, event, state (`queued / running / ready / failed`), and download.
Event report view has tabs per report type; charts are drawn with the same tokens (a tonal ground, no grid lines, mono
axes, no fills except one accent). `Export` starts the async job and shows progress (P-14).

**D13c · Event summary `/admin/events/:id/summary`** (D-21)
The landing page of a closed event, and reachable from the event list and the reports list. One
page, no tabs:
- A headline strip in mono numerals: registered · checked in · no-shows · peak on site, with the
  time it happened · rooms that reached capacity · alerts raised.
- Attendance by tier as a small table with a bar per row.
- The occupancy curve across the event, one line, with the peak marked.
- Busiest rooms and busiest gates, five rows each.
- Alerts: count by severity, median time to acknowledge and to resolve.
- Downloads: `Excel workbook` as the primary action, then `CSV` per report and `PDF summary`. A
  download that is being prepared shows its progress in place.
- A plain line stating what is no longer available and when it was removed: "Individual scan
  records for this event were deleted on 26 Nov 2026."

For a live or published event the same route shows the figures so far, labelled as provisional.
States: loading, error, and "no data yet" for an event that has not opened.

**D14 · Settings `/admin/settings`**
Sections: Organization, Email (sending domain, delivery health, pass template preview with a live sample),
Integrations & Webhooks (endpoints, signing secret, delivery log), Retention & Privacy (the purge grace
period, the next scheduled purge per closed event, the queue of attendee export and erasure
requests), Audit log (with chain-integrity status), API keys.

---

## 3. Gate Scanner

Installable PWA. Must be operable one-handed, in the dark, by a temp staffer with 30 seconds of training.

At events that use wristbands it runs on venue-owned Android devices, because tapping a wristband
from a web app works only in Chrome on Android (D-09). On any other device the tap target is replaced
by the manual entry field, which also accepts input from a USB or Bluetooth NFC reader. At an event
without wristbands it needs only a camera, so any phone can run it (D-32).

The scanner adapts to its gate (D-11). At an event without wristbands, every gate opens on the
camera viewfinder (D-32). At a **perimeter** gate or desk it opens on the camera
viewfinder for QR codes, with wristband tap alongside. At an **interior** gate there is no viewfinder:
the screen is a tap target, and a QR shown to it is answered with `Use your wristband`.

### 3.1 Route map

Five routes. The scanner never nests deeper than one level, because a staffer two days into the job must
be able to get back to the viewfinder with one tap from anywhere.

| Route | Screen | Auth | Data | Key components |
| --- | --- | --- | --- | --- |
| `/scan/pair` | S1 Choose gate | staff | `POST /auth/login`, `GET /me/assignments` | `GatePicker`, `ShiftRefusal` |
| `/scan` ★ | S2 Scan | staff | `POST /scans`, `GET /events/:id/allowlist`, `GET /auth/signing-keys`, `GET /time`, `stream/scans`, `POST /gates/heartbeat` when the stream is closed | `ScannerViewfinder`, `Reticle`, `VerdictPanel`, `PermittedChips`, `ReasonLine`, `LocalTag`, `QueueHeader`, `ManualUidEntry`, `TorchToggle` |
| `/scan/recent` | S3 Recent | staff | local store, `POST /scans/:id/undo` | `ScanHistoryRow`, `UndoStrip`, `ResultChip` |
| `/scan/queue` | S4 Offline queue | staff | local queue | `QueueSummary`, `QueueHeader`, `Dialog` (retry confirmation) |
| `/scan/help` | S5 Reference | staff | static | `HelpBlock`, `HapticsToggle`, `ThemeSwitch` |

Bottom tabs reach Scan, Recent, Queue (with the number waiting), and Help. The header names the gate
and its link: `Online`, `Sending · N queued`, or `Offline`.

Shift end is a `Dialog` over `/scan`, not a route: it summarises admitted / refused / queued counts,
and the admissions undone, and confirms handover (`POST /staff-assignments/:id/handover`) before the
device locks. Queued scans are sent first. Afterwards the device returns to S1 with "Shift ended.
Hand this device to your supervisor."

### 3.2 Screens

**S1 · Pair `/scan/pair`**
Signing in comes first, with email and password; only Security Staff may sign in
([03 §4](03-security-privacy.md)). Then `Scan the gate code` (camera) or pick from a list of the
staff member's assignments: one row per gate, for the current shift or else the next (P-15). Each row
says what the gate takes ("Entrance · passes and wristbands", or "Inside · wristbands only" with the
room) and the shift window and event. Gates outside the shift are shown but refused with a plain
reason. `Sign out` is at the foot. Queued scans stay on the device after sign-out, so the next
person can send them ([03 §4](03-security-privacy.md)).

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
- Room chips show only on an admission, and are dropped on a short screen (under 700px tall) to
  keep the verdict readable. A repeat read of the same pass shows a quiet note, not a new verdict.
- Haptics + distinct tones per verdict (site-configurable, default on; staff can turn each off on
  S5).
- `123 Type a number` (a sheet that takes a band UID, or a pass code at a perimeter gate) and a
  `Wristbands` (NFC) toggle in thumb reach. Torch toggle at the top right when the camera has one.
  Keystrokes from a USB or Bluetooth reader are accepted. The screen stays awake.
- Offline: the verdict panel gains a `LOCAL` tag and the count of queued scans appears in the header.
  Verdicts are still instant (P-09). Online, the server has 2.5 seconds to answer before the
  phone's own decision stands.

**S3 · Recent `/scan/recent`**
Last 50 scans at this gate with result chips and a per-row marker: `Sent`, `Sent late`, `Waiting`,
or `Not sent` (refused or held back). `Undo` is offered on the staff member's own admissions at
the gate they are staffing now, within the server's undo window (60 seconds by default), and only
while the link is up for a scan already sent; it writes a correction record and never deletes. A
scan not yet sent is simply held back. An undone row reads `Undone`; a refused undo says why.

**S4 · Queue `/scan/queue`**
Pending sync count, oldest age, last sent, the age of the pass list (allowlist), per-result
breakdown, `Retry now`, and a hard warning when the phone is offline and the allowlist is stale
beyond the fail-open window (P-09, O-05): "Known passes are still let in, and each one raises an
alert. Call your supervisor." After a sync, any scans the server found in conflict with another
gate are listed under "Conflicts found at the last sync" with the outcome, so the operator learns
what the gate could not have known (D-13). The device's clock offset is shown, with a warning past
two minutes (D-14).

**From an earlier shift.** Scans left on the phone from a shift that has ended or been handed over
are counted separately: waiting, refused for now and kept, and sent after their shift. The wording
says whether the person signed in now can send them, which they can only at that scan's gate
([03 §4](03-security-privacy.md)).

**S5 · Help `/scan/help`**
One screen: what green/amber/red mean, when to call a supervisor, how to switch gates, how to end a
shift. Switches for sound and vibration. **Appearance** (System · Light · Dark), with the hint "Light
reads best in bright sun, dark at night. System follows this phone." No nested navigation.

---

## 4. Later additions

Edge AI (Phase 6) adds elements to D1, D6, D10, and A6 without changing their structure. They are
listed in [04 §5](04-edge-ai.md).
