# Synan — Architecture

How Synan is built: stack, repository, data model, API, real-time channels, and performance
targets. Behaviour is specified in [01-product.md](01-product.md); protection in
[03-security-privacy.md](03-security-privacy.md).

---

## 1. Core principle

**Two transports, strictly separated.** Deterministic, transactional operations go over REST.
High-frequency telemetry, scan results, and security alerts go over WebSockets. Administrative
workflows must never compete with time-critical venue traffic.

---

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Database | PostgreSQL | ACID integrity for the relational core; JSONB for event-defined attendee profile fields |
| Backend runtime | Node.js — Express plus a WebSocket server | Non-blocking I/O for many concurrent scans and live streams |
| API | Hybrid REST + WebSockets | See §1 |
| Frontend | React + TypeScript, client-rendered, built with Vite | Full client control of the render loop for dense live maps |
| Styling | Tailwind CSS v4 with design tokens | See [05-design-system.md](05-design-system.md) |
| Contracts | Zod schemas in a shared package | One declaration of every payload, used by both ends (§7) |
| Package manager | pnpm workspaces | Monorepo |

Supporting choices (D-17):

| Concern | Choice | Why |
| --- | --- | --- |
| Routing | React Router | Already in all three apps |
| Server data in the client | TanStack Query | Caching, retries, and background refresh without hand-written state |
| WebSocket server | `ws` | Minimal, no protocol of its own to work around |
| Tokens and signatures | `jose` | Signed access tokens and the signed portal QR ([03 §2](03-security-privacy.md)) |
| Schema and migrations | Drizzle | TypeScript-first, stays close to SQL, which partitions and row-level security need |
| Background jobs | pg-boss | Runs on PostgreSQL: purge, report export, email, scheduled reports. No second datastore |
| Real-time fan-out | PostgreSQL `LISTEN` / `NOTIFY` | Enough for one server. Replaced by a message broker only when there is more than one |
| Scanner offline | `vite-plugin-pwa` and IndexedDB | Installable shell, cached allowlist, queued scans |
| QR reading | Browser `BarcodeDetector`, with a WebAssembly decoder as fallback | Native speed where available |
| Email | A transactional provider with a verified domain | Provider not yet chosen |
| File storage | S3-compatible object storage | Report exports behind signed short-lived links |
| Tests | Vitest for units; Playwright driving the named scenarios in §8 | The scenarios are the acceptance tests |

**Deliberately absent in version 1: Redis, a message broker, and a second database.** Peak load is
40 scans per second, which one PostgreSQL instance handles comfortably. Each is added only when a
measured limit requires it.

---

## 3. Repository layout

```text
apps/
  attendee/      Attendee Portal            (port 5173)
  admin/         Admin Command              (port 5174)
  scanner/       Gate Scanner PWA           (port 5175)
  api/           Backend: REST and WebSocket (port 5180)
packages/
  ui/            Shared theme, tokens, motion, components, brand
  contracts/     Zod schemas for REST and WS, enums, error and result copy
  db/            PostgreSQL schema (Drizzle), migrations, rules, seed
  mock/          Fixtures, mock realtime, scenarios, controllable clock
docs/            This specification
```

What exists today versus what is planned is tracked in [07-roadmap.md](07-roadmap.md).

---

## 4. Data model

Tables are grouped by domain. Columns list what matters, not every field. **The complete column list
is the Drizzle schema in `packages/db/src/schema/`**; this section states the shape and the rules,
and is not a second copy of it. Table and column names here and in the schema are identical.

### 4.1 Venue and events (P-03, P-05, P-13)

```text
organizations(id, name, timezone, support_email)
venues(id, org_id, name, address, city, timezone, floors[], capacity_default?,
       layout_version, layout_published_at)
zones(id, venue_id, name, floor, sort_order, geometry_jsonb)
rooms(id, venue_id, zone_id, name, capacity, warn_at_pct, block_at_pct,
      continuous_bool, geometry_jsonb)
checkpoints(id, venue_id, zone_id, room_id?, direction in|out|both, perimeter_bool,
            hardware_id, label, position_jsonb?)
transit_times(venue_id, from_checkpoint_id, to_checkpoint_id, min_seconds)   -- impossible-travel rule

events(id, org_id, venue_id?, slug, title, starts_at?, ends_at?, timezone, state,
       listed_bool, grace_buffer, wizard_step, published_at, updated_by,
       contact_name?, contact_email?)
event_rooms(event_id, room_id, capacity_override)
sessions(id, event_id, room_id, title, starts_at, ends_at)                   -- optional
```

