# Connexia — Architecture

How Connexia is built: stack, repository, data model, API, real-time channels, and performance
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
| Routing | React Router | Already in both apps |
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

```
apps/
  attendee/      Attendee Portal            (port 5173)
  admin/         Admin Command              (port 5174)
  scanner/       Gate Scanner PWA           — planned
packages/
  ui/            Shared tokens, motion, components
  contracts/     Zod schemas for REST and WS — planned
  mock/          Mock REST and WS layer      — planned
docs/            This specification
```

What exists today versus what is planned is tracked in [07-roadmap.md](07-roadmap.md).

---

## 4. Data model

Tables are grouped by domain. Columns list what matters, not every field. The model is implemented in
Phase 4; until then it is the shape the contracts and mocks follow.

### 4.1 Venue and events (P-03, P-05, P-13)

```
organizations(id, name, timezone, support_email)
venues(id, org_id, name, address, timezone)
zones(id, venue_id, name, floor, geometry_jsonb)
rooms(id, venue_id, zone_id, name, capacity, warn_at_pct, block_at_pct,
      continuous_bool, geometry_jsonb)
checkpoints(id, venue_id, zone_id, room_id?, direction in|out|both, perimeter_bool,
            hardware_id, label)
transit_times(venue_id, from_checkpoint_id, to_checkpoint_id, min_seconds)   -- impossible-travel rule

events(id, org_id, venue_id, slug, title, starts_at, ends_at, timezone, state,
       listed_bool, grace_buffer)
event_rooms(event_id, room_id, capacity_override)
sessions(id, event_id, room_id, title, starts_at, ends_at)                   -- optional
```

`events.state` is `draft | published | live | closed | archived`. `listed_bool` is false for Private
Invitation events, which never appear in public discovery. `checkpoints.perimeter_bool` marks gates
and desks that accept QR codes (D-11). `rooms.continuous_bool` exempts a room from the session-end
occupancy reset (D-10).

### 4.2 People and entitlement (P-04, P-15, D-02)

```
users(id, email, password_hash, role, mfa_enrolled_at, ...)                  -- operators and staff
staff_assignments(id, user_id, checkpoint_id, shift_start, shift_end)

attendees(id, user_id?, email?, full_name?, profile_jsonb)                   -- in the identity vault
invitations(id, event_id, email_hash, token_hash, state, expires_at, redeemed_at)
registrations(id, event_id, attendee_id, tier, state,
              zone_presence_consent_at, created_at)
access_rules(id, event_id, subject_kind tier|role, subject, room_id,
             window_start?, window_end?, effect permit|deny)
```

- `users.role` is `admin | organiser | security_staff | speaker | crew`.
- `registrations.tier` is `VIP | ORDINARY | PRIVATE_INVITE | PUBLIC`.
- A Public-tier attendee row has no email and no name.
- `access_rules` is the source of truth for the tier × room matrix. A per-credential zone permission
  bitmask may be derived from it for fast scan-time evaluation; the bitmask is a cache, never an
  authority.

### 4.3 Credentials (P-01, P-02, P-10, D-05, D-06, D-12)

```
credentials(id, registration_id?, staff_user_id?, token_hash,
            state, zone_state, issued_at, revoked_at)
carriers(id, credential_id, kind qr_portal|qr_email|nfc, identifier, chip_profile?,
         state, bound_at, redeemed_at?)
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

### 4.4 Scans, alerts, audit (P-06, P-12, D-03, D-04)

```
ephemeral_ids(event_id, credential_id, ephemeral_id, created_at)             -- in the identity vault
scans(id, event_id, checkpoint_id, ephemeral_id, carrier_kind, result,
      occurred_at, received_at, clock_offset_ms, idem_key, offline_bool)     -- partitioned per event
occupancy_adjustments(id, event_id, room_id, delta, reason session_end|recount|sync_conflict,
                      actor_id?, at)
breach_alerts(id, event_id, severity, kind, checkpoint_id, credential_id?,
              occurred_at, state, acked_by, acked_at, resolution_note)
audit_log(id, actor_id, action, target, meta_jsonb, at, prev_hash, hash)     -- hash-chained
webhook_endpoints(id, org_id, url, secret, events[], active)
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

### 4.5 Analytics (P-14)

