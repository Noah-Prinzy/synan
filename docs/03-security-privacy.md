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
email. They expire the moment the RSVP is completed.

---

## 3. Authentication and authorisation

| Control | Detail | Phase |
| --- | --- | --- |
| Signed access tokens | `POST /auth/login` and `/auth/refresh` issue short-lived signed tokens carrying role scopes. Required on every REST request. | v1 |
| Attendee sign-in | Email link only. No attendee passwords exist. | v1 |
| Role-based access control | Route-level middleware separates attendee, operator, and scanner endpoints. Roles are in [01 §3](01-product.md). | v1 |
| Multi-factor authentication | Required for operators on privileged actions: manual tier change, wristband override, credential re-issue and pass resend, report export. A step-up lasts 15 minutes. | v1 |
| WebSocket ticket (P-16) | `POST /auth/ws-ticket` mints a single-use ticket valid for 30 seconds. The client passes it in the `Sec-WebSocket-Protocol` subprotocol, never in the URL, so it cannot leak into proxy logs or browser history. | v1 |
| Per-channel authorisation | Each channel authorises independently. An attendee may join only `/stream/me`; staff join `/stream/scans` for assigned checkpoints only. | v1 |
| Rate limiting | Per-IP and per-token limits on authentication and scan endpoints; a per-checkpoint limit of 3,000 scans per minute (§4); a strict per-attendee limit on self-service pass emails (3 per hour). Limits are counted per API instance in v1; running several instances needs a shared counter in PostgreSQL. | v1 |
| Payload validation | Every incoming payload is validated against the contract schemas ([02 §7](02-architecture.md)). | v1 |
| Transport | TLS everywhere: HTTPS and WSS. TLS 1.3 required. HSTS (one year, including subdomains) in production. Every API response forbids framing and sniffing, sends no referrer, and is never cached. | v1 |
| Webhook signing | Outbound and inbound webhooks carry HMAC signature headers. | v1 |

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
  (D-14).

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
  crowd size is met (O-08), so one person in a quiet room is not singled out.
- Never an individual's movement over time, with one exception: an access-history audit of a specific
  credential, which is itself written to the audit log.

**Consent.** At registration, consent to zone-presence processing is a separate row, unticked by
default, with a plain-language explanation and a "what we store" disclosure. It is not bundled into
the event terms.

**Attendee rights.** An attendee can export their data and request erasure from their account
screen. Operators see a queue of these requests.

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
altered or removed without breaking the chain. At minimum the following are audited: tier overrides,
credential revocation and re-issue, wristband rebinding, access-rule republishing, clearing a
suspended credential, credential access-history lookups, report exports (each scheduled export,
and separately whenever attendee identity is included), report-schedule changes, deletion of
exported files, operator broadcasts, shift handovers, and retention changes. Audit entries record
counts and lengths, never recipient addresses or message text.

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
| Rogue scanner connection | An unknown, revoked, rotated, or forged device or access token; an invalid stream ticket; a retired scanner; or no current assignment for the checkpoint. Mutual TLS rejection in hardening. | Connection refused or dropped. One high-severity alert per source and reason per 10 minutes, audited. The alert text carries no token or address. An expired token is not an alert: it is the normal cue to refresh. |
| Sudden zone density spike | Capacity thresholds in v1; predictive model later | Amber capacity warning in Admin Command. With the model, the warning arrives about 15 minutes before saturation and suggests overflow routing. |
