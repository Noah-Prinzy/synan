# Synan — Security and Privacy

How Synan is protected and what it does with personal data. Synan runs over public networks
while controlling physical doors, so every layer is defended.

Each control is marked with the phase in which it ships: **v1** (with the backend, Phases 1B and 4)
or **Hardening** (Phase 5). Phases are defined in [07-roadmap.md](07-roadmap.md).

---

## 1. Principles

1. **Server-side authority.** A QR code or wristband carries only an opaque, signed credential
   identifier. Tier and room permissions are resolved in PostgreSQL at scan time. Nothing sent by a
   client is trusted to state its own privileges.
2. **Deterministic rules decide access.** Admit or refuse is always decided by fixed Node.js and
   PostgreSQL logic. The AI model advises; it can never open a door ([04 §4](04-edge-ai.md)).
3. **Privacy by design.** Personal identity is kept apart from movement data, movement data is
   reduced to zone presence, and it is destroyed when the event is over.
4. **Defence in depth.** Hardware, network, application, database, and AI layers each carry their own
   controls.

---

## 2. Credential cryptography

| Carrier | Mechanism | Phase |
| --- | --- | --- |
| **Portal QR** | A short-lived code **signed by the server** with an asymmetric key (Ed25519). It names the credential and an expiry, and is replaced on a short interval (O-07), so a screenshot or photograph expires. A scanner verifies it with the server's **public key** and holds no secret (D-12). The portal fetches a small batch of consecutive codes ahead of time, so the pass keeps rotating through a short loss of signal. The code is compact — 125 characters: a type-and-version prefix, then key id, expiry, validity window, credential reference, and signature in binary — so the QR stays light enough to read quickly at a gate. | v1 |
| **Emailed QR** | A signed, non-sequential token. Single-use: it is marked redeemed at its first use and refused afterwards (D-05). Same compact signed format as the portal code, with its own prefix; 144 characters. | v1 |
| **NFC wristband — VIP and Private Invitation** | NTAG 424 DNA or MIFARE DESFire EV3. Each tap produces a rolling AES-128 Secure Unique NFC message, verified server-side, so copying the static identifier is useless. | Hardening |
| **NFC wristband — Ordinary and Public** | Standard chip identified by UID, bound to a credential. Protected by anti-passback and impossible-travel rules rather than by chip cryptography. | v1 |

Tokens are never database IDs and are never sequential, which prevents enumeration.

**Why signatures and not shared secrets (D-12).** A rotating code built from a per-attendee secret
would require that secret on every scanner that must verify it offline. One lost or compromised
staff phone could then forge any attendee's pass. With server signatures, a scanner carries only
public keys, which are safe to lose.

**QR codes are accepted only at perimeter gates and desks (D-11).** This limits where a forged or
replayed code could even be tried, and it means interior gates never depend on code freshness.

**Private Invitation links** are high-entropy, single-use tokens bound to a hash of the recipient's
email. They expire the moment the RSVP is completed. The emailed link carries the token after a
`#`, so it is never sent to a web server or written to its logs; the page sends it in the body of
the request to read the invitation (`POST /invitations/read`) and to reply. Each read counts
against the caller's address. A reply must give the address the invitation was sent to, and a
decline sends no name or answers.

---

## 3. Authentication and authorisation