```
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

---

## 5. REST API

Base path `/api/v1`. Every payload is declared in the contract package (§7).

```
Auth
  POST  /auth/login                 POST  /auth/refresh
  POST  /auth/verify                (attendee email link)
  POST  /auth/mfa/verify            (operators; required for privileged actions)
  POST  /auth/ws-ticket             (single-use ticket for a WebSocket — P-16)
  GET   /auth/signing-keys          (public keys for verifying QR codes and allowlists — D-12)
  GET   /time                       (server time, for the scanner's clock offset — D-14)

Organisation and venue
  POST  /organizations
  GET   /venues                     POST  /venues               GET  /venues/:id
  GET   /venues/:id/zones           POST  /venues/:id/zones     PUT  /zones/:id
  POST  /rooms                      PUT   /rooms/:id            POST /rooms/:id/recount
  GET   /checkpoints                GET   /checkpoints/:id/scans
  GET   /gates/health

Events
  GET   /events                     POST  /events               GET  /events/:slug
  PATCH /events/:id                 POST  /events/:id/publish
  GET   /events/:id/summary         GET   /events/:id/sessions
  GET   /events/:slug/profile-schema
  GET   /events/:id/access-rules    PUT   /events/:id/access-rules
  GET   /events/:id/allowlist       (signed, for the scanner's offline cache — P-09)

Registration and attendees
  POST  /users/register             PATCH /users/:id/profile
  POST  /registrations              GET   /events/:id/registrations
  PATCH /registrations/:id/tier     (MFA, audited)
  POST  /invitations                POST  /invitations/:token/rsvp
  GET   /attendees

Credentials and carriers
  GET   /credentials                GET   /credentials/inventory
  POST  /credentials/:id/resend     POST  /credentials/:id/revoke
  POST  /credentials/:id/clear-review
  POST  /carriers/import            POST  /carriers/bind        POST  /carriers/:id/rebind

Scans and alerts
  POST  /scans                      (batch, idempotent — online scans and offline sync)
  GET   /scans                      (paged)
  GET   /breach-alerts              POST  /alerts/:id/ack       POST  /alerts/:id/resolve

Staff
  GET   /staff                      GET   /staff-assignments    POST  /staff-assignments

Reports
  GET   /reports                    GET   /reports/:eventId     GET   /reports/:eventId/:kind
  POST  /reports/:id/export         (async job — P-14)
  GET   /dashboard

Attendee self-service
  GET   /me/credential              POST  /me/credential/bind
  GET   /me/credential/codes        (a batch of signed portal QR codes — D-12)
  GET   /me/sessions                GET   /me/notifications     GET  /me/assignments
  POST  /me/data-export             POST  /me/data-erasure
```

---

## 6. WebSocket channels

| Channel | Who may join | Carries |
| --- | --- | --- |
| `/stream/scans` | Staff, scoped to assigned checkpoints | Scan results for those gates |
| `/stream/telemetry` | Admin; a reduced public scope for event pages | Zone and room occupancy deltas |
| `/stream/alerts` | Admin | Breach alerts and system health |
| `/stream/me` | Attendee | Own pass status and own room entitlements |

**Data rate is not frame rate (P-07).** The server sends coalesced deltas at **4 Hz at most** — on
change, batched per 250 ms. The client interpolates between authoritative states on
`requestAnimationFrame`. Sixty frames per second is a property of the client's render loop and is
never a claim about the network.

**Reconnection.** Exponential backoff with jitter, and a `last_event_id` cursor so missed events are
replayed.

Connection authentication is specified in [03 §3](03-security-privacy.md). Outbound webhooks mirror
`/stream/alerts` to external endpoints and are HMAC-signed.

---

## 7. Contract package

```
packages/contracts/
  src/rest/          Zod schemas per endpoint → inferred TypeScript types
  src/ws/            Discriminated unions per channel event
  src/enums/         ScanResult, AlertKind, Severity, CredentialState, CarrierState,
                     EventState, AttendeeTier, Role
  src/errors/        Canonical error codes and their human strings
```

Rules:

- `packages/contracts` is the **only** place a payload shape is declared. The frontend builds against
  it with mocks; the backend imports it directly. No hand-written duplicate types.
- UI copy for result and error states is imported from `src/errors`, never retyped per screen. A new
  server result code is a type error until the UI handles it.
- Versioned by git tag. A schema change is a breaking change for all three apps.

---

## 8. Mock-first data strategy

Until the backend exists, all three apps run against a deterministic mock layer in `packages/mock`.

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
click. When the backend lands, the mock is switched off per endpoint; no screen changes copy, only
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
| Admin initial JS, route-split | ≤ 180 KB gzip per surface |
| Attendee pass screen | ≤ 90 KB gzip, first paint < 1.2 s on 4G |
| Scanner first interactive | < 1.5 s, fully usable offline thereafter |

**Implementation notes**

- Occupancy bars animate with `transform: scaleX`, never `width`.
- The map is a canvas (or SVG for 80 rooms or fewer) driven by `requestAnimationFrame`. It is never
  re-rendered by React per frame.
- Lists beyond 100 rows are virtualised.
- No animation runs while the tab is hidden.
- Live data never animates through a CSS transition on the same property it is interpolating.
