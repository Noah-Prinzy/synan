# Synan — Product

What Synan is and how it behaves, independent of how it is built. Tags `P-nn` and `D-nn` are
explained in [00-index.md](00-index.md); open questions `O-nn` are listed in
[00 §5](00-index.md).

---

## 1. What Synan is

Synan is a real-time event operations platform. It lets an organiser publish events, register
attendees, issue each one a credential, control physical entry to rooms with that credential, watch
occupancy live on a venue map, raise security alerts as they happen, and produce reports afterwards.

**For any kind of event (D-25).** A conference, a wedding, a festival, a concert, a trade show, a
class, a school day, a church service, a community gathering. An organiser sets each event up to
suit its kind: it starts from a preset and adjusts a profile of switches (§12). People can come
alone or together: as a couple, a family, a household on an invitation, or a company delegation
(§11).

**For many organisers (D-26).** Synan is one service that many organisers sign up to. Each
organiser's events, venues, staff and attendee data are kept apart from every other organiser's
(§15). A person who goes to events run by different organisers signs in once and finds all their
passes in one place.

**Who it is for.**

- **Organisers and their staff.** They set events up and run them in Admin Command, and staff the
  doors with the Gate Scanner (§2, §3).
- **Attendees and the people they bring.** They register, receive a pass, and get in, using the
  Attendee Portal, a pass sent to any phone, or a printed pass (§5.4).

**Reading §11 to §18.** These sections extend the product to any kind of event and to many
organisers. Many of their details still wait for the owner's answer. Where a rule rests on an open
question, the question's number is given beside it, and the rule written is the recommended answer
([00 §5](00-index.md)). If the owner decides otherwise, the rule here is changed.

**In scope**

- Event discovery and registration, for one person or for a party
- Event profiles and presets for any kind of event
- Ticket types, capacity limits, waiting lists, and booked places
- Credential issuance on several carriers: in-app QR, a sent or printed copy with a short pass code,
  NFC wristband
- Sign-in and pass delivery by email, SMS or WhatsApp (O-48)
- Gate scanning, online and offline
- Live room occupancy and capacity enforcement
- Extras collected by a tap: meals, drinks, bags, parking
- Emergency mode
- Security breach alerts and outbound webhooks
- Post-event reporting and export
- Many organisers on one service, each kept apart
- Local AI assistance for anomaly detection, forecasting, and recommendations (later phase, D-08)

**Out of scope**

- Taking or holding attendees' money (O-02). Registrations are free, or paid for outside Synan;
  paid orders and tickets bought elsewhere can be brought in (§13.6).
- Precise indoor positioning. Synan knows which zone a credential last entered, never where a
  person is standing (D-04).

**Not planned.** These have never been part of the plan. Each is recorded here so that its absence
is a known choice and not an oversight; adding one is a new decision. Where the planning studies
recommend changing an item, the item stays on this list until the owner decides, and the open
question is named.

- Push or SMS notifications. *Proposed change (O-48):* SMS and WhatsApp become channels for
  sign-in, passes and emergency messages (§5.4, §17, §18.1). Push notifications stay not planned.
- Badge printing. *Proposed change (O-51):* passes and badges printed on ordinary paper (§5.4).
  Badge printers stay not planned.
- Attendance certificates. These would also need per-person session attendance kept after the
  event, which the retention decision (D-03) does not allow. *Proposed change (O-53):* a certificate
  that a person attended the event on a given date, which D-03 already allows (§17). Certificates
  that list sessions stay not planned (O-23).
- Post-event feedback surveys. *Proposed change (O-53):* the thank-you message may carry a link to
  the organiser's own survey (§17). A survey builder stays not planned.
- More than one language. *Proposed change (O-52):* §16.
- Per-person movement history after the event (D-03).

**Planned but not yet built** is tracked in [07 §1](07-roadmap.md); the order of work is in
[07 §2](07-roadmap.md); what must exist before launch is in [07 §5](07-roadmap.md).

### 1.1 How it flows, end to end

| # | Stage | What happens | Surface |
| --- | --- | --- | --- |
| 1 | Set up | An organiser signs up (§15.5). An admin creates a venue, its zones and rooms, and the gates, each with a direction. For a single-space event, the preset creates a simple venue instead (§12.2) | Admin |
| 2 | Create the event | An organiser picks the event type, which sets the profile (§12), adds ticket types (§13.1), picks rooms, sets the access matrix and the pass template, then publishes | Admin |
| 3 | Register | By the paths the event's profile opens: self-service, approval, invitation and RSVP, allocation, list upload, tickets bought elsewhere, or a kiosk with no personal data. A person registers alone or books for a party (§11). Every ticket type sits under one of the four tiers (§4) | Attendee, Admin |
| 4 | Issue the credential | One credential per person, shown as a rotating QR in the portal and sent as a single-use copy with a short pass code, by email, SMS or WhatsApp, or printed (§5.4) | Attendee |
| 5 | Arrive | The attendee shows a QR or a pass code at the perimeter or desk. Where the event uses wristbands, staff bind one to the credential, and from there the wristband is the key (§12.3) | Scanner, Admin |
| 6 | Scan | Every tap or read at a gate runs the decision in §7 and returns admit, amber, or deny. Offline, the scanner decides locally and queues the scan | Scanner |
| 7 | Operate live | Each scan updates occupancy; the map updates and alerts are raised for breaches, dead gates, and impossible travel | Admin |
| 8 | Respond | Operators acknowledge and resolve alerts, revoke or clear credentials, replace lost bands, and if needed start emergency mode (§18.1). All of it is audited | Admin |
| 9 | Close | The event closes, the grace period runs, raw scans and the ID mapping are destroyed, and reports are built from aggregates | Admin |

---

## 2. Surfaces

There are three client surfaces (P-08). They share a design language and a contract package and
nothing else. Each is a separate build.

| Surface | Route root | Who uses it | Default device |
| --- | --- | --- | --- |
| Attendee Portal | `/` | Attendees, public and signed in | Phone |
| Admin Command | `/admin` | Admin, Organiser, Supervisor, Desk clerk | Desktop and wall display |
| Gate Scanner | `/scan` | Security Staff | Phone or tablet, installable PWA |

Fixed hardware readers are a fourth source of scans. They have no interface; they post to the same
scan ingest endpoint as the Gate Scanner. The light pass page (§5.4) is a small page that shows a
sent pass on any phone; it is part of the Attendee Portal.

**Gate devices (D-09).** Reading a wristband from a web app works only in Chrome on Android; iPhones
cannot do it. At an event that uses wristbands (the default, §12.3), a gate is staffed with one of:

- a **venue-owned Android phone or tablet** running the Gate Scanner, or
- a **fixed reader**, or
- any device with a **USB or Bluetooth NFC reader** that types the band's identifier into the
  scanner's manual entry field.

An iPhone can run the Gate Scanner for QR at the perimeter and for manual entry, but not for tapping
wristbands. Staff are not expected to use personal phones at gates. An event that uses no
wristbands needs only a camera at its gates, so any phone or tablet can staff them (§12.3, O-35).

Screens for each surface are specified in [06-screens.md](06-screens.md).

---

## 3. Roles and staff