| Control | Detail | Phase |
| --- | --- | --- |
| Signed access tokens | `POST /auth/login` and `/auth/refresh` issue short-lived signed tokens (10 minutes) carrying the role. Required on every REST request that is not public. A refresh token lasts 12 hours for operators and staff and 30 days for attendees. | v1 |
| Refresh rotation | Each refresh token works once and is replaced. A token presented again is treated as theft and ends the whole sign-in, with one exception: the same client (same browser and network) presenting it again within 10 seconds, while its replacement is still unused, is taken as a lost reply and given a fresh token. Anything later, from elsewhere, or after the replacement was used still ends the sign-in. | v1 |
| Attendee sign-in | Email link only. No attendee passwords exist. | v1 |
| Operator and staff sign-in | Email and password. Five wrong passwords in 15 minutes lock that account's sign-in for the rest of the window. A new staff member sets their password from a single-use invite (`POST /auth/activate`). | v1 |
| Role-based access control | Every endpoint names the roles that may call it ([02 §7](02-architecture.md)), and the server checks it on every request. Roles are in [01 §3](01-product.md); the matrix is below. | v1 |
| Multi-factor authentication | An authenticator-app code (TOTP). It is not asked at sign-in; it is asked when someone first does a privileged action, and a step-up then lasts 15 minutes. Privileged actions: manual tier change, wristband rebind or replacement, pass resend by an operator, report export and scheduling a report, a role change, webhook and device changes, processing an attendee's data request, and publishing a venue layout while an event there is live. A supervisor also needs it to clear or revoke a pass under review. Five wrong codes in 15 minutes lock the account's step-up for the rest of the window. | v1 |
| Authenticator set-up | `POST /auth/mfa/enrol` returns a new secret, shown as a QR code and a typed key; the secret is held encrypted and pending. `POST /auth/mfa/enrol/confirm` with the first code from the app completes set-up, counts as a step-up, and is audited. Someone not yet set up is offered set-up the first time a privileged action asks for a code. | v1 |
| WebSocket ticket (P-16) | `POST /auth/ws-ticket` mints a single-use ticket valid for 30 seconds. The client passes it in the `Sec-WebSocket-Protocol` subprotocol, never in the URL, so it cannot leak into proxy logs or browser history. | v1 |
| Per-channel authorisation | Each channel authorises independently ([02 §6](02-architecture.md)). An attendee may join only `/stream/me` and the public occupancy scope; staff join `/stream/scans` for the checkpoints they are staffing now; a desk clerk joins none. | v1 |
| Rate limiting | Per address and per signed-in subject, in buckets: sign-in and similar, 10 per minute per address; scans and heartbeats, 600 per minute per subject; operator pass resends, attendee data requests, and lost-band reports, 5 per hour per subject; an attendee's own pass emails, 3 per hour; anonymous public reads (occupancy, reading an invitation), 120 per minute per address; a new registration's sign-in link, 3 per 15 minutes per address; and 3,000 scans per minute per checkpoint (§4). Limits are counted per API instance in v1; running several instances needs a shared counter in PostgreSQL. | v1 |
| Payload validation | Every incoming payload is validated against the contract schemas ([02 §7](02-architecture.md)). | v1 |
| Transport | TLS everywhere: HTTPS and WSS. TLS 1.3 required. HSTS (one year, including subdomains) in production. Every API response forbids framing and sniffing, sends no referrer, and is never cached. | v1 |
| Webhook signing | Outbound and inbound webhooks carry HMAC signature headers. | v1 |

**The role matrix (D-23).** What each role may call. The list is pinned by a contracts test, so a
new endpoint has to be placed in it on purpose. Every signed-in operator and staff member may also
sign out, mint a WebSocket ticket, read their own profile (`GET /me/operator`), and set up and use
the second factor.

| Role | May | May not |
| --- | --- | --- |
| Admin | Everything the organiser, supervisor, and desk clerk may, plus the organisation, venues and gates, staff and shifts, webhooks, devices, and processing data requests | Submit or undo scans, send gate heartbeats, read shifts as their own, act as an attendee |
| Organiser | Events, sessions, access rules, registrations, invitations, attendees, credentials and bands, reports and schedules, broadcasts, the live screens, the attendee data-request queue (read) | Create the organisation; edit venues, zones, rooms, or gates; manage staff and shifts; webhooks; register, rotate, or retire devices; process or reject data requests |
| Supervisor | The live screens: dashboard, event summary, gate health and activity, a gate's scans, the venue, alerts (read, acknowledge, resolve), the access log, attendees and credentials (read), registrations (read), room recount, revoke and clear a pass under review (with a fresh second factor), shifts at a gate (read: gate, times, and display name only) | Edit events, rules, or venues; bands; reports; search the access log for one pass |
| Desk clerk | For the events of their current desk assignment only: the registrations (without check-in time), one registration, band stock, bind, rebind (second factor), desk codes, pass resend (second factor); their own shifts | Everything else, including every live channel |
| Security staff | Submit scans and undo their own; heartbeats; the offline allowlist; their own shift handover; alerts at their current gates (read, acknowledge); the gate list; bind a band and issue a desk code at a desk; kiosk registration; their own shifts | Operator screens, the access log, attendee data |
| Speaker, crew | Their own shifts | Everything else |
| Attendee | Their own identity, profile, registrations, pass, codes, notifications, sessions, lost-band report, data export and erasure | Anything not their own |