`events.state` is `draft | published | live | closed | archived`. `listed_bool` is false for Private
Invitation events, which never appear in public discovery. `checkpoints.perimeter_bool` marks gates
and desks that accept QR codes (D-11). `rooms.continuous_bool` exempts a room from the session-end
occupancy reset (D-10).

- **Layout.** Zone and room `geometry_jsonb` is a shape on the abstract grid, in whole grid units.
  `checkpoints.position_jsonb` places a gate on the grid as `{x, y, side}`. Every zone or room
  change raises `venues.layout_version`, so a whole-layout publish can refuse a stale draft.
- **Drafts.** A `draft` event may have no venue and no dates yet. `events.wizard_step` records the
  furthest wizard step reached (`basics | venue | access | pass | review`), so the wizard resumes
  there.
- **Organiser contact.** `contact_name` and `contact_email` are chosen for the event and shown to
  invited guests. They hold no attendee's identity.

### 4.2 People and entitlement (P-04, P-15, D-02)

```text
users(id, email, password_hash, role, mfa_enrolled_at, ...)                  -- operators and staff
staff_assignments(id, user_id, checkpoint_id, event_id?, shift_start, shift_end,
                  handed_over_at?, scanner_device_hashes[])

attendees(id, user_id?, email?, full_name?, phone?, profile_jsonb)           -- in the identity vault
pending_registrations(id, link_token_hash, attendee_id, event_id,
                      zone_presence_consent, answers_enc, expires_at)        -- in the identity vault
invitations(id, event_id, email_hash, token_hash, state, expires_at, redeemed_at)
registrations(id, event_id, attendee_id, tier, state,
              zone_presence_consent_at, created_at)
access_rules(id, event_id, subject_kind tier|role, subject, room_id,
             window_start?, window_end?, effect permit|deny)
```

- `users.role` is `admin | organiser | supervisor | desk_clerk | security_staff | speaker | crew`
  (D-23). Admin, organiser, and supervisor sign in as operators; the others as staff.
- `registrations.tier` is `VIP | ORDINARY | PRIVATE_INVITE | PUBLIC`.
- A Public-tier attendee row has no email and no name. `attendees.phone` is optional and encrypted
  like the email.
- `pending_registrations` holds a self-service registration until its emailed sign-in link is
  opened, on any device. The answers (profile values and phone) are encrypted. The row goes when
  the link is used or expires ([03 §5](03-security-privacy.md)).
- `staff_assignments.scanner_device_hashes` records, as hashes, up to eight scanner installs the
  holder used during the shift. It lets a scan stranded on one of those phones be synced later by
  whoever staffs the gate next ([03 §4](03-security-privacy.md)).
- `access_rules` is the source of truth for the tier × room matrix. A per-credential zone permission
  bitmask may be derived from it for fast scan-time evaluation; the bitmask is a cache, never an
  authority.

### 4.3 Credentials (P-01, P-02, P-10, D-05, D-06, D-12)

```text
credentials(id, registration_id?, staff_user_id?, token_hash,
            state, zone_state, issued_at, revoked_at)
carriers(id, credential_id, kind qr_portal|qr_email|nfc, identifier, identifier_hint?,
         chip_profile?, state, bound_at, redeemed_at?)
signing_keys(id, purpose qr|allowlist, public_key, private_key_enc, active_from, retired_at)
```

- Portal QR codes and offline allowlists are signed with the active key in `signing_keys`. Scanners
  receive public keys only; no per-credential secret exists.

- `credentials.state` is `issued | active | suspended_review | revoked | replaced`.
- `credentials.zone_state` is `OUTSIDE` or `INSIDE_<zone_id>`. It drives anti-passback.
- Exactly one of `registration_id` and `staff_user_id` is set (O-09).
- `carriers.state` is `stock | assigned | bound | active | retired | lost`.
- `carriers.redeemed_at` marks the single use of an emailed QR.
- `carriers.chip_profile` records the NFC chip family ([03 §2](03-security-privacy.md)).
- `carriers.identifier_hint` is the last four characters of a wristband's UID, in upper-case hex,
  so people can tell bands apart (shown as `••••9F3A`). It is kept whenever a UID is presented. The UID
  itself is never stored; `identifier` is its hash.