| Role | Kind | Can do |
| --- | --- | --- |
| Admin | Operator | Everything, including venues, access rules, staff, settings, tier overrides |
| Organiser | Operator | Events, attendees, credentials, reports. No venue layout, staff, or organisation settings |
| Supervisor | Operator | Run the live event: Command Center, alerts, gate health, access log, room recounts, attendee lookup, and clearing or revoking a pass under review. Cannot edit events, venues, access rules, staff, or settings, and cannot export reports |
| Desk clerk | Staff | Work the registration desk for the events they are assigned to: find an attendee, bind or replace a wristband, mark a band lost, resend a pass. Sees nothing else in the console |
| Security Staff | Staff | Operate the Gate Scanner at assigned checkpoints during assigned shifts. No console access |
| Speaker | Staff | No console. Holds a credential with zone permissions granted per event |
| Crew | Staff | No console. Holds a credential with zone permissions granted per event |
| Attendee | Public | Own registration, own pass, own agenda, own data, and the passes they hold for others (§11.3) |

**Each role sees only its own screens (D-23).** The Admin Command builds its navigation, landing
page, and actions from the signed-in role: an Admin lands on the Command Center with everything
available, a Supervisor on the Command Center with the live screens only, a Desk clerk on the desk
screen and nothing else. Security Staff cannot open the console at all; they use the Gate Scanner.
Hiding a screen is a convenience, not the control: the server checks the role on every request
([03 §3](03-security-privacy.md)).

**Roles belong to an organiser (D-26).** A role is held for one organiser. One sign-in can be a
Supervisor for one organiser and Security Staff for another, and works for one organiser at a time
(§15.1). No organiser can create roles of its own (O-37).

Speakers and crew are staff, not attendee tiers (D-02). They are added by an operator, not through
public registration, and their room access is granted explicitly rather than inherited from a tier.

**Assignments and shifts (P-15).** A staff assignment binds a user to a checkpoint for a shift
window. It decides which gate the Gate Scanner may pair with and which offline allowlist it caches.
Overlapping assignments for one person are rejected. Ending a shift is an explicit handover that
summarises admitted, refused, and queued scans.

Every privileged action is written to the audit log ([03 §7](03-security-privacy.md)).

---

## 4. Attendee tiers and entitlement

Every attendee registration belongs to exactly one of four tiers (D-02). A registration reaches its
tier through its **ticket type**: each event offers ticket types named by the organiser, and each
ticket type sits under exactly one tier (§13.1). The tier is the trust class: it decides how a pass
is obtained, which wristband chip it uses, and whether the event is listed. The ticket type is what
the person holds.

| Tier | How they register | What they are issued | Where they may go (for example) |
| --- | --- | --- | --- |
| **VIP** | Approval in the organiser's approval queue (§13.3), or paid for outside Synan (§13.6) | Rotating QR, sent copy, cryptographic NFC wristband | Fast-track gates, VIP lounges, backstage and speaker zones, restricted keynotes |
| **Ordinary** | Self-service registration with a verified email address or mobile number (§5.4) | Rotating QR, sent copy, standard NFC wristband paired at check-in | Main auditoriums, exhibition halls, standard breakout sessions, concourses |
| **Private Invitation** | Single-use signed invite link sent to a listed recipient by email or phone, then RSVP | Rotating QR and sent copy on RSVP, pre-assigned cryptographic NFC wristband | Closed-door roundtables, press briefings, sponsor-only zones. These events are hidden from public listings |
| **Public** | On-site kiosk onboarding or open-zone entry. No personal data required | Temporary session QR, or a reusable basic NFC wristband bound to an anonymous ID | Public plazas, open expo floors, community stages. No gated session |

Wristbands are issued where the event uses them (§12.3).

**Entitlement (P-04).** Whether a scan is admitted is decided on the server, at scan time, by
following this chain:

```text
credential → registration (ticket type, tier, age band, checks) → event room
           → access rule (tier or ticket type × room × time window)
```

The credential itself carries no tier, ticket type or permissions. A tier seen in a request or in
client state is never trusted ([03 §2](03-security-privacy.md)). The full check, including the days
a ticket is valid, re-entry, age, and booked places, is step 5 of the decision order in §7.

Access rules are edited as a matrix of rooms against ticket types, grouped under their tiers. A
rule can cover a whole tier or one ticket type, and can refuse an age band (§11.6). A change
mid-event is shown as a diff and must be explicitly republished, because silently changing access
during a live event is dangerous.

Changing a registration's tier or ticket type by hand is a privileged action: it requires a second
authentication factor and is audited.

---

## 5. Credentials

### 5.1 One credential, several carriers (P-01, D-05, D-11, D-12)

Each registration has **one credential**. It can be presented on these **carriers**:

1. **Portal QR.** Shown in the Attendee Portal on the holder's phone. The code **rotates**: the
   server issues a fresh signed code on a short interval, so a screenshot stops working (O-07). This
   is the canonical QR.
2. **Sent copy.** Sent at registration by email, SMS or WhatsApp, or printed, and re-sendable on
   request (§5.4). It carries a static QR and a **short pass code** that staff can type. It is a
   convenience copy that is **single-use**: it is accepted once and is spent after that. It may admit
   again only after its holder has been scanned out at the perimeter (O-36).
3. **NFC wristband.** A physical band bound to the credential at a provisioning desk, where the
   event uses wristbands.
4. **Imported ticket code.** The barcode of a ticket bought elsewhere, imported by the organiser
   (§13.6). Like a sent copy, it is accepted once.

All of them resolve to the same credential, so a scan is idempotent whichever carrier is used. A
sent copy followed by a wristband tap at the same gate is detected as a duplicate read, not a second
admission.

**Each carrier has one job (D-11).** This is the default carrier policy. An event can choose
another (§12.3).

| Carrier | Accepted at | Used for |
| --- | --- | --- |
| Portal QR, sent copy, short pass code, imported ticket code | Perimeter gates and provisioning desks only | Arriving, proving who you are, collecting a wristband |
| NFC wristband | Every gate | All entry and exit inside the venue |

Under the default policy, an interior gate does not accept a QR. It answers `wristband_required`.
This keeps the rotating-code machinery at the perimeter, where there is time and connectivity, and
leaves interior gates with one fast, simple carrier.

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

A credential is re-issued (`replaced`) when the desk replaces a lost pass (§18.3) and when a pass is
handed over to its person (§11.3), so codes already fetched or sent stop working.

### 5.3 Wristband provisioning (P-10)

1. Band identifiers arrive as a bulk import (a CSV of manufacturing serials). Bands enter `stock`.
2. At the desk, staff scan a band and select a registration. The band is `assigned`.
3. The write is confirmed and verified. The band is `bound`, then `active` on first use.
4. **Lost band:** mark it `lost`, revoke the credential, issue a replacement, bind a new band to the
   same registration. The audit log records all four steps.

The band identifier is never the credential. It is a carrier that points at one. A band follows its
credential: cancelling or transferring a pass retires its band (§11.4).

An attendee with an Android phone can also bind a band themselves by tapping it, or by entering a
six-character code from the desk clerk ([06 §1](06-screens.md), screen A5).

### 5.4 Contacts, sign-in and pass delivery (P-11)

- **Contacts.** Every person who signs in has a contact: an email address, a mobile number, or
  both. Either is enough (O-48). Mobile numbers are stored in international format and shown the way
  the event's country writes them. A guest with no contact of their own is reached through the
  person who booked them (§11.2).