A desk clerk's limit to their own events is enforced by the handler, not by the role alone. A
shift is current when the server's clock is inside it.

---

## 4. Scanner and device trust (D-07)

**Version 1 — the Gate Scanner is a PWA on staff phones and tablets.**

- A scanner works only for a signed-in Security Staff user, only at a checkpoint that user is
  assigned to, and only inside the shift window.
- Every scan carries a client-generated idempotency key, so replaying a request cannot create a
  second admission.
- The offline allowlist ([01 §8](01-product.md)) is **signed by the server** and scoped to one event
  and shift. The scanner verifies the signature before trusting it. It holds credential hashes, not
  identities, and **no secrets**: a stolen scanner yields nothing that can mint a pass.
- Tap debouncing (60 seconds, same credential and gate), a per-person limit, and a per-checkpoint
  limit of 3,000 scans per minute stop sensor flooding. The checkpoint limit is above the whole
  venue's design peak ([02 §9](02-architecture.md)), so a legitimate gate cannot reach it, and it
  counts scans by when they happened, so an offline backlog is never throttled. Refused scans are
  returned to the scanner, counted in gate health, and alerted.
- Gate devices are venue-owned ([01 §2](01-product.md), D-09), so a scanner can be wiped, re-issued,
  and accounted for at the end of a shift.
- Conflicts that only appear when offline gates sync — a single-use QR used twice, a pass-back, a
  capacity overrun — are detected at sync and raised as alerts (D-13, §8.2).
- Each scan carries the device's clock offset, so a wrong or tampered clock cannot reorder events
  (D-14). The server's receipt time is the authority: an online scan is judged when it arrives,
  and an offline scan keeps its corrected time but never a time later than its arrival.
- **Offline scans have a deadline.** A queued scan must reach the server within one hour of the end
  of the shift it was taken in.
- **Late sync of stranded scans.** A scan left queued on a phone when its shift ends or is handed
  over may still be counted, for up to 12 hours afterwards, if it names the assignment it was made
  under. The server accepts it only if that assignment was for this gate and event and its shift
  covered the scan's time, and only from one of two senders: the assignment's own holder, or
  whoever is staffing that gate now, from a phone the holder used during that shift. The server
  learns which phones a holder used from the holder's own signed-in scans and heartbeats, and keeps
  only their hashes. The usual idempotency, clock, and back-dating rules still apply. Every late or
  stranded batch is audited (who sent it, for whose shift, how many), and a refused one raises a
  `rogue_scanner` alert. The reasoning: a scan stranded by a handover is real work at a real gate,
  and losing it would make the count wrong; tying it to the phone it was made on stops someone at
  another gate, or on another phone, from inventing past scans.
- **One device per phone install.** Each scanner install makes a random id once and keeps it on the
  phone. Gate health and allowlist age are recorded against that install at the venue, whoever is
  signed in, so a phone handed from one person to the next stays one device. The person signed in
  at its last heartbeat is recorded.
- **Undo.** A scanner may undo its own mistaken admission: only an `admitted` entry, only at the
  gate it is staffing now, and only within 60 seconds of the scan. The scan is never deleted; a
  correction record sits beside it and the count is corrected. An undo is audited, and the shift
  handover counts undone admissions separately. A scan still queued on the phone is simply never
  sent.
- **Allowlist contents and age.** The allowlist names credentials by hash and carries their state,
  their tier or role, the hashes of their live wristbands, and the hashes of the emailed codes that
  are still usable. A band written at the desk but not yet confirmed is left out, because it opens
  no door online either. The scanner checks the signature, the event, and the checkpoint before
  trusting a list, and reports the list's issue time with every heartbeat. A list more than 15
  minutes old is flagged as stale in gate health (O-05). With no trusted list, an offline scanner
  refuses what it cannot check.