### 4.4 Scans, alerts, audit (P-06, P-12, D-03, D-04)

```text
ephemeral_ids(event_id, credential_id, ephemeral_id, created_at)             -- in the identity vault
scans(id, event_id, checkpoint_id, ephemeral_id, carrier_kind, result,
      occurred_at, received_at, clock_offset_ms, idem_key, offline_bool)     -- partitioned per event
scan_voids(id, event_id, scan_id, voided_by, reason?, voided_at)             -- a scanner's undo
occupancy_adjustments(id, event_id, room_id, delta, reason session_end|recount|sync_conflict|scan_undo,
                      actor_id?, at)
breach_alerts(id, event_id, severity, kind, checkpoint_id, credential_id?,
              occurred_at, state, acked_by, acked_at, resolution_note)
audit_log(id, actor_id, action, target, meta_jsonb, at, prev_hash, hash)     -- hash-chained
webhook_endpoints(id, org_id, url, secret, events[], active)
devices(id, venue_id, kind, label, hardware_id, checkpoint_id?, token_hash?, token_version,
        state, last_heartbeat_at, last_clock_offset_ms, last_queue_depth,
        allowlist_issued_at?, last_user_id?)                                 -- gate health
```

- `scans` replaces the Blueprint's `access_logs`. It stores **which checkpoint**, never coordinates.
- `scans` references an **ephemeral attendee ID**, not the credential. The mapping lives in
  `ephemeral_ids` and is destroyed at the post-event purge, which de-identifies anything that
  survives ([03 §5–§6](03-security-privacy.md)).
- `scans.result` uses the vocabulary in [01 §7](01-product.md).
- `scans` is append-only. Occupancy is always derivable from `scans` plus `occupancy_adjustments`,
  so late offline scans can be applied and the count recomputed.
- `scans.occurred_at` is the device time; `clock_offset_ms` is the device's measured offset from
  server time. The server orders by `occurred_at + clock_offset_ms` (D-14).
- `breach_alerts.state` is `open | acked | resolved`.
- `scan_voids` is the record of an undone admission (06 S3). The scan itself stays; the correction
  sits beside it, and the count change is written as a `scan_undo` adjustment. One void per scan.
- `devices` holds fixed readers and staff phones. A staff phone is one row per install at the venue,
  whoever is signed in; `last_user_id` is the person at its last heartbeat. `allowlist_issued_at`
  is the age of the offline allowlist the device holds, reported with each heartbeat.

### 4.5 Analytics (P-14)

```text
occupancy_rollups(event_id, room_id, bucket_start, in_count, out_count, peak)
gate_rate_rollups(event_id, checkpoint_id, minute_start, scans, admitted, denied, by_tier_jsonb)
attendance_snapshots(event_id, taken_at, registered, checked_in, on_site, by_tier_jsonb)
event_reports(id, event_id, kind, state, object_key, requested_by, created_at)
```

These hold aggregates only and are retained after the purge.

`gate_rate_rollups` is written from the first day scan ingest runs on a real server, in Phase 1B
(D-16). Raw scans are destroyed after
each event, so these per-gate, per-minute rates are the only history the forecasting model in
[04-edge-ai.md](04-edge-ai.md) will ever have to learn from. An event run before this table exists
contributes nothing.

### 4.6 Rules the schema enforces

Settled while building the schema, and enforced by the database itself rather than by convention:

- **Scans are partitioned by event.** One partition per event, created automatically when the event
  is created, so the purge is a partition drop. Identifiers and `idem_key` are therefore unique per
  event. `scans` is append-only: updates and deletes are rejected.
- **Scans record direction.** A scan carries `direction` (in or out), required at a `both` gate,
  along with the device, the staff user, and what the gate decided locally when offline. The
  corrected time is computed by the database, never written by the application.
- **Occupancy corrections are anchors.** A recount or a session-end reset stores an absolute value
  (`set_to`) at a point in time; a late offline scan from before that point no longer changes the
  count. A sync-conflict correction is a relative `delta`.
