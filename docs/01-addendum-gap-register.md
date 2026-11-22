# Addendum A — Gap Register & Ratified Patches

**Document:** Connexia Technical Blueprint → Addendum A
**Version:** 1.0 — **RATIFIED**
**Status:** Normative. Where this addendum conflicts with the Blueprint, this addendum wins.
**Scope:** Gaps found while converting the Blueprint into a frontend-first build plan.

---

## A.0 Authority statement

The Blueprint is an *architecture* document. It does not specify information architecture, screen
inventory, credential lifecycle, hardware provisioning, degrades modes, or data-protection posture.
Those omissions are product-critical, not cosmetic — the frontend cannot be designed without deciding
them, because they determine what the user sees on every screen.

Every patch below is **official**: it is part of the specification as of v1.0 and must be reflected in
the API contract, database schema, and UI. Patches are numbered `P-nn` and referenced by ID from the
frontend plan and from code comments where a decision looks arbitrary.

**Governance.** This document and the frontend plan are the specification. New findings are folded
into the relevant section and the changelog below; they do not become new files. A patch is superseded
by editing its entry, never by appending a second opinion.

---

## A.1 Summary table

| ID | Gap | Severity | Patch headline |
|----|-----|----------|----------------|
| P-01 | Blueprint contradicts itself: email QR vs. wristband QR | Blocker | One credential, three carriers |
| P-02 | Credential lifecycle undefined | Blocker | `credentials` + `carriers` model |
| P-03 | No venue/zone hierarchy | Blocker | Org → Venue → Zone → Room |
| P-04 | No registration/entitlement table | Blocker | `registrations` + `access_rules` |
| P-05 | Checkpoints referenced, never modelled | High | `checkpoints` with direction |
| P-06 | Occupancy math unspecified | High | in − out, anti-passback, debounce |
| P-07 | "60 FPS telemetry" conflates render rate with data rate | High | ≤4 Hz deltas, client interpolation |
| P-08 | No scanner client in frontend architecture | Blocker | Third surface: Gate Scanner PWA |
| P-09 | No offline/degraded mode | Blocker | Signed offline allowlist + queue |
| P-10 | NFC provisioning workflow absent | High | Desk provisioning + band states |
| P-11 | Email pass delivery has no provider or fallback | High | Transactional provider, resend, wallet |
| P-12 | Attendee geolocation = personal data, unaddressed | Blocker (legal) | Zone presence only, consent, retention |
| P-13 | Event lifecycle & timezone undefined | Medium | 5 states, per-event tz, sessions |
| P-14 | Reporting under-specified | Medium | Report types, async export, scheduling |
| P-15 | Staff assignment / shift / audit absent | High | `staff_assignments`, `audit_log` |
| P-16 | WS auth via query string | Medium | Ticket exchange + subprotocol |
| P-17 | No SLOs, no acceptance criteria | Medium | Scan→confirm p95 < 300 ms, stated targets |

---

## A.2 Detailed patches

### P-01 — The Blueprint contradicts itself on the QR credential

**Gap.** §4.2 appears twice with different content. The first instance describes the checkpoint channel
as receiving scans "from both mobile email QR passes and mandatory NFC wristbands." The repeated
instance describes a "QR Wristband Checkpoint Channel" and "Cryptographic QR Wristband Payloads."
§6 closes with "digital QR wristband display," which is a third reading. The reader cannot determine
whether the QR is emailed, rendered on the attendee's phone, or printed on the wristband.

**Impact.** This single ambiguity changes the registration flow, the email template, the attendee
"pass" screen, the scanner UI, and the database model. It cannot be left open.

**Verified against the file.** The duplication is a copy-paste artefact: pages 4–5 repeat §4.2, §5 and
§6, and the later copy silently deletes the email QR. The document was edited twice and merged badly.

**Patch (P-01).** There is **one credential** per registration and **three carriers** for it:

1. **Digital QR** — rendered in the attendee portal on the phone (canonical, always current).
2. **Emailed QR pass** — the same signed payload, delivered by transactional email at registration and
   re-deliverable on demand. It is a *convenience copy*, not a separate credential; revoking the
   credential invalidates every copy.
3. **NFC wristband** — the credential's identifier written to a physical band at a provisioning desk.

All three resolve to the same `credential_id`, so a scan is idempotent regardless of carrier, and a
duplicate read of email-QR then wristband at the same gate is detected as a duplicate, not a second
admission. The wristband is **mandatory for physical entry**; the QR carriers are for self-service,
kiosk, and fallback.

