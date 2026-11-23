# Synan — Product

What Synan is and how it behaves, independent of how it is built. Tags `P-nn` and `D-nn` are
explained in [00-index.md](00-index.md).

---

## 1. What Synan is

Synan is a real-time event operations platform. It lets an organiser publish events, register
attendees, issue each one a credential, control physical entry to rooms with that credential, watch
occupancy live on a venue map, raise security alerts as they happen, and produce reports afterwards.

**In scope**

- Event discovery and registration
- Credential issuance on three carriers: in-app QR, emailed QR, NFC wristband
- Gate scanning, online and offline
- Live room occupancy and capacity enforcement
- Security breach alerts and outbound webhooks
- Post-event reporting and export
- Local AI assistance for anomaly detection, forecasting, and recommendations (later phase, D-08)

**Out of scope**

- Payments and ticket sales (O-02). Registrations are free, or paid for outside Synan.
- Precise indoor positioning. Synan knows which zone a credential last entered, never where a
  person is standing (D-04).

**Not planned.** These have never been part of the plan. Each is recorded here so that its absence
is a known choice and not an oversight; adding one is a new decision.

- Push or SMS notifications. Attendees see updates in the portal and by email only.
- Badge printing.
- Attendance certificates. These would also need per-person session attendance kept after the
  event, which the retention decision (D-03) does not allow today.
- Post-event feedback surveys.
- More than one language.
- More than one organisation per installation (O-01).
- Per-person movement history after the event (D-03).

**Planned but not yet built** is tracked in [07 §1](07-roadmap.md); what must exist before launch
is in [07 §5](07-roadmap.md).

### 1.1 How it flows, end to end

| # | Stage | What happens | Surface |
| --- | --- | --- | --- |
| 1 | Set up | An admin creates the organisation, a venue, its zones and rooms, and the gates, each with a direction | Admin |
| 2 | Create the event | An organiser picks rooms, sets the tier × room access matrix and the pass template, then publishes | Admin |
| 3 | Register | One of four paths by tier: self-service (Ordinary), operator approval (VIP), invite link and RSVP (Private Invitation), kiosk with no personal data (Public) | Attendee, Admin |
| 4 | Issue the credential | One credential per registration, shown as a QR in the portal and sent as a single-use QR by email | Attendee |
| 5 | Arrive | The attendee shows a QR at the perimeter or desk; staff bind a wristband to the credential. From here on the wristband is the key | Scanner, Admin |
| 6 | Scan | Every tap at a gate runs the decision in §7 and returns admit, amber, or deny. Offline, the scanner decides locally and queues the scan | Scanner |
| 7 | Operate live | Each scan updates occupancy; the map updates and alerts are raised for breaches, dead gates, and impossible travel | Admin |
| 8 | Respond | Operators acknowledge and resolve alerts, revoke or clear credentials, replace lost bands. All of it is audited | Admin |
| 9 | Close | The event closes, the grace period runs, raw scans and the ID mapping are destroyed, and reports are built from aggregates | Admin |

---

## 2. Surfaces

There are three client surfaces (P-08). They share a design language and a contract package and
nothing else. Each is a separate build.

| Surface | Route root | Who uses it | Default device |
| --- | --- | --- | --- |
| Attendee Portal | `/` | Attendees, public and signed in | Phone |
| Admin Command | `/admin` | Admin, Organiser | Desktop and wall display |
| Gate Scanner | `/scan` | Security Staff | Phone or tablet, installable PWA |

Fixed hardware readers are a fourth source of scans. They have no interface; they post to the same
scan ingest endpoint as the Gate Scanner.

**Gate devices (D-09).** Reading a wristband from a web app works only in Chrome on Android; iPhones
cannot do it. Because the wristband is the mandatory carrier, a gate is staffed with one of:

- a **venue-owned Android phone or tablet** running the Gate Scanner, or
- a **fixed reader**, or
- any device with a **USB or Bluetooth NFC reader** that types the band's identifier into the
  scanner's manual entry field.

An iPhone can run the Gate Scanner for QR at the perimeter and for manual entry, but not for tapping
wristbands. Staff are not expected to use personal phones at gates.

Screens for each surface are specified in [06-screens.md](06-screens.md).

---

## 3. Roles and staff

| Role | Kind | Can do |
| --- | --- | --- |
| Admin | Operator | Everything, including venues, access rules, staff, settings, tier overrides |
| Organiser | Operator | Events, attendees, credentials, reports. No venue layout, staff, or organisation settings |
| Security Staff | Staff | Operate the Gate Scanner at assigned checkpoints during assigned shifts |
| Speaker | Staff | No console. Holds a credential with zone permissions granted per event |
| Crew | Staff | No console. Holds a credential with zone permissions granted per event |
| Attendee | Public | Own registration, own pass, own agenda, own data |