- **Events move only along the lifecycle**, and publishing is refused without a pass template and at
  least one room with capacity. An event records `closed_at` and `purged_at`; after a purge the
  database refuses late scans for it.
- **Credentials:** exactly one holder; one live credential per registration or staff user.
  **Carriers:** an identifier is unique among carriers that are not retired, so a retired band can
  be re-imported; a stock band has no credential.
- **Staff shifts cannot overlap** for one person. An assignment records at most eight scanner
  installs.
- **Venue consistency:** a checkpoint's zone and an event's rooms must belong to the right venue.
- **Layout shapes are checked.** Zone and room shapes and gate positions must be valid grid shapes
  in whole units. A whole-layout publish replaces floors, zones, and rooms in one step, and only if
  the draft was made from the current `layout_version`. It refuses to remove a room that an event
  past draft uses or that has history, or gates and doors on what would go.
- **Drafts:** an event without a venue or dates must be a `draft`. A draft can be deleted only while
  nothing has happened under it (no registrations, exports, or alerts).
- **Undo leaves the scan in place.** `scan_voids` is append-only and holds one record per scan. The
  shift handover summary counts an undone admission as `undone`, not as let through.
- **Pending registrations** sit in the identity vault with row-level security forced; only the
  system scope may read, create, or delete them, and none may be changed. Their answers must be an
  encrypted envelope.
- **The phone number must be encrypted**, like the email. Erasure clears it and deletes the
  attendee's pending registrations.
- **A band hint is four upper-case hex characters**, and only on a wristband.
- **The offline allowlist agrees with the online decision.** A band that is only `assigned` (written
  at the desk, not yet confirmed) is left out, as it opens no door online. The emailed codes still
  usable are listed, so an offline gate refuses any other emailed code of the pass as spent.
- **The audit log is append-only and hash-chained** by a database trigger, which also stamps the
  time. Applications supply only actor, action, target, and detail.
- **The identity vault is a separate schema** (`pii_vault`) with row-level security forced. Every
  query against it declares a scope — system, operator, attendee, or scan — for the length of one
  transaction; with no scope, nothing is visible and writes fail.
- **Attendance survives the purge:** a registration records `checked_in_at`.
- **Erasure scrubs** an attendee's identity in place rather than deleting the row, so registrations
  and aggregates stay consistent.
- `occupancy_rollups` use 5-minute buckets. `gate_rate_rollups` are per minute.
- Alert severity is `low | medium | high | critical`. A resolved alert requires a resolution note.

Enum values are declared twice, in `packages/contracts` and in the database, and an automated test
fails if they drift.

**Sign-in state** lives in three tables: `auth_sessions` (one row per refresh token, grouped into a
family per sign-in; reuse of a rotated token revokes the whole family, except a lost reply
retried within a short grace by the same client, [03 §3](03-security-privacy.md)), `auth_links` (single-use
attendee sign-in links), and `ws_tickets` (single-use WebSocket tickets). Rotation, redemption, and
consumption are single atomic database functions. Session context is limited to a shortened user
agent and an IP prefix.

**Stored secrets are encrypted in the application layer** with AES-256-GCM. Each value is bound to
its table, column, and row, so it cannot be copied elsewhere. Several key versions can be active at
once, and a resumable job re-encrypts rows onto a new key while the system runs. This covers
attendee name, email, phone, and profile; pending-registration answers; MFA secrets; signing
private keys; report-schedule recipients; and the email outbox. The email lookup index uses a
separate key.

**Three database roles.** `app_api`, the general application role, cannot read identity at all; it
can only create an attendee, write-only. `app_scan` adds the ephemeral ID mapping. `app_vault` holds
identity and nothing operational. This contains an SQL-level compromise of the general connection;
it does not contain a fully compromised server holding all three logins.

**Stored formats.** The credential reference is 128 random bits, 22 base64url characters. Every
other token or identifier hash is base64url SHA-256, 43 characters; a wristband's UID is stored only
as such a hash. The email index is 64 hex characters.

The API uses all three on the SQL backend. Status and what remains unverified are in [07 §1.4](07-roadmap.md).

---

## 5. REST API

Base path `/api/v1`. Every payload is declared in the contract package (§7). The list below is
the contract registry, endpoint for endpoint: 132 endpoints. Who may call each one is in
[03 §3](03-security-privacy.md); "MFA" means a fresh second factor, "audited" means a hash-chained
audit entry ([03 §7](03-security-privacy.md)).