Supersedes: second occurrence of §4.2, §5 bullet "Cryptographic QR Wristband Payloads," and the
"digital QR wristband display" phrasing in §6.

---

### P-02 — Credential lifecycle is undefined

**Gap.** `access_credentials` appears once in a table list with no columns, no states, and no described
lifecycle. Nothing states what happens when a band is lost, a registration is cancelled, or an attendee
transfers their ticket.

**Patch (P-02).** Credential states: `issued → active → revoked`, plus `replaced` (superseded by a
re-issue). Carrier states: `stock → assigned → bound → active → retired | lost`. Revoking a credential
immediately invalidates all bound carriers; the scanner rejects with `CREDENTIAL_REVOKED`, distinct from
`UNKNOWN_TOKEN`, so gate staff can distinguish fraud from a lost band.

---

### P-03 — No venue/zone hierarchy

**Gap.** The Blueprint lists `events, rooms` but the prose repeatedly refers to "multi-space room
hierarchies" and "physical venue zones." A room cannot exist without a venue, and zones are what the
map renders.

**Patch (P-03).** Hierarchy: `organizations → venues → zones (floor) → rooms`. Rooms carry a capacity
and an optional geometry blob for the map. Events are hosted at a venue and grant access to a subset
of its rooms via `event_rooms`.

---

### P-04 — No registration or entitlement table

**Gap.** `users` and `events` exist; nothing joins them. `access_credentials` implies registration but
"which attendee may enter which room, for which event, at which time" is never modelled.

**Patch (P-04).** `registrations(event_id, attendee_id, tier, state)` plus `access_rules` scoped by
tier and room. Scanner authorization is: credential → registration → event_room → access_rule. Attendee
tiers (e.g. General / Speaker / Crew) are what make restricted-room breaches possible in the first place.

---

### P-05 — Checkpoints are referenced but never modelled

**Gap.** §3 says `access_logs` stores "checkpoint IDs," but no table defines a checkpoint. Occupancy
counting also requires knowing whether a checkpoint is an entry, an exit, or bidirectional.

**Patch (P-05).** `checkpoints(id, venue_id, zone_id, room_id nullable, direction in|out|both, hardware_id, label)`.
Fixed NFC readers and the scanner PWA both attach to a checkpoint. A checkpoint with no heartbeat for
>60 s is surfaced as a gate-health fault on the command center.

---

### P-06 — Occupancy mathematics are unspecified

**Gap.** "Detects duplicate wristband use" and "capacity overflow" are stated as outcomes only. There is
no definition of occupancy, no anti-passback rule, and no debounce window.

**Patch (P-06).**

- Room occupancy = admissions at `direction=in` checkpoints − `direction=out` exits, per event.
- **Debounce:** an identical credential at the same checkpoint within 60 s is ignored and logged as
  `DUPLICATE_READ` (not an alert).
- **Anti-passback:** an `in` scan for a credential already inside the same zone is `ALREADY_INSIDE`
  (amber, not red). Re-entry after an `out` scan is permitted.
- **Capacity policy** is per room: `warn_at_pct` (default 85) and `block_at_pct` (default 100). Blocking
  is configurable to *admit-with-alert* for fire-code regimes where refusal at the door is worse.
- Occupancy never goes negative; a negative result is clamped to 0 and logged as a reconciliation fault.

---

### P-07 — "60 FPS" is a render target, not a data rate

**Gap.** §4.2 says telemetry is pushed "directly to the React admin map at 60 FPS," and §1 claims
"60 frames per second visual dashboards." If read literally, the server would emit 60 messages per
second per client — the opposite of the low-latency, low-bandwidth design the document claims.

**Patch (P-07).** Server emits coalesced deltas at **≤4 Hz** (or on change, batched per 250 ms). The
client interpolates between authoritative states on `requestAnimationFrame`. 60 FPS is a property of the
render loop and is never asserted about the network. The perf budget is stated explicitly in the
frontend plan (§9) and is testable.

---

### P-08 — No scanner client exists in the frontend architecture

**Gap.** §6 defines exactly two portals (Admin, Attendee), yet §4.2 requires a client that produces
high-frequency scans from QR and NFC at checkpoints. Neither portal does this.

**Patch (P-08).** Add a **third surface**: the Gate Scanner (installable PWA, phone/tablet, role
`Security Staff`). It is camera-first for QR, NFC-capable where the browser exposes Web NFC (Android
Chrome), and always offers manual UID entry. Fixed hardware readers bypass the UI and POST directly to
the same ingest endpoint.

---

### P-09 — No offline or degraded mode

**Gap.** Nothing in the Blueprint survives a venue dropping connectivity, which is the single most
common real-world failure at large events. A gate that cannot verify admissions stops the queue.