- **Sign-in.** An attendee signs in with a contact they registered with: a signed, short-lived link
  by email, or a six-digit code by SMS or WhatsApp. A code lasts 10 minutes and allows five
  attempts; it can be pasted or filled in by the phone. Codes can be requested only a limited number
  of times per number and per device, and only for numbers in the countries the event accepts. When
  someone signs in on a new device, Synan tells the other contact on file, if there is one. No
  attendee password exists.
- **Channels.** The organiser chooses which of email, SMS and WhatsApp an event uses. The attendee
  chooses their preferred channel among those. A message only ever goes to a contact the attendee
  gave. Email is sent through a transactional provider on a verified sending domain, with bounce
  handling (O-13); SMS and WhatsApp through messaging providers under a registered sender name
  (O-49).
- **What a pass message contains.** The guest's first name, the event, the date and time in the
  event's time zone, a link to the pass, and the short pass code. Email and WhatsApp also carry the
  QR code as an image. The rules for every message are in §17.
- **The light pass page.** The link opens a small page that works in any phone browser, old and
  basic ones included, with nothing to install. It shows the QR code, the short pass code, the
  guest's name and the event. The link is signed and cannot be guessed, and it works until a day
  after the event ends.
- **Sent copies are single-use (D-05).** Every copy that is sent or printed admits once at an
  entrance or desk, as §5.1 says. The rotating QR in the portal is the full pass.
- **The short pass code (O-50).** Ten letters and numbers in groups, without characters that look
  alike, for example `K7QM-4XPA-RT`. Staff type it into the scanner when a guest has no smartphone
  or the screen cannot be read. It is accepted at entrances and desks only. Scanners hold it only in
  a scrambled form that cannot be turned back into the code, so a lost scanner gives nothing away
  (D-12).
- **Printing (O-51).** The organiser can print passes, one per page or several per sheet, and a door
  list of guests with their codes. The door list says it must be destroyed after the event.
- **One contact, several passes.** One person can hold the passes of the people they booked for
  (§11.3). Each pass still belongs to one named person and admits one person.
- **No phone.** A guest with no phone is reached through the person who booked them, by a printed
  pass, or at the desk.
- **Resending.** An attendee can resend their pass on any channel they gave, up to three times an
  hour. The organiser can resend from the attendee list.
- **Delivery failures.** An undelivered pass is shown to the attendee with a way to resend or switch
  channel, and to the organiser as a count of failures per event and per channel.
- **When data is off.** The portal keeps a stock of rotating codes on the phone, so the pass keeps
  working with mobile data switched off for as long as that stock lasts (O-07).
- **On-site fallback.** At the desk, a guest is found by name, phone number or email and confirmed
  with photo ID.

---

## 6. Venue model (P-03, P-05)

```text
Organisation → Venue → Zone (a floor or area) → Room
```

- A **room** has a capacity, a warning threshold, a blocking threshold, and an optional shape for the
  map.
- An **event** is hosted at one venue and uses a subset of its rooms, optionally with a capacity
  override per room. Presets for a single space create a **simple venue** of one zone, one main area
  and one entrance (§12.2).
- A **session** is an optional schedule block that scopes a room's capacity to a time window. It can
  have booked places (§13.4).
- A **checkpoint** is a gate. It belongs to a venue and zone, optionally to a room, and has a
  direction: `in`, `out`, or `both`. Fixed readers and the Gate Scanner both attach to a checkpoint.
- A checkpoint is either a **perimeter** gate (or desk), which accepts QR codes and wristbands, or an
  **interior** gate, which accepts wristbands only (D-11). The event's carrier policy can change what
  each accepts (§12.3).
- For each event, a checkpoint has a **mode**: entry (the default), collection point for extras
  (§14), or muster point (§18.1).
- A checkpoint with no heartbeat for more than 60 seconds is shown as a gate-health fault in Admin
  Command.

---

## 7. Occupancy and capacity rules (P-06, D-06, D-10)

**Decision order.** Every scan is decided by the same steps, in this order. The first step that
fails decides the result. Steps that name a section apply only where the event uses that feature.

1. Is the token a known Synan credential? This includes sent copies, short pass codes and imported
   ticket codes. If not: `unknown_token`.
2. Is this carrier accepted at this gate, under the event's carrier policy (§12.3)? Under the
   default policy, a QR at an interior gate: `wristband_required`. A spent sent copy or imported
   code: `pass_spent`.
3. Is the credential revoked or under review, or the registration not confirmed? `revoked` or
   `suspended`.
4. Same credential, same gate, within 60 seconds? `duplicate_read`.
   - At a **collection point** (§14), the pass's balance decides instead: `redeemed`,
     `nothing_left`, or `not_included`. Nothing further is checked and occupancy is not counted.
   - At an **exit**, the scan is recorded. A child who may leave only with a guardian answers
     `check_required` until a linked adult's pass is presented (§11.6).
5. Is the pass entitled to this room now? If not: `denied_room`, with the reason:
   1. the ticket type is not valid at this time or on this day (§13.1);
   2. the event allows no re-entry and the person has left (§12.1);
   3. no access rule for the tier, ticket type or age band permits this room (§4, §11.6);
   4. the session needs a booked place and the pass has none (§13.4).
6. Is the holder already inside this zone? `already_inside`.
7. Is the room at its blocking threshold, or, at a perimeter entrance, is the event at its on-site
   limit (§13.2)? `capacity_block`, or admit with an alert where so configured.
8. Does this gate need an identity or age check the person has not yet passed (§18.4)?
   `check_required`. Staff check and confirm, and the person is admitted; or staff refuse, and the
   result is `denied_room` with the reason that the check failed.
9. Otherwise: `admitted`.

**Emergency mode comes first (§18.1).** While an event is in emergency mode, every exit is let
through, and every entry is refused except at muster points.

**Reasons.** Every refusal carries a reason, and each reason has its own words on the scanner, so a
main entrance never says "Restricted room" when the problem is the day on the ticket.

**Rules.**

- **Occupancy** of a room = admissions at `in` checkpoints − exits at `out` checkpoints, per event.
- **People do not reliably tap out, so occupancy is corrected three ways (D-10):**
  - *Implied exit.* A person can be in one room at a time. Being admitted to a room removes them from
    the room they were last counted in, and records an `implied_exit` there.
  - *Session-end reset.* When a session ends, its room's count returns to zero, unless the room is
    marked as continuously occupied (a lounge, an expo floor).
  - *Manual recount.* An operator can set a room's count to a headcount. The correction is audited.
- **Daily reset.** At a multi-day event that resets overnight, each room's count returns to zero at
  the local time the event's new day starts, except rooms marked as continuously occupied (§12.1).
- **Debounce.** The same credential at the same checkpoint within 60 seconds is ignored and logged
  as `duplicate_read`. It is not an alert.
- **Anti-passback, same perimeter.** An `in` scan for a credential already inside that zone is
  `already_inside`: amber, not red, not an alert. Re-entry after an `out` scan is allowed, unless
  the event's re-entry switch says otherwise (§12.1).
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
- **Presence consent.** Declining zone-presence consent ([03 §5](03-security-privacy.md)) never
  stops a person entering, and is never a condition of getting a wristband. The recommended rule
  (O-43): the person is still counted, because counting is needed to run the event safely, but is
  left out of dwell and flow analysis.

**Clarifications settled in the build.**

- *Debounce* is measured from the last admission. Repeated refusals are each recorded, so repeated
  attempts can escalate an alert.