```text
Auth and time
  POST  /auth/login                 POST  /auth/refresh
  POST  /auth/email-link            (attendee asks for a sign-in link; always 202)
  POST  /auth/verify                (attendee redeems the link)
  POST  /auth/mfa/verify            (operators and staff: the second-factor step-up)
  POST  /auth/mfa/enrol             (start authenticator set-up: a secret and its QR code)
  POST  /auth/mfa/enrol/confirm     (finish set-up with a first code; also counts as a step-up; audited)
  POST  /auth/logout                (ends the session family)
  POST  /auth/ws-ticket             (single-use ticket for a WebSocket — P-16)
  POST  /auth/activate              (a new staff member sets a password from their invite)
  POST  /auth/device-token          (a fixed reader exchanges its device token — O-17)
  GET   /auth/signing-keys          (public keys for QR codes and allowlists, the QR leeway and the
                                     scanner's undo window — D-12)
  GET   /time                       (server time, for the scanner's clock offset — D-14)
  GET   /me/operator                (the signed-in operator or staff member: name, role, shift, and
                                     what the console may show)

Organisation and venue
  POST  /organizations              GET   /organizations/current  (and whether first-run setup applies)
  GET   /venues                     POST  /venues               GET  /venues/:id     PUT  /venues/:id
  PUT   /venues/:id/layout          (whole-layout publish with a version check; MFA while an event
                                     at the venue is live; audited)
  GET   /venues/:id/zones           POST  /venues/:id/zones     PUT  /zones/:id
  POST  /rooms                      PUT   /rooms/:id            POST /rooms/:id/recount
  GET   /checkpoints                POST  /checkpoints          PUT  /checkpoints/:id
                                    (a checkpoint may carry a grid position {x, y, side}; null removes it)
  GET   /checkpoints/:id/scans      GET   /checkpoints/:id/activity  (per-minute throughput)

Gates and devices
  GET   /gates/health               (also pushed as gate.health on /stream/alerts, §6)
  POST  /gates/heartbeat            (a staff phone: queue depth, clock offset, allowlist held)
  GET   /devices                    POST  /devices
  POST  /devices/:id/rotate-token   POST  /devices/:id/retire   (MFA, audited)
  POST  /devices/heartbeat          (a fixed reader's heartbeat)

Events
  GET   /events                     (public discovery; scope=all for operators; scope=work for the
                                     events the caller may work, unlisted ones included)
  POST  /events                     GET   /events/:slug         PATCH  /events/:id
  DELETE /events/:id                (a draft with nothing recorded under it)
  GET   /admin/events               (every state, with counts — 06 D4)
  GET   /events/:id/admin           (the operator's full view of one event)
  GET   /events/:id/readiness       (the checklist that guards publish)
  POST  /events/:id/publish         POST  /events/:id/state     (published → live → closed → archived)
  POST  /events/:id/duplicate
  GET   /events/:id/summary         (?series_minutes=0..240 adds a per-minute scan series)
  GET   /events/:id/sessions        POST  /events/:id/sessions
  PATCH /events/:id/sessions/:sessionId    DELETE /events/:id/sessions/:sessionId
                                    (a change of time or room notifies registered attendees)
  POST  /events/:id/notifications   (operator broadcast to the event's attendees; audited)
  GET   /events/:id/post-event-summary   (the one-page summary of a closed event — D-21)
  GET   /events/:slug/profile-schema
  GET   /events/:id/access-rules    PUT   /events/:id/access-rules
  GET   /events/:id/allowlist       (signed, for the scanner's offline cache — P-09)
  GET   /events/:id/occupancy       (public, k-anonymised occupancy, cached a few seconds — O-08)

Registration and attendees
  POST  /users/register             (always 202; the answers wait, encrypted, with the emailed link)
  PATCH /users/:id/profile
  POST  /registrations              GET   /events/:id/registrations   GET  /registrations/:id
  PATCH /registrations/:id/tier     (MFA, audited)
  POST  /kiosk/registrations        (Public tier, anonymous — O-10)
  POST  /invitations
  POST  /invitations/read           (read an open invitation before replying; token in the body)
  POST  /invitations/rsvp           (accept or decline; token in the body)
  POST  /invitations/:token/rsvp    (the older form with the token in the path; kept working)
  GET   /attendees
  GET   /data-requests              POST  /data-requests/:id/process   POST  /data-requests/:id/reject
                                    (attendee export and erasure queue; process and reject: MFA, audited)

Credentials and carriers
  GET   /credentials                GET   /credentials/inventory
  POST  /credentials/:id/resend     (MFA, audited)
  POST  /credentials/:id/revoke     POST  /credentials/:id/clear-review
  GET   /credentials/:id/scans      (the audited access-history lookup of one credential)
  POST  /carriers/import            POST  /carriers/bind        POST  /carriers/:id/rebind  (MFA)
  POST  /carriers/desk-code         (a six-character code the attendee uses to bind a band)

Scans and alerts
  POST  /scans                      (batch, idempotent — online scans and offline sync; an item over
                                     the checkpoint's per-minute limit is refused as RATE_LIMITED,
                                     not stored, and resent unchanged; a queued item may name its
                                     assignment so it can sync after the shift)
  POST  /scans/:id/undo             (the scanner's own admission, inside the undo window; audited)
  GET   /scans                      (paged, with filters and totals; a search for one pass is the
                                     audited access-history lookup)
  GET   /breach-alerts              GET   /alerts/:id           (detail: gate, room, scans, history)
  POST  /alerts/:id/ack             POST  /alerts/:id/resolve

Staff
  GET   /staff                      POST  /staff                (invite by email; audited)
  PATCH /staff/:id                  (change a role, never one's own; MFA, audited)
  GET   /staff-assignments          POST  /staff-assignments
  POST  /staff-assignments/:id/handover  (ends a shift and returns its summary)
  GET   /me/assignments             (staff: own current and next shifts)

Reports
  GET   /reports                    GET   /reports/:eventId     GET   /reports/:eventId/:kind
  POST  /reports/:id/export         (async job: Excel workbook, CSV, PDF summary — P-14, D-21)
  GET   /events/:id/report-schedules              POST  /events/:id/report-schedules  (MFA, audited)
  PATCH /events/:id/report-schedules/:scheduleId  (pause or resume; audited)
  DELETE /events/:id/report-schedules/:scheduleId (audited)
  GET   /dashboard

Webhooks
  GET   /webhooks                   POST  /webhooks             PATCH  /webhooks/:id
  DELETE /webhooks/:id              POST  /webhooks/:id/rotate-secret   (all changes MFA, audited)
  GET   /webhooks/:id/deliveries

Attendee self-service
  GET   /me                         (own identity, email and phone masked)
  PATCH /me/profile                 (name, profile answers, phone)
  GET   /me/registrations           (every own registration, with its event and pass state)
  GET   /me/registration            (own registration for one event, for the event page)
  GET   /me/credential              POST  /me/credential/bind
  POST  /me/credential/resend       (emails a fresh single-use copy of the own pass; always 202)
  POST  /me/credential/report-lost  (the holder reports their wristband lost; audited)
  GET   /me/credential/codes        (a batch of signed portal QR codes — D-12)
  GET   /me/sessions                GET   /me/notifications
  POST  /me/notifications/read      (mark own notifications read)
  POST  /me/data-export             POST  /me/data-erasure
  GET   /me/data-requests           GET   /me/data-export/:id
```