- **Refresh.** If a token refresh gets no answer, the scanner retries the same token once, inside the
  server's 10-second grace (§3), rather than losing the sign-in on a weak connection.
- **Only Security Staff sign in.** The Gate Scanner refuses any other role at sign-in.

**Hardening — attested devices and a venue edge gateway.**

- **Mutual TLS.** Every scanner, kiosk, and staff tablet is provisioned with a hardware-bound X.509
  client certificate. Unrecognised devices are rejected at the network edge.
- **Signed frames.** Scanner-to-server messages include a sequence nonce and an HMAC signature to
  block replay and injection.
- **Edge gateway.** A venue-local gateway validates scans against an encrypted, read-only local
  cache when the internet link drops, and buffers signed scan logs in an append-only queue until it
  returns. This supplements the per-device allowlist; it does not replace it.

---

## 5. Privacy: personal data and location (P-12, D-04)

**What is stored about movement.** Zone presence events only: which checkpoint, when, and the
result. **No coordinates are ever stored, streamed, or displayed.** Where older material says
"coordinates", read "checkpoint".

**Identity is kept apart from movement.**

- Names, emails, and registration details live in an identity vault, protected by PostgreSQL
  row-level security and AES-256 column encryption with managed key rotation. Row-level security is
  in place and guards against application mistakes; isolating the vault from a compromised
  application needs a separate database role. Identity columns are encrypted with AES-256-GCM
  under a data key; managed key rotation is a Hardening item ([07](07-roadmap.md)).
- At first check-in, a credential is bound to an **ephemeral attendee ID** for that event. Scan
  records, WebSocket telemetry, occupancy counters, and AI inference use only this ID.
- Personal data is never sent into telemetry streams or to the AI model.

**What operators can see.**

- Occupancy per zone and per room, as exact counts, because capacity enforcement depends on them.
- On **public** views — the occupancy shown on event pages — a count is shown only once a minimum
  crowd size is met (O-08), so one person in a quiet room is not singled out. Public totals add up
  only the counts that are shown, so a hidden room cannot be worked out by subtraction. The public
  read (`GET /events/:id/occupancy`) needs no sign-in and gives only this view, for published or
  live events the caller may see.
- Never an individual's movement over time, with one exception: an access-history audit of a specific
  credential, which is itself written to the audit log. Searching the access log for one pass (by
  pass reference or band) is the same lookup: only admins and organisers may do it, every search
  that finds a pass is audited, and the log rows still carry no name.
- **What a supervisor sees.** The live screens, alerts, gates, and the access log without a
  per-pass search. To act on a pass under review, a supervisor may look an attendee up by name,
  email, or band and see that person's registration, pass, band hint, check-in, and last scan.
  Shifts at a gate show the person's display name only, never an email.
- **What a desk clerk sees.** Only the events of their current desk assignment: an attendee's name,
  email, tier, registration, pass state, and band hint, enough to check photo ID and bind or
  replace a band. Not check-in times, not movement, not alerts, and no live channel.
- **What gate staff see.** The result of each scan and alerts at their own gates, without the
  credential involved.
- **Masked identity.** An attendee's own profile shows their email and phone masked
  (`o•••@example.com`, `••••• 4567`). A wristband is shown by its last four characters only.

**Consent.** At registration, consent to zone-presence processing is a separate row, unticked by
default, with a plain-language explanation and a "what we store" disclosure. It is not bundled into
the event terms.

**Attendee rights.** An attendee can export their data and request erasure from their account
screen. Operators see a queue of these requests. Erasure scrubs the name, email, phone, and profile,
deletes the attendee's notifications and pending registrations, and ends their sign-ins.

**Phone number.** Optional at registration, used only if the desk needs to reach the person on the
day. It is stored encrypted, like the email, and removed by erasure.

**Pending registrations.** Someone who registers without being signed in gets a sign-in link by
email. Their answers (name, profile answers, phone) wait in the identity vault, encrypted, beside
the link, and the registration is completed when the link is opened, on whichever device. An
unused pending registration is deleted when its link expires. The request never overwrites the
identity of an address already known, and it answers the same whether the address is new, known,
or rate-limited.

