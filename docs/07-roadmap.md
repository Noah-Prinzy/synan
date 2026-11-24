# Synan — Roadmap

Build order, acceptance gates, and live status. **This is the only place status is recorded.** When
something is built, update §1 here; do not write a separate report.

---

## 1. Where we are

Last updated: 2026-11-23 (evening). Checked on this date by running them: all 8 workspace packages
typecheck; all three apps build; 891 automated test runs pass (database 205, with 8 more skipped
because they need a real PostgreSQL server; contracts 16; API 335 on each of its two storage
backends).

| Phase | Status | Detail |
| --- | --- | --- |
| Checkpoint 0 — look | **Done** | Identity chosen and applied (D-20). Mock-up files deleted |
| 0 — Foundations | **Done, with gaps** | See §1.1 |
| 1 — Attendee Portal | **Built on the mock layer** | A1–A9 built, balanced, and checked at phone and desktop widths. A10, A11 not started. See §1.2 |
| 1B — Backend skeleton | **Done** | See §1.3 |
| 2 — Admin Command | **Built on the mock layer** | D0–D6 and the post-event summary exist. Not yet connected to the real API. See §1.2 |
| 3 — Gate Scanner | **Built on the mock layer** | S1–S5 work as an installable phone app. Real scan submission, the offline queue, and allowlist signature checks are not built |
| 4 — Backend completion | **Done, unverified on real PostgreSQL** | All 111 endpoints and all four live channels are implemented. The job runner on real PostgreSQL has never run |
| 5 — Hardening | Not started | |
| 6 — Edge AI | Not started | |

### 1.1 Foundations — what exists

| Item | State |
| --- | --- |
| pnpm monorepo, Vite + React + TypeScript, Tailwind v4 | Done |
| `apps/attendee`, `apps/admin`, `apps/scanner` | All exist, build, and share one theme from `packages/ui` |
| `apps/api` | Exists (see §1.3) |
| `packages/ui` | Tokens, one shared theme file, the brand module, reward-on-click primitives, shared form controls (Select, Field, TextInput, TextArea, Checkbox, Dialog), and a mobile kit (install, offline, wake lock) |
| `packages/contracts` | Done: every enum, all 111 REST endpoints, all four WebSocket channels, error and scan-result copy |
| `packages/db` | Done: the full schema, migrations 0000–0022, rules, purge, pruning, seed (see §1.4) |
| `packages/mock` | Seeded fixtures, controllable clock, `MockRealtime`, all nine scenarios, and a mock of the admin's configure calls. **MSW request handlers not built**: apps read an in-process store that returns the contract shapes |

### 1.2 Screens — what exists

All screens run on the mock layer. None is connected to the real API yet.

| Screen | State |
| --- | --- |
| A1 Discover, A2 Event detail | Built. No sideways scroll at 360 px |
| A3 Registration | Built, three steps, inline validation. The success step says the pass link was emailed |
| A4 My pass | Built: rotating QR, all five states, whole QR visible on a phone in portrait and landscape, `Email me a copy`, `Keep screen on`, opens offline |
| A5 Bind wristband | Built, with real Web NFC reading |
| A6 Agenda, A7 Notifications, A8 Account, A9 Auth | Built |
| A10 Invitation | Not started |
| A11 Kiosk | Not designed (O-10) |
| D0 First-run setup | Built |
| D1 Command Center | Built, including a phone layout |
| D2 Venues, D3 Venue editor | Built: drawing on the grid, draft, diff, publish |
| D4 Events list, D5 Event wizard | Built: five resumable steps and a guarded publish |
| D6 Event workspace | Built: all eight tabs |
| D13c Post-event summary | Built |
| S1–S5 Gate Scanner | Built as an installable phone app on mock data |

Measured production bundles, gzip: attendee pass route 114.8 KB (over the provisional 110 KB, O-15;
about 8.5 KB of it is the mock layer, which leaves when the real API is connected); admin main chunk
144 KB (budget 180 KB, met); scanner 109 KB.