Speakers and crew are staff, not attendee tiers (D-02). They are added by an operator, not through
public registration, and their room access is granted explicitly rather than inherited from a tier.

**Assignments and shifts (P-15).** A staff assignment binds a user to a checkpoint for a shift
window. It decides which gate the Gate Scanner may pair with and which offline allowlist it caches.
Overlapping assignments for one person are rejected. Ending a shift is an explicit handover that
summarises admitted, refused, and queued scans.

Every privileged action is written to the audit log ([03 §7](03-security-privacy.md)).

---

## 4. Attendee tiers and entitlement

Every attendee registration belongs to exactly one of four tiers (D-02).

| Tier | How they register | What they are issued | Where they may go |
| --- | --- | --- | --- |
| **VIP** | Admin approval in Admin Command, or paid externally | Rotating QR, emailed QR, cryptographic NFC wristband | Fast-track gates, VIP lounges, backstage and speaker zones, restricted keynotes |
| **Ordinary** | Self-service registration with email verification | Rotating QR, emailed QR, standard NFC wristband paired at check-in | Main auditoriums, exhibition halls, standard breakout sessions, concourses |
| **Private Invitation** | Single-use signed invite link sent to a whitelisted recipient, then RSVP | Rotating QR and emailed QR on RSVP, pre-assigned cryptographic NFC wristband | Closed-door roundtables, press briefings, sponsor-only zones. These events are hidden from public listings |
| **Public** | On-site kiosk onboarding or open-zone entry. No personal data required | Temporary session QR, or a reusable basic NFC wristband bound to an anonymous ID | Public plazas, open expo floors, community stages. No gated session |

**Entitlement (P-04).** Whether a scan is admitted is decided on the server, at scan time, by
following this chain:

```text
credential → registration (tier) → event room → access rule (tier × room × time window)
```

The credential itself carries no tier and no permissions. A tier seen in a request or in client state
is never trusted ([03 §2](03-security-privacy.md)).

Access rules are edited as a tier × room matrix. A change mid-event is shown as a diff and must be
explicitly republished, because silently changing access during a live event is dangerous.

Changing a registration's tier by hand is a privileged action: it requires a second authentication
factor and is audited.

---

## 5. Credentials

### 5.1 One credential, three carriers (P-01, D-05, D-11, D-12)

Each registration has **one credential**. It can be presented on **three carriers**:

1. **Portal QR.** Shown in the Attendee Portal on the attendee's phone. The code **rotates**: the
   server issues a fresh signed code on a short interval, so a screenshot stops working (O-07). This
   is the canonical QR.
2. **Emailed QR.** Sent at registration and re-sendable on request. It is a convenience copy that
   is **single-use**: it is accepted once and is spent after that.
3. **NFC wristband.** A physical band bound to the credential at a provisioning desk.

All three resolve to the same credential, so a scan is idempotent whichever carrier is used. An
emailed QR followed by a wristband tap at the same gate is detected as a duplicate read, not a second
admission.

**Each carrier has one job (D-11).**

| Carrier | Accepted at | Used for |
| --- | --- | --- |
| Portal QR, emailed QR | Perimeter gates and provisioning desks only | Arriving, proving who you are, collecting a wristband |
| NFC wristband | Every gate | All entry and exit inside the venue |

An interior gate does not accept a QR. It answers `wristband_required`. This keeps the rotating-code
machinery at the perimeter, where there is time and connectivity, and leaves interior gates with one
fast, simple carrier.

### 5.2 Lifecycle (P-02, D-06)

```text
Credential:  issued → active → revoked
                       ↓  ↑
                suspended_review          (impossible travel; cleared or revoked by a supervisor)
             replaced                     (superseded by a re-issue)

Carrier:     stock → assigned → bound → active → retired | lost
```

Revoking a credential invalidates every carrier bound to it, immediately. The scanner reports
`revoked`, which is distinct from `unknown_token`, so gate staff can tell a cancelled
attendee from a forged band.

### 5.3 Wristband provisioning (P-10)

1. Band identifiers arrive as a bulk import (a CSV of manufacturing serials). Bands enter `stock`.
2. At the desk, staff scan a band and select a registration. The band is `assigned`.
3. The write is confirmed and verified. The band is `bound`, then `active` on first use.
4. **Lost band:** mark it `lost`, revoke the credential, issue a replacement, bind a new band to the
   same registration. The audit log records all four steps.

The band identifier is never the credential. It is a carrier that points at one.

An attendee with an Android phone can also bind a band themselves by tapping it, or by entering a
six-character code from the desk clerk ([06 §1](06-screens.md), screen A5).

### 5.4 Pass delivery (P-11)

- Passes are sent through a transactional email provider on a verified sending domain, with bounce
  handling.
- The link in the email is signed and short-lived.
- The attendee can resend the pass (rate-limited), add it to Apple or Google Wallet, or show the
  in-app pass.