---

## 6. WebSocket channels

| Channel | Who may join | Carries |
| --- | --- | --- |
| `/stream/scans` | Operators, for an event; gate staff, only for the checkpoints they staff now, closed when the shift ends | `scan.result` for those gates; takes the scanner's `heartbeat` |
| `/stream/telemetry` | Operators; a reduced public scope for signed-in attendees and staff | `occupancy.snapshot`, then `occupancy.delta` |
| `/stream/alerts` | Operators; gate staff for their current gates only | `alert.raised`, `alert.updated`, `gate.health` |
| `/stream/me` | Attendee | `pass.status` and `entitlements.updated` for the own pass |

**Frames.** After connecting, the client sends `hello`, with a `last_event_id` when resuming. The
server answers `ready`, then either replays what was missed or sends a fresh snapshot. Every data
frame carries an increasing `id` to resume from. Both sides may send `ping`; the server answers
`pong` with its time, and sends its own `heartbeat` with the server time every 15 seconds on every
channel, so a client can tell a quiet stream from a dead one. Errors arrive as `error` frames with a
contract error code.

**Gate health is pushed.** While anyone follows `/stream/alerts`, the server reads gate health for
the live events every 5 seconds and sends a `gate.health` frame for each gate whose state changed:
link state, unsynced scans, clock fault, or a stale allowlist. Counts that move with every scan do
not count as a change. Gate staff receive only their own gates. The same figures are available from
`GET /gates/health`.