**The admin needs these from the backend before it can leave the mock layer:** the current
organisation; venue list counts; whole-layout publish with a layout version; venue floors and default
capacity; an event draft's wizard step; a readiness endpoint; a published time on the access-rule
set; a series per headline figure on the event summary; report rows without a kind for the workbook
and PDF; and state words for credentials, carriers, roles, and registrations in the contracts' copy.

### 1.3 Backend — what exists

- **All 111 endpoints and all four live channels** are implemented and tested on both storage
  backends: in-memory, and SQL through `packages/db`.
- **Delivery:** email goes through an encrypted outbox and the job queue, with retry after a crash;
  reports export as an Excel workbook, CSV, and PDF, on demand or on a schedule; exported files are
  registered, encrypted, and deleted after 7 days; attendee notifications are stored.
- **Operations:** gate health comes from registered devices, including staff phones; shift handover
  returns a summary; audit entries and alerts older than 12 months are pruned daily.
- **Not built:** attendee notifications when a session's time changes, because no endpoint edits a
  session yet.

### 1.4 Verified, and not verified

There is no PostgreSQL server on the development machine. Database and API tests run against an
in-process PostgreSQL (PGlite). That leaves these **unverified**:

- Behaviour under concurrent load: the audit chain lock, constraint races, partition create and drop,
  and two workers claiming the same email.
- Row-level security and grants under the real role split (the in-process engine uses `SET ROLE`).
- The job runner (pg-boss) on a real server: it typechecks and has never run.
- Index use and speed at real volumes. None of the targets in [02 §9](02-architecture.md) is measured.
- Anything on a real or managed PostgreSQL: extension and policy privileges.

Also unverified in the apps:

- Anything on a physical phone. Android: QR reading in low light, torch, NFC, vibration, wake lock
  over a whole shift, install, a USB reader. iPhone: Add to Home Screen, wake lock, the pass opening
  offline.
- The dropdown fix as a rendered popup (checked by computed colours only), and in Firefox.
- Admin screens at 1920 px beyond the Command Center, workspace overview, Rooms and rules, Venues,
  and the venue editor; and the admin's error states in a development build.
- Command Center frame rate against the 55 FPS target.

### 1.5 Known gaps against the specification

1. **The apps are not connected to the API.** Every screen reads the mock layer. Connecting them is
   the next large piece of work, and the admin needs the backend additions listed in §1.2 first.
2. **Rate limits and alert de-duplication are counted per API instance.** Running more than one
   instance needs a shared counter in PostgreSQL ([03 §3](03-security-privacy.md)).
3. **A duplicate email is possible in one case:** a worker hands a message to the provider and then
   stalls past its 120-second claim. Whether the recipient sees two copies depends on the provider
   honouring the idempotency key (O-13).
4. **The in-memory backend used for development does not encrypt.** Production requires the SQL
   backend.
5. **An offline scanner can still back-date a scan** within its own shift until the sync grace
   period ends.
6. **Gate Scanner:** real scan submission, the IndexedDB queue, and allowlist signature checks are
   not built.
7. **Pass bundle:** within the 125 KB budget with the real API (120.9 KB); 131.0 KB on the mock layer, which is not shipped.
8. **Admin:** the leave-without-saving guard does not catch the browser's Back button.
9. **Operator login lockout** (5 failures in 15 minutes) can be used to lock a named operator out.
10. **MSW request handlers** are not built in `packages/mock`.

---

## 2. Phases

Each phase lists what it delivers. Order matters: later phases consume what earlier ones stabilise.

### Checkpoint 0 — Look

Expressive for the Attendee Portal, in the Direction A structure; instrument-dense for Admin and
Scanner; radius 0 and hairlines; the abstract zone grid as the only map in version 1.

Reopened by the rebrand (D-18, D-19). It closes again when the owner has chosen an identity from the
brand board, the chosen wordmark, mark, icons, accent, and typefaces are in `packages/ui`, the
other options' files are deleted, and [05 §3, §4, §6](05-design-system.md) record the choice.

