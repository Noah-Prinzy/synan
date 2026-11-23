# Connexia — Roadmap

Build order, acceptance gates, and live status. **This is the only place status is recorded.** When
something is built, update §1 here; do not write a separate report.

---

## 1. Where we are

Last updated: 2026-11-23. Status below was read from the repository's files. The apps were not run
or type-checked in this pass.

| Phase | Status | Detail |
| --- | --- | --- |
| Checkpoint 0 — look | **Done** | Direction agreed; identity locked 2026-11-22; surface split decided 2026-11-23 (D-01) |
| 0 — Foundations | **Partly done** | See §1.1 |
| 1 — Attendee Portal | **In progress** | A1–A9 exist against local fixtures. A10, A11 not started. See §1.2 |
| 1B — Backend skeleton | Not started | |
| 2 — Admin Command | **Started** | D1 only |
| 3 — Gate Scanner | Not started | `apps/scanner` does not exist |
| 4 — Backend completion | Not started | |
| 5 — Hardening | Not started | |
| 6 — Edge AI | Not started | |

### 1.1 Foundations — what exists

| Item | State |
| --- | --- |
| pnpm monorepo, Vite + React + TypeScript, Tailwind v4 | Done |
| `apps/attendee` | Exists, theme preset applied |
| `apps/admin` | Exists. Does not yet consume `@connexia/ui` |
| `apps/scanner` | **Missing.** The root `dev:scanner` script points at nothing |
| `packages/ui` | Tokens, motion primitives, 9 components ([05 §8](05-design-system.md)) |
| `packages/contracts` | **Missing.** Payload types are declared ad hoc inside each app |
| `packages/mock` | **Missing.** Apps read hand-written fixtures in `src/data/` instead; no scenario harness |

### 1.2 Attendee Portal — what exists

| Screen | State |
| --- | --- |
| A1 Discover | Built, redesigned layout |
| A2 Event detail | Built, redesigned layout |
| A3 Registration | Built, three steps |
| A4 My pass | Built, redesigned layout. **QR does not rotate yet** (D-05) |
| A5 Bind wristband | Built |
| A6 Agenda | Built |
| A7 Notifications | Built |
| A8 Account | Built |
| A9 Auth | Built |
| A10 Invitation | Not started |
| A11 Kiosk | Not designed (O-10) |

### 1.3 Known gaps against the specification

These were introduced by decisions taken after the code was written, or were never closed.

1. **Tiers.** The pass fixture uses a free-text tier ("General admission"). The four-tier enum (D-02)
   is not in the code.
2. **Signed rotating QR and single-use emailed QR** (D-05, D-12) are not implemented. The pass screen
   does not yet explain that the QR is for arrival and band pickup (D-11).
3. **`suspended_review` state and `suspended` scan result** (D-06) are not in the code.
4. **No contracts package**, so the rule "one declaration of every payload" is not yet true.
5. **Bundle budget.** The attendee pass screen was last estimated at about 105 KB gzip against a
   90 KB budget ([02 §9](02-architecture.md)). The figure is unverified and must be measured.
6. **Admin has one route.** No router structure, chrome, or shared components yet.

---

## 2. Phases

Each phase lists what it delivers. Order matters: later phases consume what earlier ones stabilise.

### Checkpoint 0 — Look

Editorial and expressive for the Attendee Portal; instrument-dense for Admin and Scanner; neutral
dark ground; Fraunces, Geist, JetBrains Mono; radius 0; the abstract zone grid as the only map in
version 1.

### Phase 0 — Foundations

Finish what is missing before more screens are written, because every screen built without
contracts is a screen to rework.

1. Create `packages/contracts` with enums first: `AttendeeTier`, `Role`, `ScanResult`,
   `CredentialState`, `CarrierState`, `EventState`, `AlertKind`, `Severity`.
2. Create `packages/mock`: MSW handlers from the schemas, seeded fixtures, `MockRealtime`, the named
   scenarios, and the controllable clock ([02 §8](02-architecture.md)).
3. Move the attendee app's `src/data/` fixtures behind the mock layer.
4. Scaffold `apps/scanner` and apply the theme preset.
5. Wire `apps/admin` to `@connexia/ui`.
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