- *Already inside* is judged by zone at a perimeter gate and by room at an interior gate, so moving
  between two rooms in the same zone is not blocked.
- *Exits.* An `out` scan passes steps 1–4 and is then recorded. A revoked or suspended credential is
  refused at an exit gate too (O-18).
- *A perimeter gate with no room* admits any valid credential for the event, subject to steps 5.1,
  5.2, 7 and 8.
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
| `check_required` | A check is needed first: identity, age, or a child's guardian (§18.4) | Amber |
| `duplicate_read` | Same credential, same gate, within 60 s | None (ignored) |
| `denied_room` | Not entitled to this room now; the reason says why | Red |
| `capacity_block` | Room at blocking threshold, or event at its on-site limit | Red |
| `revoked` | Credential revoked | Red |
| `suspended` | Credential under review | Red |
| `unknown_token` | Not a Synan credential, or forged | Red |
| `wristband_required` | QR presented at a gate that takes wristbands only | Red |
| `pass_spent` | Sent copy or imported ticket code already used | Red |
| `redeemed` | Collection point: extra collected; shows what is left | Green |
| `nothing_left` | Collection point: this extra is used up; shows when it was last used | Red |
| `not_included` | Collection point: this pass does not include this extra | Red |
| `implied_exit` | System-generated: holder was admitted elsewhere | None (not shown at a gate) |
| `offline_queued` | Decided locally, awaiting sync. A display state on the scanner only; the server never stores or returns it | As decided, tagged `LOCAL` |

---

## 8. Offline and degraded operation (P-09)

Venues lose connectivity. A gate that cannot decide stops the queue, so the scanner must keep working.

- The Gate Scanner caches a **signed eligibility allowlist** for its assigned event and shift:
  credential hash, tier, permitted rooms, and revocation epoch.
- Where the event uses them, the allowlist also carries what a gate needs to decide §7 offline: the
  days a ticket is valid, whether a person has left for good, age bands and outstanding checks,
  booked sessions, the guardians who may collect a child, and balances at collection points. It
  never holds names or contacts. Short pass codes are held only in a scrambled, one-way form
  (§5.4).
- Scans are evaluated locally, queued with a client-generated idempotency key, and synced when the
  link returns.
- The server applies the queue in `occurred_at` order with idempotent upserts, so a scan is counted
  exactly once.
- **Unknown tokens fail closed.** A token not on the allowlist is refused.
- **Allowlisted credentials fail open with an alert** when the allowlist is more than 15 minutes
  stale (O-05). The queue must not stop.
- Admin Command shows each gate's link state and queue depth. "Offline 4m, 182 queued" is a designed
  state, not an error. A gate is **offline** when it has never been heard from or has been silent
  for 60 seconds, **degraded** when its link is up but a device still holds unsynced scans or its
  clock is more than 2 minutes out, and **online** otherwise. Staff phones count as gate devices.

**What offline gates cannot know (D-13).** Gates that are offline cannot see each other. Until they
sync, four things can happen that an online system would have stopped:

| Conflict | Example |
| --- | --- |
| A single-use sent copy accepted twice | Two offline perimeter gates each accept the same emailed pass |
| A pass-back | A band already inside is admitted again at a different offline gate |
| Capacity exceeded | Two offline gates each admit the "last" person |
| An extra collected twice | Two offline collection points each hand out the same last lunch (§14) |

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
draft → published → rehearsal → live → closed → archived
            │           │         │
            └───────────┴─────────┴──→ cancelled