**Gate staff see what to act on, not who.** An alert sent to gate staff never names the credential
involved; read over REST, it also leaves out the scan ids and the operator's note. A desk clerk joins no channel: the desk works over REST only (D-23).

**Data rate is not frame rate (P-07).** The server sends coalesced deltas at **4 Hz at most** — on
change, batched per 250 ms. The client interpolates between authoritative states on
`requestAnimationFrame`. Sixty frames per second is a property of the client's render loop and is
never a claim about the network.

**Totals.** Occupancy snapshots and deltas also carry event totals (`on_site`, `in_rooms`). On the
public scope the totals are withheld below the minimum crowd size (O-08), like any other count, and
they add up only the counts that are shown, never the full sums: a total minus the shown rooms
would otherwise reveal a hidden room. A public delta is sent only when a shown value changes. The
same public view is readable without signing in from `GET /events/:id/occupancy`; the live channel
itself stays closed to visitors who are not signed in (O-19).

**Refused scanners.** A connection to `/stream/scans` with an invalid ticket, or for a checkpoint
the user is not staffing now, is refused and raises a `rogue_scanner` alert on `/stream/alerts`
([03 §8.2](03-security-privacy.md)). A heartbeat from a retired scanner closes the stream.

**Heartbeats.** A scanner's heartbeat frame carries its queue depth, clock offset, link state, its
device id (the same id it sends over REST), and when the allowlist it holds was issued, so gate
health is recorded per device and a stale allowlist shows ([01 §8](01-product.md)). A phone sends
it every 15 seconds on the stream, or every 25 seconds to `POST /gates/heartbeat` while the stream
is closed.

**Reconnection.** Exponential backoff with jitter, and a `last_event_id` cursor so missed events are
replayed.

Connection authentication is specified in [03 §3](03-security-privacy.md). Outbound webhooks mirror
`/stream/alerts` to external endpoints and are HMAC-signed.

---

## 7. Contract package

```text
packages/contracts/
  src/rest/          Zod schemas per endpoint → inferred TypeScript types
  src/ws/            Discriminated unions per channel event
  src/enums/         ScanResult, AlertKind, Severity, CredentialState, CarrierState,
                     EventState, AttendeeTier, Role, WizardStep, ReportCadence, and the rest
  src/errors/        Canonical error codes and their human strings; scan-result copy
  src/copy/          State words for credentials, carriers, registrations, invitations, events,
                     and roles
  src/qr/            The compact signed QR format (03 §2)
  src/brand.ts       The product name, and every wire constant derived from it
```

`src/rest` holds one registry of every endpoint in §5. Each entry states its method, path, permitted
roles, whether it needs MFA, whether it is audited, its rate-limit bucket (`auth`, `scan`, `resend`,
or `public`), and its request and response schemas. The API mounts every entry: one without a
handler still checks sign-in and role, then answers 501.

- **The role matrix is pinned.** A contracts test lists, for each role, exactly which endpoints it
  may call, so a new endpoint must be placed deliberately ([03 §3](03-security-privacy.md)).
- **The console reads its permissions from the registry.** `GET /me/operator` returns the names of
  the endpoints the caller's role may call. Admin Command uses them only to narrow its own map of
  screens per role, never to widen it.
- **Enumerations named in the spec** include the roles (with `supervisor` and `desk_clerk`, D-23),
  the alert kinds (with `band_reported_lost`, raised at low severity when a holder reports their
  wristband lost), the report cadences (`on_close | daily | weekly | monthly`), and the five wizard
  steps.

Rules:

- `packages/contracts` is the **only** place a payload shape is declared. The frontend builds against
  it, with mocks or the real API; the backend imports it directly. No hand-written duplicate types.