**Public tier.** Walk-in attendees supply no personal data at all. Their credential is bound to an
anonymous ID from the start.

---

## 6. Retention and purge (D-03)

| Data | Kept for |
| --- | --- |
| Raw scan records | Until event close + grace period, then destroyed |
| Ephemeral ID mapping | Until event close + grace period, then destroyed |
| Occupancy and attendance aggregates | Indefinitely (non-identifying) |
| Per-gate, per-minute scan rates | Indefinitely (non-identifying; counts only, D-16) |
| Breach alerts | 12 months |
| Audit log | 12 months |
| Identity and registration records | Until the attendee erases them or the organisation's policy removes them |
| Exported files (reports, attendee data exports) | 7 days, then deleted |
| Pending registrations | Until the emailed link is opened, or until it expires; expired ones are deleted every 10 minutes |
| Outgoing email (the outbox) | 7 days after it is sent or fails |
| Sign-in links, WebSocket tickets, desk codes, staff invites | Until used or expired; cleared every 10 minutes |
| Undo records (`scan_voids`) | With the event's scans |
| Notifications to attendees | Removed with the attendee's erasure |

**The purge.** When an event closes, a scheduled worker waits for the grace period (O-06) and then
drops the event's scan partition and its ephemeral ID mapping. Scan data is stored in per-event
partitions precisely so that this is a partition drop, not a row-by-row delete.

After the purge, what remains is aggregate statistics, alerts, and the audit log. Breach alerts keep
their reference to the credential involved for their 12-month life, as a security record (O-11).

**Pruning.** A daily job deletes audit entries and breach alerts older than 12 months. The hash of
the last deleted audit entry is kept as the chain's anchor, so the remaining log still verifies end
to end and any later removal or alteration is still detected. Each run that deletes anything is
itself audited. The frozen post-event summary keeps its alert counts.

**Exported files.** Every exported file is entered in a register with its retention date. The file
is encrypted with its own key, which is wrapped by the data key. A cleanup job deletes each file when
its retention ends and audits the deletion; a deletion that fails stays due and is retried.

**Outgoing email.** An email is written to an encrypted outbox in the same transaction as the change
it announces, and sent by a job that carries only the outbox id. Addresses never appear in job
payloads, logs, or stored errors. A send is claimed for 120 seconds; an email abandoned by a crashed
worker is retried when the claim lapses, up to five attempts, and a worker records an outcome only
for the attempt it claimed. Outbox rows are deleted 7 days after they are sent or fail. Whether a
recipient can ever receive a duplicate depends on the email provider honouring the idempotency key
sent with each message (O-13).

**Encryption.** Data in transit: TLS 1.3, and mutual TLS between scanners, the WebSocket broker,
inference nodes, and the database once hardening lands. Data at rest: AES-256 for volumes, the
identity vault's columns, and backups, with role-restricted key access.

---

## 7. Audit (P-15)

Every privileged mutation is written to `audit_log`: who, what action, on what target, with what
detail, and when.

The log is **hash-chained**: each entry stores the hash of the previous entry, so an entry cannot be
altered or removed without breaking the chain. The audited actions are:

| Area | Actions |
| --- | --- |
| Set-up | Creating the organisation; creating and editing venues, zones, rooms, and gates; publishing a venue layout |
| Events | Creating, editing, duplicating, publishing, moving along the lifecycle, and deleting a draft; creating, changing, and deleting sessions; republishing access rules; purging an event's movement data |
| People | Registration at a kiosk; invitations; tier changes; an attendee editing their own profile; processing or rejecting a data request; erasure |
| Passes and bands | Revoke, re-issue, replace, resend by an operator, and the attendee's own resend; clearing a pass under review; binding, rebinding, replacing a damaged or lost band, marking a band lost, the holder's own lost-band report; issuing a desk code |
| Gates | A room recount; a scanner's undo; a late or stranded sync batch; a refused scanner connection; a different person signing in on a scanner; registering, rotating, or retiring a device |
| Lookups | Every credential access-history lookup, including an access-log search that finds a pass |
| Alerts | Acknowledge and resolve |
| Staff | Inviting, activating, changing a role, creating a shift, handover; setting up the second factor |
| Data out | Report exports (and separately whenever attendee identity is included), each scheduled export, report-schedule changes, operator broadcasts, deletion of exported files, webhook changes |
| Retention | Each pruning run that deletes audit entries or alerts |