### Phase 0 — Foundations

Finish what is missing before more screens are written, because every screen built without
contracts is a screen to rework.

1. Create `packages/contracts` with enums first: `AttendeeTier`, `Role`, `ScanResult`,
   `CredentialState`, `CarrierState`, `EventState`, `AlertKind`, `Severity`.
2. Create `packages/mock`: MSW handlers from the schemas, seeded fixtures, `MockRealtime`, the named
   scenarios, and the controllable clock ([02 §8](02-architecture.md)).
3. Move the attendee app's `src/data/` fixtures behind the mock layer.
4. Scaffold `apps/scanner` and apply the theme preset.
5. Wire `apps/admin` to `@synan/ui`.
6. Measure bundle sizes and record them in §1.

### Phase 1 — Attendee Portal

1. Bring A1–A9 onto the contracts and mock layer.
2. Apply the decisions: four tiers, rotating QR on A4, single-use emailed copy, `UNDER REVIEW` state.
3. Build A10 Invitation.
4. Design and build A11 Kiosk once O-10 is settled.

This phase proves the credential story end to end.

### Phase 1B — Backend skeleton (D-15)

A thin real backend, built as soon as the Attendee Portal works on mocks. Its purpose is to catch
disagreement between the mocks and a real server while only one app depends on them, not three.

1. Express, PostgreSQL, Drizzle migrations, and the WebSocket server, importing `packages/contracts`.
2. Three slices only: **sign-in**, **events** (list and detail), and **scan ingest** with the
   occupancy rules and one live telemetry channel.
3. `gate_rate_rollups` written from the first scan (D-16).
4. The Attendee Portal switches those three slices from mock to real. Everything else stays mocked.

From here on, each endpoint is switched to the real server as it is built, rather than all at once
in Phase 4.

### Phase 2 — Admin Command

1. Chrome: top bar, alert strip, status bar, router.
2. D1 Command Center, D9 Access log, D10 Alerts — these define the telemetry contract.
3. D7 Attendees, D8 Provisioning, D12 Gate health.
4. D3–D6, D11, D13, D14, and first-run setup.

### Phase 3 — Gate Scanner

S1–S3 first, with the offline path simulated from the start, not retrofitted. Then S4, S5. The
scanner is the hardest surface and is deliberately third: it consumes every contract the first two
phases stabilise.

Before this phase begins: venue-owned Android gate devices are chosen and in hand for testing (D-09),
and the signed-QR validity window (O-07) has had its security review.

The scanner is built with its two modes from the start — perimeter (camera and tap) and interior
(tap only) — and with clock-offset capture and the post-sync conflict list (D-11, D-13, D-14).

### Phase 4 — Backend completion

Everything the skeleton in Phase 1B left mocked. The mock is switched off per endpoint as each one
lands. Order: roles with MFA → venues and
events → registration and the four tier flows → credentials and carriers → scan ingest with the
occupancy corrections, anti-passback, and offline reconciliation → telemetry aggregation → alerts and
webhooks → email → reports.
All controls marked **v1** in [03-security-privacy.md](03-security-privacy.md) ship here.

### Phase 5 — Hardening

- Load profiles against the service levels in [02 §9](02-architecture.md)
- Offline soak test
- Post-event purge worker, data export and erasure jobs
- Report export pipeline
- Observability
- Mutual TLS device certificates, signed scanner frames, the venue edge gateway (D-07)
- Cryptographic NFC wristbands for VIP and Private Invitation

### Phase 6 — Edge AI

Begins only when Phases 0–5 are complete and the system has run real events. The four intelligence
modules in [04-edge-ai.md](04-edge-ai.md), on venue hardware, in this order:
anomaly detection → crowd forecasting → schedule optimisation → attendee recommendations.

---

## 3. Acceptance gates

A phase is done only when its gate passes.