- Admin Command's API client checks every request against the contract before sending it and every
  reply before a screen sees it (O-26). The Attendee Portal and the Gate Scanner use the same types.
- UI copy for result and error states is imported from `src/errors`, never retyped per screen. A new
  server result code is a type error until the UI handles it.
- Versioned by git tag. A schema change is a breaking change for all three apps.

---

## 8. Mock-first data strategy

Each app runs against one of two data sources, chosen when it is built:

| `VITE_API_URL` | Data source |
| --- | --- |
| Unset | The deterministic mock layer in `packages/mock`, in the browser. No server is needed |
| Set to the API's origin | The real API at that origin, over REST and WebSocket. The API must list the app's origin in `ALLOWED_ORIGINS` |

The switch is the same in all three apps. Each app has one data interface with two
implementations, and the build loads only the one it needs, so a real-API build carries no mock
code and a mock build carries no API client. Screens never know which one they are using: they
read the same contract shapes either way. In API mode, Admin Command and the Gate Scanner show a
sign-in screen; in mock mode, sign-in is a stand-in.

The mock is an in-process store that returns the contract shapes directly. The MSW request
handlers described below would let screens in mock mode fetch over HTTP exactly as they do in API
mode.

- **REST:** MSW handlers built from the same Zod schemas, backed by seeded fixtures — 2 venues,
  60 rooms, 1,400 attendees, 40,000 scans.
- **WebSocket:** `MockRealtime`, implementing the same client interface as the real socket, able to
  replay named scenarios:

  | Scenario | Exercises |
  |---|---|
  | `doors_open` | Burst of 40 scans per second |
  | `capacity_overflow` | Room passes warn, then block threshold |
  | `breach_restricted_room` | Tier denied at a restricted room, alert raised |
  | `gate_offline` | Gate loses link, queues, reconnects |
  | `credential_revoked_mid_pass` | Pass screen flips to revoked while open |
  | `impossible_travel` | Credential suspended for review |
  | `offline_conflict` | Two offline gates accept the same single-use QR; caught and alerted at sync |
  | `occupancy_drift` | Nobody taps out; implied exits and the session-end reset correct the count |
  | `clock_skew` | A scanner with a wrong clock syncs; scans are ordered correctly |

- **Time:** a controllable clock, so event states and retention windows are testable.

Scenario names are used in the demo script and in acceptance tests, so "show me a breach" is one
click. Switching an app from the mock to the real API changes no screen and no copy, only
transport.

---

## 9. Performance targets (P-07, P-17)

These are binding and testable.

**Service levels**

| Path | Target |
| --- | --- |
| Scan → gate result on screen, online | p95 < 300 ms |
| Scan → gate result, offline | p95 < 120 ms (local) |
| Admin map delta → paint | p95 < 400 ms |
| Alert emitted → admin banner | p95 < 500 ms |
| Concurrent scanners | 200 sustained |
| Scans per second, peak | 40/s for a 10 s burst |

**Client budgets**

| Metric | Budget |
| --- | --- |
| Admin map, 60 rooms, 4 Hz deltas | ≥ 55 FPS sustained |
| Telemetry ingest | ≤ 4 Hz per channel, coalesced 250 ms |
| Scan verdict render | < 16 ms after the local decision |
| Admin initial JS, route-split | ≤ 200 KB gzip, including the client that checks every request and reply against the contracts (O-26) |
| Attendee pass screen | ≤ 125 KB gzip for everything loaded before the pass appears (HTML, styles, code; fonts excluded), first paint < 1.2 s on 4G (O-15) |
| Scanner first interactive | < 1.5 s, fully usable offline thereafter |

Sizes are gzip, for a real-API build. The admin
figure is the JavaScript a signed-in operator loads to open the Command Center. The pass figure
counts the page, its styles, the app's start-up code, and the pass screen; the API client is
loaded after the pass is on screen, because the device keeps the last pass and its codes.

**Implementation notes**

- Occupancy bars animate with `transform: scaleX`, never `width`.
- The map is a canvas (or SVG for 80 rooms or fewer) driven by `requestAnimationFrame`. It is never
  re-rendered by React per frame.
- Lists beyond 100 rows are virtualised.
- No animation runs while the tab is hidden.
- Live data never animates through a CSS transition on the same property it is interpolating.