**Patch (P-09).** The scanner caches a **signed eligibility allowlist** for its assigned event and shift
(credential hash, tier, permitted rooms, revocation epoch). Scans are evaluated locally, queued with a
client-generated `idem_key`, and synced on reconnect. Server-side, the queue is applied in
`occurred_at` order with idempotent upserts. The command center shows per-gate link status and queue
depth; "offline 4m, 182 queued" is a first-class UI state, not an error.

Offline mode **fails closed for unknown tokens** and **fails open with alert for allowlisted credentials
when the allowlist is stale beyond 15 minutes** — the queue must not stop.

---

### P-10 — NFC wristband provisioning is absent

**Gap.** Wristbands are "mandatory" and "pre-programmed," but no screen, table, or state machine explains
who writes a UID to a band, when, and what happens on loss.

**Patch (P-10).** Provisioning desk flow: bulk UID import (CSV of manufacturing serials) → band enters
`stock` → staff scans band + selects registration → `assigned` → confirmed write/verify → `bound` →
`active`. Lost band: mark `lost`, revoke credential, issue replacement, re-bind to the same registration.
The band UID is never the credential; it is a carrier that points at one.

---

### P-11 — Email pass delivery has no provider, no fallback, no resend

**Gap.** "Immediately trigger an automated transactional email containing the attendee's dynamic QR entry
pass" is the entire specification. Deliverability, resend, expiry, and the on-site fallback are all missing.

**Patch (P-11).** Transactional provider with a verified sending domain and bounce handling. Pass link is
short-lived and signed; the QR payload itself is stable and signed. Attendee can resend (rate-limited),
add to Apple/Google Wallet, or show the in-app pass. On-site fallback: lookup by email + photo ID at the
provisioning desk. An undelivered pass is surfaced to the attendee ("check spam", "resend") and to the
admin (delivery failures per event).

---

### P-12 — Attendee geolocation is unaddressed personal data

**Gap.** §3 stores "geolocation/zone coordinates," and §4.2 streams "attendee movement deltas." This is
continuous tracking of identified individuals in a physical space. No consent, retention, or lawful basis
is stated.

**Patch (P-12).** **No precise coordinates are ever stored or streamed.** The system stores *zone
presence events* (which zone, entry/exit timestamps) — the minimum needed for occupancy and dwell. The
attendee consents at registration (prominent, separable from event terms). Retention: raw scan events
30 days (configurable), aggregates indefinite, alerts 12 months. DSAR export and erasure are supported.
The admin UI displays occupancy per zone/room, never an individual's position over time except as an
access-history audit for a specific credential.

---

### P-13 — Event lifecycle and timezone undefined

**Gap.** Events have "schedules" but no states, and no timezone handling — fatal for multi-city events
and for "live" vs "scheduled" UI.

**Patch (P-13).** States: `draft → published → live → closed → archived`. Transitions are guarded
(publishing requires at least one room, a pass template, and capacity). Every event carries an IANA
timezone; all times are stored UTC and rendered in event-local time with the zone labelled. Optional
`sessions` (schedule blocks) scope room capacity by time window.

---

### P-14 — Reporting is under-specified

**Gap.** One endpoint, `GET /reports/:eventId`, "aggregates historical scan logs." No report types, no
format, no export mechanism, no scheduling, despite "automated post-event reporting" being a headline
capability.

**Patch (P-14).** Report types: Attendance, Dwell & Flow, Peak Occupancy, Breach & Compliance, Gate
Throughput. Response is paginated JSON for on-screen view; export is an **async job** producing CSV
(always) and PDF (summary), delivered by signed short-lived URL, and optionally emailed on a schedule.

---

### P-15 — No staff assignment, shift, or audit trail

**Gap.** RBAC defines "Security Staff" as a role but never says which gate they work, when, or what they
are allowed to do at it. Admin actions are not audited.

**Patch (P-15).** `staff_assignments(user_id, checkpoint_id, shift_start, shift_end)` drives which gate
the scanner PWA may pair with and which allowlist it caches. Shift handover is a screen. All
privileged mutations write to `audit_log(actor, action, target, meta, at)`.

---

### P-16 — WebSocket authentication via query string

**Gap.** Tokens in the WS URL end up in proxy logs and browser history.

**Patch (P-16).** `POST /api/v1/auth/ws-ticket` mints a single-use, 30-second ticket; the client passes it
via the `Sec-WebSocket-Protocol` subprotocol. Each channel independently authorises (attendee may only
join `stream/me`; staff joins `stream/scans` for assigned checkpoints only). Reconnect uses exponential
backoff with jitter and a `last_event_id` cursor for replay.