- **On-site fallback:** lookup by email plus photo ID at the provisioning desk.
- An undelivered pass is surfaced to the attendee ("check spam", "resend") and to the admin as a
  delivery-failure count per event.

---

## 6. Venue model (P-03, P-05)

```text
Organisation → Venue → Zone (a floor or area) → Room
```

- A **room** has a capacity, a warning threshold, a blocking threshold, and an optional shape for the
  map.
- An **event** is hosted at one venue and uses a subset of its rooms, optionally with a capacity
  override per room.
- A **session** is an optional schedule block that scopes a room's capacity to a time window.
- A **checkpoint** is a gate. It belongs to a venue and zone, optionally to a room, and has a
  direction: `in`, `out`, or `both`. Fixed readers and the Gate Scanner both attach to a checkpoint.
- A checkpoint is either a **perimeter** gate (or desk), which accepts QR codes and wristbands, or an
  **interior** gate, which accepts wristbands only (D-11).
- A checkpoint with no heartbeat for more than 60 seconds is shown as a gate-health fault in Admin
  Command.

---

## 7. Occupancy and capacity rules (P-06, D-06, D-10)

**Decision order.** Every scan is decided by the same steps, in this order. The first step that
fails decides the result.

1. Is the token a known Synan credential? If not: `unknown_token`.
2. Is this carrier accepted at this gate? A QR at an interior gate: `wristband_required`. A spent
   emailed QR: `pass_spent`.
3. Is the credential revoked or under review? `revoked` or `suspended`.
4. Same credential, same gate, within 60 seconds? `duplicate_read`.
5. Does the tier permit this room at this time? If not: `denied_room`.
6. Is the holder already inside this zone? `already_inside`.
7. Is the room at its blocking threshold? `capacity_block`, or admit with an alert where so configured.
8. Otherwise: `admitted`.

**Rules.**

- **Occupancy** of a room = admissions at `in` checkpoints − exits at `out` checkpoints, per event.
- **People do not reliably tap out, so occupancy is corrected three ways (D-10):**
  - *Implied exit.* A person can be in one room at a time. Being admitted to a room removes them from
    the room they were last counted in, and records an `implied_exit` there.
  - *Session-end reset.* When a session ends, its room's count returns to zero, unless the room is
    marked as continuously occupied (a lounge, an expo floor).
  - *Manual recount.* An operator can set a room's count to a headcount. The correction is audited.
- **Debounce.** The same credential at the same checkpoint within 60 seconds is ignored and logged
  as `duplicate_read`. It is not an alert.
- **Anti-passback, same perimeter.** An `in` scan for a credential already inside that zone is
  `already_inside`: amber, not red, not an alert. Re-entry after an `out` scan is allowed.
- **Impossible travel.** A credential scanned at two checkpoints sooner than the minimum transit
  time between them is flagged. The credential moves to `suspended_review`, is refused at gates, and
  the floor supervisor is notified with the last two checkpoints. In version 1 this is a
  deterministic check against a configured transit-time table; the AI model refines it later
  ([04 §3](04-edge-ai.md)).
- **Capacity policy** is per room: `warn_at_pct` (default 85) and `block_at_pct` (default 100).
  Blocking can be configured as *admit with alert* for fire-code regimes where refusing at the door
  is worse than exceeding the figure.
- Occupancy never goes negative. A negative result is clamped to 0 and logged as a reconciliation
  fault.

**Clarifications settled in the build.**

- *Debounce* is measured from the last admission. Repeated refusals are each recorded, so repeated
  attempts can escalate an alert.
- *Already inside* is judged by zone at a perimeter gate and by room at an interior gate, so moving
  between two rooms in the same zone is not blocked.
- *Exits.* An `out` scan passes steps 1–4 and is then recorded. A revoked or suspended credential is
  refused at an exit gate too (O-18).
- *A perimeter gate with no room* admits any valid credential for the event.
- *A credential from another event* reads as `unknown_token`. *A lost or retired wristband* reads as
  `revoked`.
- *A session-end reset or a recount to zero* un-counts everyone in the room. A recount to a non-zero
  headcount does not change who is counted as present.
- *Capacity and operators.* Operators always see exact counts, because capacity enforcement needs
  them.

**Scan results.** The vocabulary is fixed and shared by every surface:

| Result | Meaning | Gate colour |
| --- | --- | --- |
| `admitted` | Entry permitted | Green |
| `already_inside` | Repeat entry at the same perimeter | Amber |
| `duplicate_read` | Same credential, same gate, within 60 s | None (ignored) |
| `denied_room` | Tier not permitted in this room | Red |
| `capacity_block` | Room at blocking threshold | Red |
| `revoked` | Credential revoked | Red |
| `suspended` | Credential under review | Red |
| `unknown_token` | Not a Synan credential, or forged | Red |
| `wristband_required` | QR presented at an interior gate | Red |
| `pass_spent` | Emailed QR already used once | Red |
| `implied_exit` | System-generated: holder was admitted elsewhere | None (not shown at a gate) |
| `offline_queued` | Decided locally, awaiting sync. A display state on the scanner only; the server never stores or returns it | As decided, tagged `LOCAL` |