```

- Transitions are guarded. Publishing requires at least one room, a pass template, and capacity.
  A preset for a single space creates the room (§12.2).
- **Rehearsal (O-38)** is optional. Staff test gates and scanners with real passes before doors
  open. Test scans are marked as tests and wiped when the event goes live.
- **Cancelled (O-38)** is final. A published, rehearsing or live event can be cancelled (§18.2).
  An event that is **postponed** keeps its state; its dates move.
- Every event carries an IANA timezone. All times are stored in UTC and shown in event-local time
  with the zone labelled.
- Closing or cancelling an event starts the retention clock ([03 §6](03-security-privacy.md)).

---

## 10. Reporting (P-14)

| Report | Shows |
| --- | --- |
| Attendance | Registered, checked in, no-shows, by tier and by ticket type; by party, household or table where used |
| Dwell and Flow | Time spent per zone, movement between zones, in aggregate |
| Peak Occupancy | Highest occupancy per room and when |
| Breach and Compliance | Alerts by kind and severity, time to acknowledge, time to resolve; emergencies started and ended |
| Gate Throughput | Scans per gate over time, failure breakdown |

Where an event uses them, reports also show extras collected (by kind and choice, over time) and
places booked, used and released per session.

Reports are viewed on screen as paginated data. Export is an asynchronous job, delivered by a signed
short-lived link and optionally emailed on a schedule. It produces:

- **An Excel workbook** (`.xlsx`) for the whole event (D-21): a summary sheet, then one sheet per
  report, with real number and date cells, frozen header rows, column widths, and totals, plus an
  attendee sheet (name, email, tier, ticket type, party, registration state, checked in, first
  check-in time) for operators permitted to see identity. This is the primary download.
- **A CSV** per report, for other tools.
- **A PDF summary** of the headline figures.

**Post-event summary (D-21).** Every closed event has a summary: one page that says how the event
went. It shows the headline figures (registered, checked in, no-shows, peak on site and when, rooms
that reached capacity, alerts raised and how fast they were handled), attendance by tier and ticket
type, the occupancy curve over the event, the busiest rooms and gates, and the downloads above. It is
the landing page of a closed event and stays available indefinitely.

**Scheduled reports.** An operator can schedule an export for an event: daily, weekly, monthly, or
once when the event closes. Each recipient is emailed a signed link; the email names no event and
contains no data. The emailed link lasts 24 hours (O-25); a link requested in the console lasts 10
minutes. A schedule that includes attendee identity may only go to admin or organiser accounts, and
that is checked again at every run. A schedule that fails three times in a row stops until resumed.

Reports and the summary are built from aggregates, so they remain available after raw scan data is
purged.

**What can and cannot be retrieved later (D-03).**

| Kept indefinitely | Destroyed after the grace period |
| --- | --- |
| Who registered, their tier and ticket type, their party and table, the agreements they accepted, and whether and when they first checked in | Each person's individual scans: which rooms they entered and when |
| Totals and peaks per room, per gate, and per time slot | The access log for that event |
| Flow between zones and time spent, as aggregates | Each person's session bookings and collections of extras |
| How many of each extra were collected, and how many session places were booked, used and released | Guardian links, identity and age checks, and access needs |
| Alerts, emergency records without names, and the audit log, for 12 months | |

"How many people were in a room at a given time" is answerable forever. "Where did this guest go"
is answerable only until the purge. Keeping per-person session attendance would be a change to D-03.

---

## 11. Parties and dependants

### 11.1 One person, one pass

Every person who attends has their own registration and their own credential, however they were
booked. Gates, anti-passback, occupancy and impossible travel always work per person. One scan never
admits more than one person at a gate (O-39); group work happens at the desk.

### 11.2 Parties

A **party** is a group of registrations for one event, looked after by one account, its
**manager**. It may be a couple, a family, friends, a household on an invitation, a company
delegation, a sponsor's allocation, or a table at a dinner. The manager need not attend: a
delegation manager can book for others and stay at home. A party never appears at a gate: scanners,
scan records and live counts know nothing of it.

**Booking for others.** When the event allows parties, the person registering adds guests up to the
party limit. For each guest they give:

- a name, unless the event allows unnamed guests (O-40). An unnamed guest is shown as "Guest of
  ⟨manager⟩", and the manager or the desk can name them until the event starts;
- a ticket type (§13.1);
- an age band, where the event uses them (§11.6);
- answers to the event's per-person questions. Questions marked "per booking" are asked once.

The booking is accepted or refused as a whole. The largest party allowed is the smallest of: the
event's party limit, the seats on the invitation or allocation, the ticket type's quota, and the
event's capacity.

**Guests without their own contact.** A guest may have no email address or phone of their own: a
child, or a spouse who shares an address. Such a guest exists only for that registration, with that
organiser, and cannot sign in. Their pass is held by the manager.

**Arriving.** At the desk, scanning any member's pass opens the whole party. The clerk binds a
wristband to each member in turn, checking identity where the event requires it. At a perimeter
gate each person is scanned; the manager's phone steps through the passes it holds. A member who
arrives late shows their own pass, or is found through the party at the desk. Once wristbands are
on, nobody needs a phone.

### 11.3 Holding and handing over a pass

**One holder per pass.** Every pass has exactly one **holder**: the account that shows its rotating
QR. A manager can hold several passes for the same event. The portal shows them as a wallet, the
manager's own pass first. Each pass has its own rotating code.

**Handing a pass over.** The holder can give a pass to its person with a link sent to that person's
email address or mobile number. The link is tied to that contact; an open link that anyone can claim
is used only for allocations (O-41). Opening the link and signing in makes the person the holder.

- If they already have a Synan account, the pass joins it.
- If they already hold a pass for the same event, they are asked to release one first.
- On handover the pass is re-issued, so codes already fetched on the manager's phone and any sent
  copy stop working. A wristband already bound is not affected.
- After handover the manager still sees the person's name and the state of the pass, but not its
  codes, the person's arrival, or their answers.

**What a manager sees.** A manager sees a member's arrival only while holding that member's pass. A
pass someone has claimed belongs to them alone.

**Address book (O-42).** A manager may keep a private list of the people they often book for.
Organisers never see it; a person on it becomes known to an organiser only when booked for one of
that organiser's events.

### 11.4 Changes

| Change | Rule |
| --- | --- |
| Cancel one member | The holder, the manager for passes they hold, or an operator cancels. The pass is revoked and a bound wristband is retired (not marked lost: nothing is suspicious). The place returns to the party or to the waiting list |
| Add a member | Within the same limits, registration window and approval as the booking |
| Transfer to another person | The pass is cancelled and a new registration issued in the same party and ticket type. Answers and agreements are not carried over, because they belong to a person, and check-in history stays true. A wristband never moves with a transfer. Transfers are allowed until the event starts unless the event sets otherwise; after check-in, only an operator may transfer (O-41) |
| Change the manager | The current manager or an operator; audited. Passes stay with their holder until handed over. A manager cancelling their own pass first hands over or cancels the passes they hold |
| Hand over a pass with a wristband | Only the holder changes; the band stays on the wrist |

### 11.5 Households, lists and allocations

**Households and plus-ones on invitations.** An invitation can carry seats: "you and a guest", or
"the Okello family, four seats", with named members where known. The reply covers each person:
attending or not, and their own questions, such as a meal choice. Accepting creates a party with one
registration for each person coming. Those not coming get nothing but are counted ("3 of 4
attending"). An invitation link stops working once the reply is complete
([03 §2](03-security-privacy.md)), so later changes are made from the manager's account.

**Lists.** An organiser can upload a list of people from a spreadsheet, choosing which column is
which before anything is created, as with the wristband import. A list sets each person's ticket type
and contact (email or mobile number); an optional group column turns rows into parties. A person
already on the organiser's list with the same contact is not added twice. Passes can then be sent in
bulk, after a count of who will receive them.

**Allocations.** An organiser can give a company, sponsor, exhibitor or department a number of passes
of one ticket type. Its manager is invited by a link, sees "7 of 20 used", names people and hands
their passes over, or shares a single-use code per place that a person enters when registering.
Allocated places are held against capacity until the allocation expires, then released. A table at
a dinner can be given or sold this way.

### 11.6 Children and guardians

**Age bands.** An event can define age bands, such as child, teen and adult. People give a band,
never a date of birth.

**Guardians (O-44).** A person under 18 must be linked to an adult registration at the same event:
their guardian. A child is registered by a guardian, in a party, and never registers alone. The
guardian answers for them: questions, agreements and the presence-consent choice are recorded as
given by the guardian on the child's behalf.

**Age rules.** Access rules can refuse an age band in a room, such as an adults-only bar, and an
event can set a minimum age for entry. Where a room or the event needs age or identity checked, the
gate asks staff to check once (§18.4).

**Release to a guardian.** Where the event requires it, a child's pass at an exit or collection point
lets the child out only when a linked guardian, or another adult the guardian has named, presents
their own pass at the same time. A mismatch is refused and raises an alert. A supervisor may
override, giving a reason, and the override is audited. This works offline.

**Finding a child (O-45).** Where the event allows it, a supervisor or admin can look up the zone a
linked child last entered and when, giving a reason. Nothing earlier is shown, and nothing more
precise than the zone (D-04). Each lookup is written to the audit log. Attendees, guardians
included, cannot look anyone up: a tracker in a parent's hands could be used by an adult who is not
entitled to it. This is a narrow case of the audited exception in
[03 §5](03-security-privacy.md).

### 11.7 Companions

A person who needs assistance can bring a companion on a free companion pass linked to theirs. The
companion may go wherever the person they assist may go; their own age rules still apply. A
companion counts in occupancy and in the event's capacity, but not in the party limit. Booking a
session place books the companion's place too. The scanner shows "Companion of ⟨name⟩".

### 11.8 What is kept

Parties, ticket types, tables and agreements are kept with the registrations. Guardian links, age
and identity checks, and access needs are deleted with the event's movement data, because their
safety purpose ends with the event. Handover links are deleted seven days after they are used or
expire. Retention is set out in [03 §6](03-security-privacy.md).

---

## 12. Event profiles and presets

### 12.1 The profile

Each event has a **profile**: a set of switches that decide how people get in, what they carry,
what is inside, and which rules apply (D-25). Every switch defaults to the behaviour described in
§1–§10, so an event that changes nothing behaves as it always has.

| Switch | What it decides |
| --- | --- |
| Admission | Which paths are open: self-service, approval, invitation, allocation, list upload, tickets bought elsewhere, kiosk |
| Identity | Whether everyone gives a contact, everyone gives a name, only the party manager gives details, or nobody does |
| Parties | The largest booking, whether every guest must be named, handover, and until when transfers are allowed (§11) |
| Carriers | How QR codes and wristbands are used (§12.3) |
| Re-entry | After leaving through an exit (a repeat entry without one is amber, §7); freely, with no exit scan needed; or not at all once a person has left |
| Days | One day or several; the local time a new day starts; whether room counts reset overnight (§7) |
| Capacity | How many may register, how many may be on site at once, when registration opens and closes, and whether there is a waiting list (§13) |
| Age and safety | Age bands, minimum age, identity and age checks, release to a guardian, finding a child (§11.6, §18.4) |
| Sessions | Whether places in sessions are booked (§13.4) |
| Seating | None, tables, or seats (§13.5) |
| Languages | The event's languages and its default (§16) |
| Channels | Which of email, SMS and WhatsApp the event uses (§5.4) |
| Live view | What the Command Center leads with: rooms, arrivals, gates, tables, or sessions |
| Public occupancy | Shown on the event page above the minimum crowd size (O-08), or hidden (O-19) |
| Muster points | Whether assembly points are used in an emergency (§18.1) |

Ticket types, extras, agreements, registration questions and the access-needs question are lists
that belong to the event, not switches.

### 12.2 Presets

A **preset** fills in the profile for a kind of event. The presets come from a study of the events
Synan serves, from a 50-guest wedding to a 50,000-person festival.

| Preset | How people get in | Who gives details | Carriers | Parties | Age and checks | Also sets |
| --- | --- | --- | --- | --- | --- | --- |
| Conference | Self-service, approval, invitation | Everyone gives a contact | Wristbands inside | Up to 10, named; delegations | — | Optional session booking; live view of rooms |
| Wedding or private party | Household invitations | The manager only | QR at every gate | Seats per invitation; unnamed guests allowed | Age bands | Tables; a simple venue; live view of arrivals and tables |
| Concert | Tickets bought elsewhere; self-service | Everyone gives a contact | QR at every gate | Up to 6 | Adults-only bars; identity checked at the entrance | No re-entry; on-site limit |
| Festival | Tickets bought elsewhere; box office | Everyone gives a contact | Wristbands everywhere | Up to 8 | Age bands; guardians; release to a guardian | Several days; new day at 05:00; nightly reset except the campsite; extras |
| Trade show | Self-service; exhibitor allocations | Everyone gives a contact | QR at every gate | Delegations | Minimum age | Several days; an exhibitor ticket type |
| Class or workshop | Self-service; approval | Everyone gives a contact | QR at every gate | 1 | — | Booked places required; waiting list; live view of sessions |
| Seated show or match | Tickets bought elsewhere | Everyone gives a contact | QR at every gate | Up to 10 | Age bands | No re-entry; sections as zones |
| Corporate | List upload; department allocations | Everyone gives a contact | QR at every gate | 1 | — | A ticket type per department |
| School or children's event | List upload; guardian registration | The guardian only | Wristbands everywhere, linked to guardians | Family | Age bands; guardians; release to a guardian; finding a child | Agreements (consent forms); muster points |
| Community or religious gathering | Self-service; kiosk | A name, or nobody | QR at every gate | Up to 10 | — | On-site limit; public occupancy; repeats weekly |
| Public free event | Kiosk; self-service | Nobody | Wristbands inside | — | — | Public occupancy |
| Gala or fundraiser | Invitations; table allocations | Everyone gives a name | QR at every gate | Per table | Adults only | Tables; meal extras |

**Choosing.** The event type is the first choice in the event wizard. It can be changed, and any
switch adjusted, until the event is published. Presets for a single space create a **simple venue**
(one zone, one main area, one entrance), so the organiser of a wedding never has to draw a venue. An
organiser can save any event as their own template, and repeat an event weekly.

**After publishing.** A change that would take away what people already hold is refused: a party
limit or a quota can only rise above what is already used. The carrier policy and the re-entry rule
are fixed once the event is live. Every change to a published event is shown as a difference before
it applies, as access-rule changes are (§4).

### 12.3 Carrier policy (O-35)

This extends §5.1, the gate devices in §2, and D-11, which stays the default.

| Policy | Perimeter gates and desks | Interior gates | Suits |
| --- | --- | --- | --- |
| Wristbands inside (default, D-11) | QR, short pass code, wristband | Wristband only | Conferences |
| QR at every gate | QR, short pass code, wristband | Portal QR, wristband | Weddings, classes, small events, events with no wristbands |
| Wristbands everywhere | Wristband; a QR only at desks, to collect a band | Wristband only | Festivals |

- **QR at every gate** still works offline, because portal codes are signed and checked with public
  keys (D-12). Its cost is speed: reading a QR is slower than a tap.
- **Events with no wristbands.** Their gates need only a camera, so any phone or tablet can staff
  them, iPhones included, and staff may use their own phones (O-35). Wherever wristbands are used,
  D-09 applies.
- **Reusable printed pass (O-36).** An event with QR at every gate and no VIP or Private Invitation
  ticket types may make its printed passes reusable, for guests without a phone. Such a pass is
  protected like a standard wristband, by anti-passback and impossible travel
  ([03 §2](03-security-privacy.md)). It is an exception to D-05.
- **Imported ticket codes** are accepted once, at a perimeter gate or desk, under every policy.

### 12.4 What an organiser configures, and what is fixed

| Area | An organiser configures | Fixed by Synan |
| --- | --- | --- |
| Tiers | Which of the four are used, and their room access | The four tiers and what each means (§4). No new tiers and no renaming: ticket types carry the names (O-37) |
| Ticket types | Names, descriptions, quotas, tier, valid days, rooms, extras, approval, minimum age, identity check, shown publicly or by link only | Each sits under exactly one tier; the credential carries none of it |
| Questions | Fields, asked per person or per booking, required or not, by age band | The contact and name rules of the identity switch; the presence-consent row is separate and unticked; access needs use a fixed list plus a note |
| Parties | Largest size, names required, handover, transfer cut-off | One registration and one credential per person; one holder per pass |
| Age | Bands, minimum age, checks, release to a guardian, finding a child | Consent on someone's behalf is recorded; no dates of birth; the guardian age (O-44); the limits on finding a child |
| Extras | Names, quantities, per event or per day, collection points, choices such as a meal | What a collection point answers; how offline conflicts are handled (D-13) |
| Carriers | One of the three policies | The cryptography (D-12); sent copies are single-use, except reusable printed passes (O-36) |
| Staff | Which of the seven roles each person holds; what each checkpoint does at the event | The seven roles. No custom roles or permissions (O-37) |
| Scanning | The access rules | The decision order and its results (§7) |
| Messages | Which messages are sent, and their wording around the fixed parts (§17) | The fixed parts: code, link, time, opt-out; what a message may never contain |
| Retention | The grace period (O-06) | The purge of movement data; alerts and audit kept 12 months; access needs deleted with movement data |

---

## 13. Capacity, places and ticket types

### 13.1 Ticket types

Each event offers one or more **ticket types**, named by the organiser: "Saturday pass", "Bridal
party", "Exhibitor", "Student". Every registration holds exactly one. Each ticket type sits under
one of the four tiers, which decides how it is obtained, which wristband chip it uses, and whether
the event is listed (§4). A ticket type sets:

- its quota;
- whether it needs approval;
- the days and times it is valid;
- the rooms it reaches, through access rules;
- any minimum age, and whether identity is checked at the gate (§18.4);
- the extras it includes (§14);
- whether it is a companion pass (§11.7);
- whether it is shown publicly or offered only by link.

An event that defines none has one ticket type for each tier it uses, named after the tier. The
credential carries none of this: everything is resolved on the server at each scan (§4, §7).

### 13.2 Limits and the registration window

- An event can limit how many people may register (confirmed and reserved places together), and
  separately how many may be on site at once. The on-site limit is checked at perimeter entrances
  (§7, step 7).
- Registration opens and closes at set times. Before it opens, the event page says when it will.
- A pass is issued only once a registration is confirmed.

### 13.3 Approval and waiting lists

- Ticket types that need approval wait in the organiser's **approval queue**, where an organiser or
  admin approves or declines each registration. VIP by approval is one such ticket type.
- When a ticket type or the event is full, people can join a **waiting list**. A freed place is
  offered to the next in line for a limited time; if it is not taken, it moves on. A party waits and
  is offered places together, unless the event allows a party to be split.

### 13.4 Places in sessions

A session can have a number of places and require them to be booked. A person without a booking is
refused at that room's door while the session runs, with the reason "Not booked for this session".
Places not taken up a set time after the session starts are released, first to people waiting, then
to anyone at the door. While the session runs, the room admits no more than the smaller of its places
and its capacity. Bookings are deleted with the event's movement data; how many places were booked,
used and released is kept.

### 13.5 Tables and seats

An event can lay out tables, and seats where used, and assign people to them, keeping parties
together. A person's table is shown on their pass and at the desk. Tables are not doors: no gate
checks them. The live view and the summary can show arrivals per table.

### 13.6 Tickets bought and paid for elsewhere (O-02)

Synan never holds attendees' money. An event with paid entry sells its tickets elsewhere, and the
organiser brings the buyers into Synan:

- by uploading the paid orders as a list (§11.5), which issues a pass to each person; or
- by importing the ticket barcodes themselves. Each imported code is accepted once at a perimeter
  gate or desk, like a sent copy (§5.1).

Refunds stay with the platform that sold the ticket; the organiser cancels the pass in Synan.

A later option: the organiser connects their own payment account, so that the organiser, not
Synan, is the merchant. Synan issues the pass only after confirming with the payment provider that
the payment went through, and revokes it if the payment is refunded or reversed.

---

## 14. Entitlements: things collected by a tap

An **extra** is something a pass entitles its holder to collect a set number of times, per event or
per day: a meal, drinks, a goodie bag, a cloakroom place, a parking space. Extras are included in
ticket types or given to single passes.

- **Collection points.** For each event, a checkpoint can be a collection point for one or more
  extras. A tap there answers `redeemed`, with what is left; `nothing_left`, with when it was last
  used; or `not_included`. Where one point serves several extras, staff choose which on the scanner.
- A collection point counts no occupancy and applies no anti-passback. Impossible travel still
  applies, because it catches copied wristbands.
- **Choices.** Where an extra depends on a person's answer, such as a meal choice, the point shows
  that choice ("Vegetarian"). A meal choice can reveal religion or health, so it is shown only at the
  serving point and in totals.
- **On the pass.** The pass shows what is included: "Lunch ×1, drinks 1 of 2 left".
- **Offline.** A collection point works from the balances in its allowlist. An extra collected twice
  across offline points is caught when they sync and raised as a low-severity alert, never discarded
  (D-13). The pass is not suspended.
- **Cloakroom and parking.** The extra proves the right to use the cloakroom or car park. Tracking
  the coat, or counting parking spaces, is outside Synan: vehicles are not people, and a car park is
  not a room.
- **What is kept.** Individual collections are deleted with the event's movement data. How many of
  each extra were collected, by choice and over time, is kept.

---

## 15. Organisers

### 15.1 What belongs to an organiser

Each organiser has its own events, venues, staff memberships, wristband stock, registrations,
answers, consent records, reports, webhooks, alerts and audit log. Nothing belonging to one
organiser is visible to another, and the separation is enforced by the database, not only by the
screens. Venues are not shared between organisers (O-32). A wristband retired by one organiser can
be imported by another.

Staff sign-ins are not tied to one organiser: one sign-in can hold roles for several organisers,
such as a security firm working for many, and works for one organiser at a time (§3).

Each organiser has its own public page listing its events. A listing across all organisers is
opt-in for each event (O-31).

### 15.2 One person across organisers (O-28)

A person signs in once and sees, in one wallet, every pass they hold, whatever the organiser: a
wedding this month, a conference next. Underneath, each organiser's information about that person is
stored and governed separately: what the person gave through one organiser's registrations belongs
to that organiser alone. A hidden directory, which no organiser can read, links the person to each
organiser's record, so that the person sees one wallet and can use their rights everywhere at once.

| Belongs to the person | Belongs to each registration (one organiser, one event) |
| --- | --- |
| Sign-in, contacts, language | Answers, consent, agreements, check-in, ticket type, party |

### 15.3 What an organiser may see about a person

- Only what the person gave through that organiser's registrations.
- Never the person's registrations with other organisers, nor that they exist, nor any profile that
  spans organisers.
- Attendee search covers only the organiser's own registrations.
- Consent and agreements given to one organiser or event imply nothing for another.
- A guest without their own account, including a child, exists only within the organiser that
  registered them. A child never has a profile that spans organisers.

### 15.4 Rights requests

- A person can export everything Synan holds about them, across all organisers, from their account.
- A person can **withdraw from one organiser**: that organiser's registrations of them are erased.
- A person can **delete their account**: every organiser's records of them are erased. This is
  carried out by Synan, never by one organiser's admin.
- Each organiser's request queue shows only requests that touch its own registrations.

### 15.5 Joining as an organiser (O-30)

- An organiser signs up, which creates the organisation and its first admin. That admin must set up
  a second sign-in factor.
- A new organisation starts on **trial**: one live event of at most 300 attendees, no publicly listed
  events, and a daily cap on messages. Synan checks that the business is real before lifting these
  limits, which stops fake events being used to trick people.
- Before its first live event above the trial limits, an organisation needs two admins with a second
  factor, so that one lost phone never locks it out.
- Every new organisation gets a demo event filled with sample data, and every event can be rehearsed
  before doors open (§9, O-38).
- Each organisation's limits (live events, attendees per event, messages per hour and the like) come
  from its plan (O-34). One organiser's busy event never slows another's.

### 15.6 Synan's own staff (O-33)

Synan's own staff have no standing access to an organiser's data. They gain it only through a
time-limited support grant approved by the organiser, or, in an emergency, with a stated reason and
the approval of a second Synan administrator. Everything they do is recorded in Synan's audit log and
copied into the organiser's own, where its admins can read it.

### 15.7 Who answers for the data (O-29)

For event data (registrations, answers, scans), the organiser decides what is collected and why,
and Synan handles it on the organiser's behalf under a data-processing agreement with each organiser.
In data-protection terms, the organiser is the controller and Synan the processor. For the person's
own account (sign-in, contacts, language) and for operator accounts, Synan is the controller. Every
registration page names the organiser as responsible for the event and links to the privacy notice.

---

## 16. Languages (O-52)

- **Every surface can be shown in more than one language.** The first languages are English and
  Swahili. Luganda follows for everything attendees see and for the Gate Scanner. French follows
  when events open in Rwanda or the Democratic Republic of the Congo. Admin Command stays in English.
- **The organiser chooses an event's languages** and its default. Titles, descriptions, sessions,
  questions and message wording can be written in each. An event cannot be published while text is
  missing in one of its languages. Synan does not machine-translate an organiser's text (D-08).
- **The attendee chooses their language.** It starts from their phone's language, if the event
  offers it, and otherwise from the event's default. Messages, emails and the light pass page use the
  attendee's language.
- **Staff choose the scanner's language on their device**, whatever the event's languages. The
  colour, symbol, sound and vibration of each verdict are the same in every language.
- **Dates, times and numbers follow the reader's language.** Times are always in the event's time
  zone, with the zone named in the reader's language.
- **Names are one field.** Synan never asks for a first name and a surname separately, and shortens
  a name only to its first word, in a text message (§17).
- **Phone numbers** are entered as the person writes them and stored in international format.
- **Wording is written once**, in a shared catalogue for each language, never inside a screen. The
  server sends codes, not sentences, and each app or message words them in the reader's language.
  Notifications are kept the same way, so each reader sees them in their own language.

---

## 17. Event communications

**The messages.** Synan sends a fixed set of messages for each event, on the channels the event uses
(§5.4).

| Message | When | Can the attendee stop it? |
| --- | --- | --- |
| Sign-in code or link | When asked for | No: needed to use the service |
| Confirmation and pass | On registration, approval, or reply to an invitation | No |
| Know before you go | Two to three days before: the date, the time and its zone, and a link to the event page | No |
| Reminder | Once, 24 hours before doors open, in event-local time | No |
| Changes on the day | A session moved, retimed or cancelled; the event delayed; entry arrangements changed | No |
| Pass changes | Issued, re-issued, cancelled, under review, wristband bound | No |
| Thanks | 2 to 24 hours after the event closes, with an optional link to the organiser's own survey | Yes |
| Certificate ready | The day after the event closes, where the event offers certificates | No |
| Organiser news | Any time | Sent only with the attendee's agreement, given separately for each channel |

The organiser turns each event message on or off and can edit its wording, but not the code, link,
time or opt-out it carries. Wording the organiser edits is checked against the event's room, zone
and gate names before it is saved.

- **Announcements.** The organiser can send an announcement to all of an event's attendees, or to
  one tier, ticket type or party. They see how many people will receive it before it is sent.
  Announcements are limited in number, and every one is audited.
- **Quiet hours (O-54).** No message is sent between 21:00 and 07:00 in the recipient's time zone
  (the event's, if unknown), except sign-in codes and changes the organiser marks as urgent for
  safety. Held messages go at 07:00.
- **Limits (O-54).** An attendee receives at most two messages a day about one event, besides
  sign-in codes, pass messages and urgent changes.
- **Stopping messages.** Every message other than a sign-in code says how to stop messages. A stop
  request is honoured before the next send, and is kept for as long as the contact is.
- **What a message never contains.** A room, zone or gate name; where anyone is or has been; any
  other attendee; a tier; access needs; or the reason a pass is under review. Directions live on the
  event page, and messages link to it (O-54). A text message shows the guest's first name only,
  because phones show messages on the lock screen and are often shared. The short pass code appears
  only in pass messages.
- **Certificates (O-53).** Where the event offers them, an attendee who checked in can download a
  certificate that they attended the event on that date. Anyone can check it with the link printed
  on it. Certificates do not list sessions, because per-person session attendance is not kept after
  the event (D-03, O-23).
- **Lost property.** The event page carries a contact line for lost items, and the organiser may send
  one announcement about them. Synan keeps no register of lost items. Lost wristbands follow §5.3.
- **Emergencies.** Emergency broadcasts follow §18.1.

---

## 18. On-the-day exceptions

### 18.1 Emergency mode

An admin, organiser or supervisor can put a live event into **emergency mode**, or start a drill.
They confirm by typing a word. No second sign-in factor is asked, because delay is the greater risk.
Starting it raises a critical alert to every operator and is audited, as is ending it.

- **Gates.** Every exit is let through, and entry is refused except at muster points (§7). Fixed
  readers that control locks release them. An offline scanner has its own emergency switch, recorded
  when it syncs.
- **Headcount.** For each zone, the Command Center shows how many people were inside when the
  emergency started, how many have left since, how many have reached a muster point, and how many are
  not yet accounted for. Operators see exact counts. The screen says the figure is an upper bound:
  "last seen inside". It also shows, as a number, how many people with access needs were last seen in
  each zone (§18.6).
- **Names of those unaccounted for (O-46).** In emergency mode only, a supervisor or above can see the
  names of the people last seen inside a zone. The list is worked out when asked for, never stored,
  and every view is audited.
- **Broadcast.** An emergency message is pinned above the pass in the portal and sent to every
  confirmed attendee, and to the holders of passes held for others, on every channel the event uses.
  Quiet hours do not apply.
- **Muster points.** Where the event uses them, a tap at a muster point counts the person as safe.
- **Afterwards.** The emergency is kept for 12 months like an alert, without names, and appears in
  the post-event summary. Zone presence remains the only location shown (D-04).

### 18.2 Event cancelled or postponed

- **Cancel.** An organiser cancels a published or live event with a message, confirming with a
  second factor; the action is audited. Every registration is cancelled, every pass revoked, the
  waiting list cleared, and everyone told. The event becomes `cancelled` (§9) and the retention clock
  starts.
- **Postpone.** The organiser sets new dates with a message. Sessions, access-rule windows and the
  days tickets are valid move with the event. Passes stay valid. Each attendee gets a one-tap "I
  can't make the new date", which cancels their pass and frees the place.

### 18.3 A lost phone

An attendee who loses their phone can sign in on another device, or be found at the desk by name,
phone number or email with photo ID, or through their party if someone else holds their pass. The
desk can **re-issue the pass**: a new credential, so the lost phone's codes stop working, then a new
pass sent or a wristband bound on the spot. Once a wristband is on, no phone is needed, and the pass
screen says so.

### 18.4 Identity and age checks at the gate

- An event can require an identity check at the desk or at the perimeter; a ticket type can require
  one; and a room can be age-checked.
- When a check is needed, the scanner answers `check_required` in amber and says what to check:
  "Over 18", or the name to match against photo ID. For a child leaving, it asks for the guardian's
  pass (§11.6).
- Staff press **Confirm** to admit, or **Refuse**, which records a refusal with the reason that the
  check failed.
- Once age is confirmed, the person is not asked again at that event.
- Only the fact of the check is kept — that it was done, by whom and when — never anything from the
  document. Checks work offline, and are deleted with the event's movement data.

### 18.5 Agreements

- An event can ask for agreements: photo consent, a code of conduct, a waiver, terms, or its own.
  Each has a version, says whether it is required, and says who signs: the person, or their guardian.
  An agreement can apply to some ticket types only.
- A required agreement must be accepted before the registration is confirmed. A new version is asked
  for again, in the portal, or at the desk with a guardian present.
- The desk sees flags such as "No photos" or "Waiver missing".
- Agreements are kept with the registration, because a waiver must outlive the purge. They are
  separate from the presence-consent row ([03 §5](03-security-privacy.md)).

### 18.6 Access needs (O-47)

- An event can ask one optional question about access needs, from a fixed list: step-free access,
  seating, near an exit, hearing loop, sign-language interpretation, visual support, assistance
  animal, quiet space, companion or carer, and "something else" with a note.
- This is health information, so the person gives separate, explicit consent before it is stored.
- The desk clerk and the supervisor see the needs from the list, never the note. The organiser and
  admin see the note. Reports show counts only. In an emergency, the headcount shows how many people
  needing assistance were last seen in each zone (§18.1).
- A person who needs a companion can ask for a companion pass here (§11.7).
- Access needs are deleted with the event's movement data.