---

### P-17 — No SLOs or acceptance criteria

**Gap.** No latency target, no load target, no definition of done.

**Patch (P-17).** Binding targets:

| Path | Target |
|------|--------|
| Scan → gate result on screen (online) | p95 < 300 ms |
| Scan → gate result (offline) | p95 < 120 ms (local) |
| Admin map delta → paint | p95 < 400 ms |
| Alert emit → admin banner | p95 < 500 ms |
| Concurrent scanners | 200 sustained |
| Scans per second, peak | 40/s burst 10 s |
| Admin dashboard | ≥55 FPS with 60 rooms live |

---

## A.3 Resulting data model delta

Added or clarified relative to the Blueprint's four named tables:

```
organizations(id, name, ...)
venues(id, org_id, name, address, timezone)
zones(id, venue_id, name, floor, geometry_jsonb)
rooms(id, venue_id, zone_id, name, capacity, warn_at_pct, block_at_pct, geometry_jsonb)
events(id, org_id, venue_id, slug, title, starts_at, ends_at, timezone, state)
event_rooms(event_id, room_id, capacity_override, access_rule_id)
sessions(id, event_id, room_id, title, starts_at, ends_at)            -- optional
users(id, email, password_hash, role, ...)                            -- admin/staff
attendees(id, user_id, email, full_name, profile_jsonb)               -- JSONB per Blueprint
registrations(id, event_id, attendee_id, tier, state, created_at)
credentials(id, registration_id, token_hash, state, issued_at, revoked_at)
carriers(id, credential_id, kind qr|nfc, identifier, state, bound_at)
checkpoints(id, venue_id, zone_id, room_id?, direction in|out|both, hardware_id, label)
staff_assignments(id, user_id, checkpoint_id, shift_start, shift_end)
scans(id, checkpoint_id, credential_id, carrier_id?, result, occurred_at,
      received_at, idem_key, offline_bool)                            -- replaces access_logs
breach_alerts(id, event_id, severity, kind, scan_id?, state, acked_by, acked_at)
occupancy_rollups(event_id, room_id, bucket_start, in_count, out_count, peak)
attendance_snapshots(...)                                             -- per Blueprint
event_reports(id, event_id, kind, state, object_key, requested_by, created_at)
audit_log(id, actor_id, action, target, meta_jsonb, at)
webhook_endpoints(id, org_id, url, secret, events[], active)
```

## A.4 Resulting API delta

Beyond the Blueprint's endpoints:

```
POST  /api/v1/auth/ws-ticket
GET   /api/v1/venues                POST /api/v1/venues
GET   /api/v1/venues/:id/zones      POST /api/v1/venues/:id/zones
POST  /api/v1/rooms                 PUT  /api/v1/rooms/:id
POST  /api/v1/events                POST /api/v1/events/:id/publish
POST  /api/v1/registrations         GET  /api/v1/events/:id/registrations
POST  /api/v1/credentials/:id/resend
POST  /api/v1/credentials/:id/revoke
POST  /api/v1/carriers/import
POST  /api/v1/carriers/bind
POST  /api/v1/carriers/:id/rebind
GET   /api/v1/events/:id/allowlist          (signed, for offline cache)
POST  /api/v1/scans                          (batch, idempotent — offline sync)
POST  /api/v1/alerts/:id/ack
POST  /api/v1/reports/:id/export
GET   /api/v1/gates/health
```

WebSocket channels:

```
/stream/scans     staff only, scoped to assigned checkpoints
/stream/telemetry admin only — zone/room occupancy deltas, ≤4 Hz
/stream/alerts    admin only — breach + system health
/stream/me        attendee — own pass status, own room entitlements   [added]
```

## A.5 Open questions (not blocking the frontend)

1. Multi-tenant from day one, or single-org with an org column reserved? *Assumed: org column present,
   single org in v1.*
2. Payments / ticket sales — in scope? *Assumed: out of scope; registrations are free or externally paid.*
3. Fixed NFC readers: which vendor? Ingest is reader-agnostic until chosen.
4. Does the wristband also carry a printed QR for a visual fallback? *Assumed: no; band carries UID only.*
5. Offline stale-allowlist fail-open window of 15 minutes — confirm with operations.

## A.6 Changelog

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-11-22 | P-01…P-17 drafted; data model, API, and WS deltas derived from the Blueprint. |
| 1.0 | 2026-11-22 | Ratified as official. Added A.0 governance rule; design-system source skills recorded in the frontend plan §2. |