| Phase | Gate |
| --- | --- |
| 0 | All three apps start against the mock layer; every scenario in [02 §8](02-architecture.md) replays; no payload type is declared outside `packages/contracts` |
| 1 | A new attendee can register, receive a pass, bind a band (mock NFC), and watch the credential revoke live. An invited guest can RSVP from a link exactly once |
| 1B | The Attendee Portal signs in and lists events from the real server; a scan posted to the real ingest changes occupancy on a real WebSocket; a gate-rate row is written |
| 2 | 60 rooms update at ≥ 55 FPS under `doors_open` while a breach alert reaches the banner within 500 ms. Under `occupancy_drift`, counts return to truth without operator action |
| 3 | A device in airplane mode admits an allowlisted credential in < 120 ms, queues the scan, and reconciles exactly once on reconnect. `offline_conflict` raises one alert naming both scans. `clock_skew` orders scans correctly. An interior gate refuses a QR |
| 4 | The mock layer is removed and every screen passes against the real API with no copy changes — only transport swaps |
| 5 | Every service level in [02 §9](02-architecture.md) is met under load; a closed event's scan data is gone after the grace period and its reports still render |
| 6 | Forecast warnings arrive at least 15 minutes before a simulated saturation; no model output can change a scan verdict |

---

## 4. Risks

| Risk | Mitigation |
| --- | --- |
| Data model churn after the frontend starts | The model is fixed in [02 §4](02-architecture.md); the contracts package makes churn visible as type errors |
| Screens built before contracts exist need rework | Phase 0 is finished before new screens are started |
| Web NFC is Android-only | Desk provisioning is the primary path; in-browser NFC is an accelerator |
| Mocks and the real server disagree | A real backend skeleton exists from Phase 1B, and endpoints switch over one at a time |
| Gate staff arrive with iPhones | Gate devices are venue-owned Android or fixed readers (D-09); procurement is a Phase 3 precondition |
| A lost scanner is used to forge passes | Scanners hold public keys and credential hashes only (D-12) |
| Offline reconciliation disputes | Idempotency keys, clock-offset ordering, conflicts raised as alerts, and an explicit reconciliation report |
| Occupancy drifts because nobody taps out | Implied exits, session-end reset, manual recount (D-10) |
| Admin density on small laptops | One breakpoint at 1280 collapses the right rail into a tab |
| Attendee redesign exceeds the bundle budget | Route splitting, lazy loading, and CSS animation in place of the motion library where it is enough |
| Scope creep into ticketing and payments | Declared out of scope in [01 §1](01-product.md) |
| Edge hardware is unspecified | AI is last; version 1 does not depend on it |

---

## 5. Before launch

Things outside the build phases that must exist before Synan runs a real event. None is started.

| Item | Why | Open question |
| --- | --- | --- |
| Hosting and a real PostgreSQL server | Nothing has run on a real database. The concurrency, role-separation, and privilege checks in `packages/db/test/real-postgres.test.ts` need one | O-24 |
| Database backups and a restore drill | No backup or recovery plan exists | |
| Encryption keys and the three database logins provisioned in a secrets manager | The server refuses to start in production without them | |
| A transactional email provider with a verified sending domain | Passes, sign-in links, and invitations are only logged today | O-13 |
| Venue-owned Android gate devices, or fixed readers | A web app can read wristbands only in Chrome on Android (D-09) | O-14 |
| Wristband stock and the chip profile for VIP and Private Invitation bands | Bands are a mandatory carrier | O-03 |
| Trademark search for the name and the mark; purchase of the domains | Only web searches and domain lookups have been done (D-18, D-20) | |
| Privacy policy, terms, and the consent wording, reviewed by a lawyer | The system processes personal and presence data | O-06, O-08, O-11 |
| The retention grace period confirmed | The purge is irreversible | O-06 |
| A decision on event photographs | Screens are built for both cases | O-20 |
| Apple and Google Wallet passes | Specified in [06 A4](06-screens.md), not built; needs developer accounts and certificates | |
| An accessibility review and a load test against [02 §9](02-architecture.md) | No performance target has been measured | |