Audit entries record counts and lengths, never recipient addresses, message text, tokens, or any
part of a token.

---

## 8. Threats and responses

### 8.1 Threat vectors and their controls

| Vector | Controls |
| --- | --- |
| **Cloning, replay, pass-back** | Rotating portal QR; single-use emailed QR; rolling NFC messages on high-privilege bands; stateful anti-passback; impossible-travel detection |
| **Privilege escalation, tier spoofing** | Opaque credential IDs resolved server-side; single-use invite tokens; role-based access control with MFA on privileged actions |
| **Scanner hijack, network interception** | TLS; assignment- and shift-scoped scanners; idempotency keys; mutual TLS and signed frames in hardening |
| **AI attacks: prompt injection, telemetry poisoning** | The model sees only structured numeric and categorical telemetry, never free text; it is advisory only; debouncing and rate limits stop flooding from skewing forecasts ([04 §4](04-edge-ai.md)) |
| **Database compromise, insider exposure** | Identity vault with row-level security and column encryption; hash-chained audit; post-event purge |

### 8.2 Response matrix (D-06)

| Detected | Detected by | System response |
| --- | --- | --- |
| Cloned or expired QR, or a replayed emailed QR | Deterministic HMAC and single-use check | Red denial at the scanner. Silent alert to the nearest gate's security tablet over `/stream/alerts`. |
| Unauthorised tier entry (for example Public at a VIP gate) | Access-rule evaluation | Denied; incident logged with checkpoint and time. Repeat attempts escalate the alert severity. |
| Repeat entry at the same perimeter | Anti-passback state | `already_inside` — amber notice to the gate operator. Not an alert. |
| Impossible travel | Transit-time rule; later refined by the AI model | Credential set to `suspended_review`. Floor supervisor notified with the last two checkpoints for physical verification. A supervisor clears or revokes it. |
| Offline conflict found at sync: single-use QR used twice, pass-back across gates, capacity overrun | Server-side reconciliation of queued scans | Alert naming every scan involved. Occupancy corrected. For a doubled QR or pass-back, the credential is set to `suspended_review`. |
| Scanner clock off by more than two minutes | Clock offset sent with each sync | Gate-health fault. Scans are still accepted and ordered by corrected time. |
| Rogue scanner connection | An unknown, revoked, rotated, or forged device or access token; a device moved to another checkpoint since its token was issued; an invalid stream ticket; a retired scanner; no current assignment for the checkpoint; scans sent outside the shift or after the sync deadline; or another person's queued scans sent from a phone they were not made on. Mutual TLS rejection in hardening. | Connection or scans refused. One high-severity `rogue_scanner` alert per source and reason per 10 minutes, at most 20 such alerts in all per 10 minutes, audited. The alert text carries no token or address. An expired token is not an alert: it is the normal cue to refresh. |
| Wristband reported lost by its holder | The attendee's own report from their account screen | The band is set to `lost` at once: gates refuse it online straight away, and it drops out of the next offline allowlist. A low-severity `band_reported_lost` alert tells the event's operators, and the desk sees the lost band on the registration and binds a new one. Nothing is replaced automatically. Audited; the attendee is notified. |
| Stale offline allowlist | The allowlist a scanner reports with its heartbeat is more than 15 minutes old while the event is live (O-05) | Gate health shows the gate's allowlist as stale, and one medium-severity `stale_allowlist` alert is raised per gate, naming only the gate and the age; no second one while it is open. A scanner offline with a stale list warns its operator to call a supervisor. When it syncs, any pass it admitted that the server would have refused is counted (the person is inside) and raises a high-severity alert. A scanner with no trusted list refuses what it cannot check. |
| Sudden zone density spike | Capacity thresholds in v1; predictive model later | Amber capacity warning in Admin Command. With the model, the warning arrives about 15 minutes before saturation and suggests overflow routing. |