---

## 8. Offline and degraded operation (P-09)

Venues lose connectivity. A gate that cannot decide stops the queue, so the scanner must keep working.

- The Gate Scanner caches a **signed eligibility allowlist** for its assigned event and shift:
  credential hash, tier, permitted rooms, and revocation epoch.
- Scans are evaluated locally, queued with a client-generated idempotency key, and synced when the
  link returns.
- The server applies the queue in `occurred_at` order with idempotent upserts, so a scan is counted
  exactly once.
- **Unknown tokens fail closed.** A token not on the allowlist is refused.
- **Allowlisted credentials fail open with an alert** when the allowlist is more than 15 minutes
  stale (O-05). The queue must not stop.
- Admin Command shows each gate's link state and queue depth. "Offline 4m, 182 queued" is a designed
  state, not an error.

**What offline gates cannot know (D-13).** Gates that are offline cannot see each other. Until they
sync, three things can happen that an online system would have stopped:

| Conflict | Example |
| --- | --- |
| A single-use emailed QR accepted twice | Two offline perimeter gates each accept the same email |
| A pass-back | A band already inside is admitted again at a different offline gate |
| Capacity exceeded | Two offline gates each admit the "last" person |

These are accepted at the gate, because the queue must not stop, and are **caught when the gates
sync**. Each one raises an alert naming the scans involved, and the occupancy count is corrected.
They are never silently discarded.

The rule behind it: an offline scan is a record of what happened at the gate. Wherever the gate
admitted someone the server would have refused, an alert is raised — for a reused pass or a
pass-back the credential is also suspended for review; for anything else the alert says the
allowlist was stale. A scan that arrives late is judged against the present state and never moves a
person backwards in time.

**Device clocks (D-14).** Offline scans are ordered by time, and a phone's clock can be wrong. At
every sync the scanner records the difference between its clock and the server's, and sends that
offset with each queued scan. The server orders scans by the corrected time. A device whose offset
exceeds two minutes is flagged in gate health.

The security properties of the cached allowlist are in [03 §4](03-security-privacy.md).

---

## 9. Event lifecycle (P-13)

```text
draft → published → live → closed → archived
```

- Transitions are guarded. Publishing requires at least one room, a pass template, and capacity.
- Every event carries an IANA timezone. All times are stored in UTC and shown in event-local time
  with the zone labelled.
- Closing an event starts the retention clock ([03 §6](03-security-privacy.md)).

---

## 10. Reporting (P-14)

| Report | Shows |
| --- | --- |
| Attendance | Registered, checked in, no-shows, by tier |
| Dwell and Flow | Time spent per zone, movement between zones, in aggregate |
| Peak Occupancy | Highest occupancy per room and when |
| Breach and Compliance | Alerts by kind and severity, time to acknowledge, time to resolve |
| Gate Throughput | Scans per gate over time, failure breakdown |

Reports are viewed on screen as paginated data. Export is an asynchronous job, delivered by a signed
short-lived link and optionally emailed on a schedule. It produces:

- **An Excel workbook** (`.xlsx`) for the whole event (D-21): a summary sheet, then one sheet per
  report, with real number and date cells, frozen header rows, column widths, and totals, plus an
  attendee sheet (name, email, tier, registration state, checked in, first check-in time) for
  operators permitted to see identity. This is the primary download.
- **A CSV** per report, for other tools.
- **A PDF summary** of the headline figures.

**Post-event summary (D-21).** Every closed event has a summary: one page that says how the event
went. It shows the headline figures (registered, checked in, no-shows, peak on site and when, rooms
that reached capacity, alerts raised and how fast they were handled), attendance by tier, the
occupancy curve over the event, the busiest rooms and gates, and the downloads above. It is the
landing page of a closed event and stays available indefinitely.

Reports and the summary are built from aggregates, so they remain available after raw scan data is
purged.

**What can and cannot be retrieved later (D-03).**

| Kept indefinitely | Destroyed after the grace period |
| --- | --- |
| Who registered, their tier, and whether and when they first checked in | Each person's individual scans: which rooms they entered and when |
| Totals and peaks per room, per gate, and per time slot | The access log for that event |
| Flow between zones and time spent, as aggregates | |
| Alerts and the audit log, for 12 months | |

"How many people were in a room at a given time" is answerable forever. "Where did this guest go"
is answerable only until the purge. Keeping per-person session attendance would be a change to D-03.
