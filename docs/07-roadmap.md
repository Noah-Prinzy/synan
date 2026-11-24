# Synan — Roadmap

Build order, acceptance gates, and live status. **This is the only place status is recorded.** When
something is built, update §1 here; do not write a separate report.

---

## 1. Where we are

Last updated: 2026-11-24, at commit `f4dbeba` plus uncommitted work in the tree (the Command
Center map, the alert notice, the rail and phone menu, and two new colour tokens).

Checked on 2026-11-24 by running them, on the development machine:

| Check | Result |
| --- | --- |
| Typecheck, all 8 workspace packages | Pass |
| Database tests (in-process PostgreSQL) | 228 pass; 8 skipped because they need a real PostgreSQL server |
| API tests, in-memory backend | 413 pass |
| API tests, SQL backend on in-process PostgreSQL | 413 pass |
| Contracts tests | 21 pass |
| Gate Scanner tests | 74 pass |
| Builds: all three apps, in mock mode and in real-API mode | Pass |

That is 1,149 automated test runs passing. The Attendee Portal and Admin Command have no automated
tests of their own.

| Phase | Status | Detail |
| --- | --- | --- |
| Checkpoint 0 — look | **Done** | Identity chosen and applied (D-20). Light theme added (D-24). The overall look is under review (O-27) |
| 0 — Foundations | **Done, with gaps** | See §1.1 |
| 1 — Attendee Portal | **Built; runs on the mock or the real API** | A1–A10 built. A11 not designed (O-10). See §1.2 |
| 1B — Backend skeleton | **Done** | See §1.3 |
| 2 — Admin Command | **Mostly built; runs on the mock or the real API** | D0–D10, D12, D12b, and D13c built, with sign-in, the second factor, and role views (D-23). D11, D13, D13b, and D14 are placeholders. See §1.2 |
| 3 — Gate Scanner | **Built; runs on the mock or the real API** | S1–S5, with real sign-in, scan submission, the offline queue, signed allowlist checks, late sync, and undo. Pairing by gate code not built. Nothing tested on a physical gate device |
| 4 — Backend completion | **Done, unverified on real PostgreSQL** | All 132 endpoints and all four live channels are implemented. The job runner on real PostgreSQL has never run |
| 5 — Hardening | Not started | |
| 6 — Edge AI | Not started | |

### 1.1 Foundations — what exists

| Item | State |
| --- | --- |
| pnpm monorepo, Vite + React + TypeScript, Tailwind v4 | Done |
| `apps/attendee`, `apps/admin`, `apps/scanner` | All exist, build, and share one theme from `packages/ui`. Each builds against the mock or the real API, chosen by `VITE_API_URL` ([02 §8](02-architecture.md)) |
| `apps/api` | Exists (see §1.3) |
| `packages/ui` | Tokens, one shared theme file with dark and light themes, the theme module and `ThemeSwitch`, the ambient field, the brand module, reward-on-click primitives, shared form controls (Select, Field, TextInput, TextArea, Checkbox, Dialog, Button, ActionButton), the admin shell (top bar, rail, status bar), and a mobile kit (install, offline, wake lock) |
| `packages/contracts` | Done: every enum, all 132 REST endpoints, all four WebSocket channels, the role matrix pinned by a test, error and scan-result copy, and state words |
| `packages/db` | Done: the full schema, migrations 0000–0035, rules, purge, pruning, seed (see §1.4) |
| `packages/mock` | Seeded fixtures, controllable clock, `MockRealtime`, all nine scenarios, and mocks of the admin's calls. **MSW request handlers not built**: mock builds read an in-process store that returns the contract shapes |

### 1.2 Screens — what exists

Every screen below runs on the mock layer or on the real API, chosen when the app is built. No run against a hosted API server is recorded.

| Screen | State |
| --- | --- |
| A1 Discover, A2 Event detail | Built. No sideways scroll at 360 px. Live occupancy from the public read |
| A3 Registration | Built, three steps, inline validation, optional phone. Registration completes on whichever device opens the emailed link |
| A4 My pass | Built: rotating QR, all five states, pass switch for several events, holder name, band by its last four, lost-band state, whole QR visible on a phone in portrait and landscape, `Email me a copy`, `Keep screen on`, opens offline |
| A5 Bind wristband | Built, with real Web NFC reading and the desk code |
| A6 Agenda, A7 Notifications, A9 Auth | Built |
| A8 Account | Built: name and phone (masked), report lost band, export and erase, Appearance |
| A10 Invitation | Built: both link forms, read before reply, accept or decline |
| A11 Kiosk | Not designed (O-10) |
| Admin sign-in, second factor, authenticator set-up | Built, on the real API. Mock builds use a stand-in sign-in |
| Admin chrome | Built: top bar with the alert notice and its panel, grouped rail, one-line status bar, operator menu with clock, shift, and Appearance, phone menu. Role views per D-23 |
| D0 First-run setup | Built |
| D1 Command Center | Built: four figures, map without figures, rooms list, recent activity, phone layout. Small finishing items were still in progress at the last commit |
| D2 Venues, D3 Venue editor | Built: drawing on the grid, draft, diff, publish |
| D4 Events list, D5 Event wizard | Built: five resumable steps and a guarded publish |
| D6 Event workspace | Built: all eight tabs. The attendee actions in the detail sheet (resend, revoke, rebind, change tier) are shown but disabled |
| D7 Attendees | Built for admins and organisers as the workspace table; for supervisors as attendee lookup with clear and revoke |
| D8 Wristband desk | Built at `/admin/desk`: search, bind, desk code, rebind, lost band, resend, stock, offline banner. Bulk band import not built |
| D9 Access log | Built: filters, pause, totals, find a pass (audited) |
| D10 Alerts | Built: inbox, detail, acknowledge, resolve, clear or revoke. The webhook-deliveries tab not built |
| D11 Staff & shifts, D13 Reports, D13b Event report, D14 Settings | Placeholders |
| D12 Gate health, D12b Gate detail | Built. `Test read` has no endpoint and says it is not available; `Mark for maintenance` lasts only until the page is reloaded; allowlist age is not shown |
| D13c Post-event summary | Built |
| S1–S5 Gate Scanner | Built as an installable phone app: sign-in, gates from assignments, signed allowlist, IndexedDB queue with exactly-once sync, late sync, undo, heartbeats, end of shift with handover. Gate-code pairing not built |
| Light theme | In all three apps, with System, Light, and Dark per device |

Measured on 2026-11-24 from real-API production builds, gzip:

| Budget ([02 §9](02-architecture.md)) | Measured | |
| --- | --- | --- |
| Pass screen ≤ 125 KB (O-15) | 128.1 KB | **Over by about 3 KB** |
| Admin initial JS ≤ 200 KB (O-26) | 197.4 KB | Within, with little room |
| Scanner (no size budget) | 125.6 KB JS + 9.7 KB styles | |

These were measured with a script that follows the build's own imports: for the pass, the page,
its styles, the start-up code, and the pass screen, without the API client, which loads after the
pass is on screen; for the admin, every script loaded to open the Command Center when signed in.
The earlier figures (pass 120.9 KB, admin about 188 KB) were taken by a method not recorded, so the
two are not strictly comparable. The pass figure needs confirming by the same method before it is
acted on.

### 1.3 Backend — what exists

- **All 132 endpoints and all four live channels** are implemented and tested on both storage
  backends: in-memory, and SQL through `packages/db`. A test fails if any endpoint is left without
  a handler.
- **Roles (D-23):** seven roles, with the matrix pinned by a contracts test and enforced on every
  request; supervisor second-factor step-up for clear and revoke; desk clerks limited to their
  assigned events.
- **Attendee self-service:** profile and phone, every own registration, registration completed from
  a pending registration on any device, lost-band report, and the public occupancy read with totals
  that add up only shown counts.
- **Invitations:** read before reply, the token in the request body, decline without a name.
- **Scanner support:** late sync of stranded scans, undo with a correction record, refresh reuse
  grace, allowlist age on heartbeats and stale-allowlist alerts, one device per phone install, room
  chips for unlisted events, and the handover summary counting undone admissions.
- **Console support:** operator name and shift label, access-log filters and totals, gate activity,
  `gate.health` on the alerts stream, alert detail, desk reads and counts, the events staff may
  work, the supervisor's read of a gate's shifts, and band hints as the UID's last four.
- **Delivery:** email goes through an encrypted outbox and the job queue, with retry after a crash;
  reports export as an Excel workbook, CSV, and PDF, on demand or on a schedule; exported files are
  registered, encrypted, and deleted after 7 days; attendee notifications are stored, including when
  a session's time or room changes.
- **Operations:** gate health comes from registered devices, including staff phones; shift handover
  returns a summary; audit entries and alerts older than 12 months are pruned daily.

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
  over a whole shift, install, a USB reader, and the scanner's offline queue and late sync on a
  real device. iPhone: Add to Home Screen, wake lock, the pass opening offline.
- Real load: many scanners at once, a doors-open burst, and the service levels in
  [02 §9](02-architecture.md).
- Frame rate on real hardware: the Command Center against the 55 FPS target.
- The light theme across the admin screens: no full pass over every screen in both themes is
  recorded.
- Hover states, and the dropdown fix as a rendered popup (checked by computed colours only).
- Firefox and Safari: no check in either is recorded.
- Admin screens at 1920 px beyond the Command Center, workspace overview, Rooms and rules, Venues,
  and the venue editor; and the admin's error states in a development build.
- The real-API mode against a hosted API: separate origins over TLS.
- A real email provider: links, passes, and invitations are only logged (O-13).

### 1.5 Known gaps against the specification

1. **Rate limits and alert de-duplication are counted per API instance.** Running more than one
   instance needs a shared counter in PostgreSQL ([03 §3](03-security-privacy.md)).
2. **A duplicate email is possible in one case:** a worker hands a message to the provider and then
   stalls past its 120-second claim. Whether the recipient sees two copies depends on the provider
   honouring the idempotency key (O-13).
3. **The in-memory backend used for development does not encrypt.** Production requires the SQL
   backend.
4. **An offline scanner can still back-date a scan** within its own shift until the sync grace
   period ends.
5. **Pass bundle** measured over its 125 KB budget (§1.2), to be confirmed.
6. **Admin:** the leave-without-saving guard does not catch the browser's Back button.
7. **Operator login lockout** (5 failures in 15 minutes) can be used to lock a named operator out.
8. **MSW request handlers** are not built in `packages/mock`.
9. **Admin placeholders:** D11 Staff & shifts, D13 Reports, D13b Event report, and D14 Settings. The
   Reports entry in the rail and Settings in the operator menu lead to them.
10. **Admin attendee actions** in the workspace detail sheet (resend, revoke, rebind, change tier)
    are disabled; the endpoints exist.
11. **Admin gate pages:** no endpoint for `Test read`; `Mark for maintenance` is not stored; allowlist
    age and link history are not shown; the webhook-deliveries tab on D10 and bulk band import on D8
    are not built.
12. **Supervisor link:** a note on the access log links a supervisor to the event's attendee table,
    which a supervisor may not open.
13. **Gate Scanner:** pairing by gate code is not built; on the real API the verdict shows no holder
    name, because the scan result carries none; the device does not refuse an allowlist past its
    own validity window.
14. **Attendee Portal:** the pass screen names "the nearest registration desk" rather than a real
    desk; the account screen has no list of all registrations (the pass switch on A4 has them).
15. **Stale wording** left in the code: the admin's mock sign-in says sign-in asks for a code; the
    alerts empty state mentions a strip; the summary's downloads say the second-factor prompt is not
    built.

---

## 2. The way forward

Synan is to serve any kind of event (D-25) for many organisers (D-26), used by thousands and
thousands of people. The plan therefore makes the system solid first and widens what it does second.
Each phase and slice below says what it delivers; its gate is in §3. Order matters: later work
consumes what earlier work stabilises.

**The rule.** No new product feature starts before the many-organisers step (5.2) passes its gate.
Bug fixes, and design work the owner has approved, continue throughout. Every product slice leaves
the product working.

Sizes are given as the planning studies give them: **S** is up to three agent-days, **M** one to two
weeks, **L** three weeks or more, review included. No dates are set.

### 2.1 Phases behind us

What each earlier phase set out to deliver, kept as history. How far each got is in §1.

| Phase | What it set out to deliver | Where its unfinished work now sits |
| --- | --- | --- |
| Checkpoint 0 — Look | Expressive Attendee Portal in the Direction A structure; instrument-dense Admin and Scanner; radius 0 and hairlines; the abstract zone grid as the only map. Reopened by the rebrand (D-18, D-19) and closed by the choice of identity (D-20) | The look is revisited in the improvement phase (§2.3, O-27) |
| 0 — Foundations | The contracts package with enums first; the mock layer with seeded fixtures, live simulation, named scenarios and a controllable clock ([02 §8](02-architecture.md)); the attendee fixtures moved behind it; the scanner scaffold; the shared theme; bundle sizes measured | Mock request handlers, if still wanted, wait until after 5.2 |
| 1 — Attendee Portal | A1–A9 on the contracts; four tiers; rotating QR; single-use emailed copy; the `UNDER REVIEW` state; A10 Invitation; A11 Kiosk once O-10 is settled | A10 in Slice 6; A11 under Later (O-10) |
| 1B — Backend skeleton (D-15) | A thin real backend straight after the portal: sign-in, events, and scan ingest with the occupancy rules and one live channel; gate-rate rows from the first scan (D-16). From then on each endpoint switched to the real server as it was built | — |
| 2 — Admin Command | The chrome; D1, D9 and D10 first, because they define the telemetry contract; then D7, D8, D12; then D3–D6, D11, D13, D14 and first-run setup | — |
| 3 — Gate Scanner | S1–S3 with the offline path simulated from the start, then S4 and S5; perimeter and interior modes; clock-offset capture and the post-sync conflict list (D-11, D-13, D-14). Preconditions: gate devices in hand (D-09) and the O-07 security review | Whatever §1 lists as missing for the scanner (real scan submission, the offline queue, allowlist signature checks) is finished in 5.3 |
| 4 — Backend completion | Everything the skeleton left mocked, in this order: roles with MFA, venues and events, registration and the four tier flows, credentials and carriers, scan ingest with occupancy corrections and offline reconciliation, telemetry, alerts and webhooks, email, reports. All controls marked v1 in [03](03-security-privacy.md) | Proving it on a real PostgreSQL server is 5.1 |

### 2.2 Phase 5 — Hardening: the road to production

Today one server could run a 500-guest wedding or one 5,000-person conference, once the faults below
are fixed. It cannot safely run on two servers, it has never run on a real PostgreSQL server, and it
would stall at the entrance of a 50,000-person festival. Phase 5 closes that gap in six steps. The
first five run in order, 5.1 → 5.2 → 5.3 → 5.4 → 5.5, with 5.3 starting in the last part of 5.2.
Controls marked **Hardening** in [03](03-security-privacy.md) ship in this phase.

**Faults found in today's code.** Each is fixed in the step named, and all of them within Phase 5.

| # | Fault | Why it matters | Fixed in |
| --- | --- | --- | --- |
| 1 | Registration answers are stored on the person, not on the registration | Answers given to one organiser are visible to every other, and two events that use the same question overwrite each other's answers | 5.2 |
| 2 | The presence-consent choice is recorded and shown, but nothing at the gate reads it | The consent row promises something the system does not do; it must be settled before a guardian consents for a child | 5.2, once O-43 is answered |
| 3 | The attendee list shows every person in the installation, with a count of their registrations across all events | One organiser would see everyone else's attendees | 5.2 |
| 4 | There is no approval queue: "VIP by approval" can be reached only by changing a tier by hand | A promise in [01 §4](01-product.md) with nothing behind it. Built once, as the general approval queue that ticket types use ([01 §13.3](01-product.md)) | 5.2 |
| 5 | There is no boundary between organisers. The code takes "the first organisation" in seven places; event addresses and wristband identifiers must be unique across the whole platform; no database rule keeps organisers apart | D-26 cannot be met | 5.2 |
| 6 | Creating any event, even a draft, and every purge lock the whole scan table for the whole platform | One organiser's draft can stall another organiser's festival gates | 5.2 |
| 7 | One audit-chain lock serves the whole platform | Every audited action, for every organiser, waits in one line | 5.2 |
| 8 | Gate decisions are held inside one server process: the occupancy model, the lock per event, and the caches | A second server would decide from stale state and admit people wrongly (pass-back, capacity, single-use codes), and its live updates would never reach the other's screens. So there can be no second server and no failover | 5.3 |
| 9 | The scan path replays an event's whole history: every 15 minutes (the purge job forgets every event's model even when nothing was purged), after any session reset or layout change, on every undo, and at every restart | A festival would stall every 15 minutes, and one wedding's reset would rebuild everyone's | 5.3 |
| 10 | Each scan makes 12–20 database calls one after another behind the event's lock, and its writes are not all-or-nothing | At realistic network delays, 15–25 scans a second per event, below the 40 a second target; a crash mid-scan can leave a sent copy unspent | 5.3 |
| 11 | An offline backlog syncing holds the event's lock for minutes | Live gates time out and go offline, and the queue grows | 5.3 |
| 12 | Scheduled jobs have nothing to run them in production: the purge of personal data (a legal promise), session resets, totals, sign-in clean-up, invitation expiry, pruning. The job runner has never run | The promised purge would never happen | 5.3 |
| 13 | There is no real mail sender. Production refuses only the console sender, so the in-memory one silently drops every email. Sending is one at a time, and one queue serves sign-in links and bulk passes | Nobody receives a pass. A 50,000-pass send would take about 3 hours, with sign-in links waiting behind it | 5.3 |
| 14 | Exported files are kept on one server's own disk | With two servers, or after a redeploy, download links break | 5.3 |
| 15 | Rate limits and alert de-duplication are counted per server | With several servers the limits multiply and alerts repeat | 5.3 |
| 16 | Some memory never shrinks (every scan outcome is kept forever), and the transit-time table is never refreshed after a layout change | Slow growth over multi-day events, and a pass wrongly suspended | 5.3 |
| 17 | Sign-in limits are 10 a minute per address; mobile networks and venue Wi-Fi put many people behind one address, and behind a load balancer every client looks like one address | People are refused sign-in links at the gate | 5.3 |
| 18 | No build step, no health check, requests cut off on shutdown, no database timeouts, and full error objects in the logs, which can include query values | Fragile deploys; personal data can reach logs | 5.3 |
| 19 | Sign-in tokens sit in browser storage that injected script could read; the apps send no content security policy | A cross-site scripting flaw becomes an account takeover | 5.3 |
| 20 | A deploy can swap the scanner's code in the middle of a shift | A gate can change behaviour during an event | 5.3 |
| 21 | Encryption and signing keys sit in environment settings; the QR signing keys are in the database, encrypted under that same key; there are no keys per organiser | Anyone with the settings and a database copy could mint passes | 5.2 (keys per organiser), 5.3 (key vault) |
| 22 | Operators have no way back in if they lose their second factor | A sole admin can be locked out for good | 5.3 |
| 23 | The scanner allowlist is 29–42 MB for 50,000 passes, uncompressed, and every scanner fetches it again every 5 minutes | 6–8 MB a second across 60–100 scanners, on the server and the venue's link; low-end phones cannot read it quickly | 5.4 |
| 24 | Heavy reads: an event summary loads every row (about 260,000 at 50,000 people); desk search unlocks every candidate's identity; an attendee search without an event walks the whole platform | Slow screens and wasted capacity at the busiest moment | 5.4 |
| 25 | Every public occupancy refresh reaches the database, and public event pages are never cached | 10,000 open event pages make about 1,000 requests a second | 5.4 |
| 26 | A deploy drops every live connection at once, and each live update loops over every subscriber | A reconnection storm, and slow updates above 25,000 connections | 5.4 |
| 27 | Totals are rebuilt from the whole scan log of every live event every 5 minutes | Database load grows with every event | 5.4 |
| 28 | There are no automated checks on changes; the 8 real-PostgreSQL tests are skipped; the attendee and admin apps have no tests; there are no end-to-end tests | Every change is a risk | 5.1 |

#### 5.1 Engineering foundations (about 1–2 weeks)

**Goal:** every change is checked automatically, including on a real PostgreSQL server.

- Automated checks on every pull request, on hosted Linux runners, where a real database can run
  even though the development machine has none:
  - typecheck all 8 packages;
  - tests on both storage backends;
  - a **real PostgreSQL 17 job** running the skipped tests and a smoke test of the job runner
    (queue a job, run it, schedule it);
  - every migration applied to an empty database and to the previous release's;
  - schema generation shows no difference, and no applied migration has been edited;
  - builds within the bundle budgets (pass 125 KB, admin 200 KB, scanner);
  - dependency audit, secret scanning and static security analysis;
  - no stray files at the repository root.
- Branch protection: changes reach `main` only by pull request, with these checks required.
- The working rules in §2.6.

#### 5.2 Many organisers (about 4–6 weeks)

**Goal:** many organisers, their data kept apart by the database itself (D-26).

1. Record the design: accounts across organisers (O-28), addresses of the form
   `/{organiser}/{event}`, trial limits (O-30), Synan's own staff (O-33). S
2. Every table an organiser owns carries the organiser. Database rules stop one organiser's room
   being attached to another's event. Uniqueness becomes per organiser (event address, wristband
   identifier, email lookup). Memberships replace the single role on a user. Scan-table partitions
   are added and dropped without locking the platform (fault 6). M
3. An audit chain per organiser, plus one for the platform (fault 7). M
4. Row-level security forced on every organiser table, with no database login exempt; the 15
   database functions that bypass it rewritten to check the organiser. M–L
5. The server: every query bound to one organiser; "the first organisation" removed; the organiser in
   every token and live-connection ticket; signing, data and lookup keys per organiser; scanners fetch
   only their organiser's keys. Faults 1, 3, 4, 5 and 21 are fixed here, and fault 2 once O-43 is
   answered. L
6. A generated cross-organiser test: for every endpoint and all four live channels, organiser B's
   token against organiser A's data must be refused, on both backends and on real PostgreSQL with
   the three database logins. M
7. Organiser sign-up and onboarding, a minimal Synan console, and the table of plan limits (O-30,
   O-34). M

Nothing is deployed, so this is cheap now. Done later it would cost two to three times as much, plus
the rework of every feature built in between. These are **not started before 5.2 passes its gate**,
because they would be redone: shared rate-limit tables; live-update channel naming; the mail provider;
key management and rotation; backup and export tooling; A10 Invitation, A11 Kiosk and wallet passes;
cryptographic wristbands; webhook and report-schedule changes; mock request handlers; any new list or
search endpoint; the venue edge gateway.

#### 5.3 Production core (about 3–4 weeks, overlapping the end of 5.2)

**Goal:** correct on any number of servers; nothing held only inside one process.

- One database lock per event, one transaction per batch of scans; each server catches up from the
  scan log before deciding, and a light signal tells the others to catch up (fault 8).
- Replay removed: only the affected event is refreshed, the model is saved per event, and an undo is
  a correction, not a replay (fault 9).
- Batches looked up at once, rules cached, eight database statements or fewer per batch (fault 10).
- Offline syncs taken in small chunks, live scans first, scanners asked to slow down at peaks
  (fault 11).
- A worker and maintenance process runs the scheduled jobs; each records its last success, and an
  alert is raised when one is overdue (fault 12).
- The email provider (O-13) with separate urgent and bulk queues, a duplicate-proof key on every
  message, and send limits per organiser (fault 13).
- Shared file storage (fault 14); shared counters in PostgreSQL (fault 15); bounded caches
  (fault 16).
- The proxy setting required in production, a higher per-address limit, bot protection at the edge
  (fault 17).
- A compiled build, health and readiness checks, shutdown that lets requests finish, database
  timeouts, structured logs with personal data removed, metrics and traces (fault 18).
- Sign-in tokens in protected cookies, and a strict content security policy (fault 19).
- Scanner updates applied only between shifts, with a remote kill switch (fault 20).
- Keys held in a key vault and rotated on a schedule (fault 21); recovery codes for operators
  (fault 22).
- Whatever §1 lists as missing for the Gate Scanner.

#### 5.4 Scale proof (about 2–3 weeks)

**Goal:** the targets in [02 §9](02-architecture.md), revised against the load in §3.1, are measured,
not assumed.

- A compact, compressed allowlist, sent as changes after the first download and built once per event
  outside the request path (fault 23).
- Summaries and lists computed in the database with paging and a time limit; desk search by an exact
  key first (fault 24).
- Public occupancy and public event pages cached at the network edge (fault 25).
- Live connections indexed by event and person, and closed gently on deploy (fault 26).
- Totals updated as scans arrive, not rebuilt (fault 27).
- Load tests whose thresholds are the gate: doors opening, an offline sync storm, a registration
  opening, 25,000 open pass screens, an allowlist refresh, a 50,000-person event beside 30 small
  ones, and an 8-hour soak.

#### 5.5 Operations and launch readiness (about 2–3 weeks)

**Goal:** event days are run safely.

- Dashboards for the service levels, and paging only while an event is live or within 2 hours of
  doors, with an on-call rota for event days.
- Runbooks, each rehearsed once: the database down during entry; a gate offline; the email provider
  down (switch to SMS or desk codes); a bad deploy during an event; a key compromised; a suspected
  leak between organisers; one organiser overloading the platform.
- A restore drill; the outside security test (penetration test); a status page; a support console
  (organiser and event health, limits, resend and unlock, audit export, support grants, O-33).
- An event-day freeze: no deploys or migrations while an event of more than 1,000 attendees is live
  or within 2 hours of doors, except urgent fixes approved by two people.
- The accessibility fixes found in the review: pages reflow at 320 px wide; sticky bars never hide the
  field in focus; the venue editor has a keyboard alternative to dragging; help sits in the same place
  on every attendee screen; small text is at least 13 px on the attendee and scanner apps; the page
  language follows the chosen language; the light theme's contrast is checked (D-24).
- The legal and operational items in §5.

#### 5.6 Venue and device hardening

Follows 5.5. The first real events do not wait for it (D-07). Mutual TLS device certificates, signed
scanner frames, and the venue edge gateway ([03 §4](03-security-privacy.md)); cryptographic NFC
wristbands for VIP and Private Invitation, with keys per organiser.

### 2.3 Design work alongside: the UI and UX improvement phase (O-27)

The owner has supplied three reference recordings (`archive/synan.mp4`, `synan1.mp4`, `synan2.mp4`).
What they share: depth from light, layering and motion instead of ruled lines; one statement per
screen; floating or icon-only navigation; rounded frames. An improvement phase for the Attendee
Portal and Admin Command is to be planned from them. It will revise the hairline, frame, navigation
and motion rules in [05](05-design-system.md), reconciled with D-22 (little animation; motion spent on
reward), and then rebuild screens in small steps.

It does not depend on the engineering work, so it may run alongside Phase 5 as approved design work.
It adds no features. Its plan and gate are written once the owner has reviewed the direction.

### 2.4 Product slices

The product work merges two studies: the order in which parties, event profiles and entitlements
should be built, and the ten changes that most widen who can use Synan. Each slice leaves the product
working, behind a switch per organiser until it is ready. A slice may start once 5.2 has passed its
gate; slices then run alongside 5.3–5.5. Large real events wait for 5.4 and 5.5 (§5). The behaviour
each slice delivers is specified in [01](01-product.md).

| Slice | Delivers | Makes possible | Depends on | Size |
| --- | --- | --- | --- | --- |
| 1 — Groundwork | Nothing visible changes. Each event gets a profile holding today's behaviour; one ticket type per tier made automatically; access rules by ticket type; passes listed by registration, each with a holder; a reason on every refusal; server messages and notifications stored as codes with values, not English sentences, so the language work does not grow; new styles written with start and end sides rather than left and right | Everything after it | 5.2 | M |
| 2 — Simple events | Event type and presets in the wizard; the simple venue; the "QR at every gate" carrier policy; event limit, on-site limit and registration window; approval for any ticket type; cancel and postpone; the rehearsal state and a demo event; save as template and repeat weekly ([01 §9, §12, §13, §18.2](01-product.md)) | Classes, simple weddings, church services and community gatherings without wristbands | Slice 1; O-35, O-38 | M–L |
| 3 — Reaching every phone | Contacts by email or mobile number; SMS sign-in codes with limits against abuse; the sent copy in place of the emailed copy; the light pass page; the short pass code; printable passes and door list; delivery status per channel; guest-list import from Excel or CSV with bulk sending; a longer stock of codes on the phone once O-07's review passes ([01 §5, §11.5](01-product.md)) | Guests without email or a smartphone; the organiser's real starting point, a guest list | Slice 1; the mail queues of 5.3; O-48, O-49, O-50, O-51; sender names registered well before | L |
| 4 — Parties | Named guests; held passes and the pass wallet; the desk's party view; cancelling and adding a member ([01 §11.1–§11.4](01-product.md)) | Couples, families, delegations | Slice 1 | L |
| 5 — Emergency mode | Opening the gates, headcount by zone, broadcast on every channel, muster points ([01 §18.1](01-product.md)). Needed before any large real event | Safe large events | Slice 3 for SMS broadcasts; O-46 | M |
| 6 — Handover and households | Handing a pass over and claiming it; transfer; change of manager; household invitations with a reply and questions per person (A10 Invitation); tables and seats ([01 §11.3–§11.5, §13.5](01-product.md)) | Weddings and galas complete | Slices 3 and 4; O-40, O-41, O-42 | L |
| 7 — Languages and messages | Shared wording catalogues, and Swahili for the attendee app and scanner; the message plan with quiet hours, daily limit, opt-out list and the organiser's own wording; WhatsApp delivery once Meta has approved the business and its templates; event certificates; the survey link ([01 §16, §17](01-product.md)) | Swahili speakers; the cheapest channel per message; the organiser's messaging | Slices 1 and 3; O-52, O-53, O-54 | L |
| 8 — Dependants and safety | Age bands; guardians and consent on someone's behalf; age rules; identity and age checks at the gate; agreements; access needs; companions ([01 §11.6, §11.7, §18.4–§18.6](01-product.md)) | Children's events; age-restricted events | Slice 4; O-43, O-44, O-47; legal review | L |
| 9 — Extras | Collection points, including balances offline ([01 §14](01-product.md)) | Meals, drinks, bags, parking | Slice 1 | L |
| 10 — Several days and tickets bought elsewhere | Days a ticket is valid; overnight reset; no re-entry; wristbands everywhere; imported ticket codes ([01 §12, §13.6](01-product.md)) | Festivals and concerts | Slice 2; the compact allowlist of 5.4; O-02 | M–L |
| 11 — Places, waiting lists and the rest | Waiting lists; places in sessions with release of no-shows; allocations; release to a guardian; finding a child ([01 §11.5, §11.6, §13.3, §13.4](01-product.md)) | Workshops with places; sponsors and exhibitors; school events | Slices 4 and 8; O-45 | L |

**Later, in no fixed order:** Luganda, then French (O-52); a sender name per organiser (O-49); the
pay link through the organiser's own payment account, when a paying promoter needs it (O-02, L);
wallet passes; A11 Kiosk (O-10); a listing across organisers (O-31); a voice note on WhatsApp
explaining how to enter.

### 2.5 Phase 6 — Edge AI

Begins only when Phase 5 is complete and the system has run real events (D-08). The four
intelligence modules in [04-edge-ai.md](04-edge-ai.md), on venue hardware, in this order: anomaly
detection → crowd forecasting → schedule optimisation → attendee recommendations.

### 2.6 How we build

Synan is built by many AI agents working at once. These rules keep the quality up.

- **One branch and one git worktree per agent.** Two agents never share a working copy.
- **Owners for the risky areas.** One agent at a time owns each of: database migrations; sign-in,
  row-level security and cryptography; the contracts package. A migration number is claimed in the
  pull request.
- **Small changes.** Small pull requests, merged through a queue, only into `main`, and only when
  every required check passes (5.1).
- **Independent review** by a person, or by an agent that did not write the change, is required for:
  migrations (locks, and whether they can be undone); sign-in, row-level security and cryptography;
  anything that filters by organiser; any change that deletes or weakens tests (the checks fail when
  the number of tests drops without a label); and consistency of the documents.
- **The specification changes in the same change.** When behaviour changes, the document that
  describes it ([01](01-product.md)–[06](06-screens.md)) is updated in the same pull request; when
  status changes, §1 here is too. Every pull request carries this as a checklist item.
- **Releases.** Development → staging (like production, with anonymised data, in the same region) →
  production. Migrations only move forward, add before they remove, run as their own step with a
  lock time limit, and never at server start. The server tolerates a schema one release newer.
  Rolling back means returning to the previous release. New features sit behind a switch per
  organiser.
- **Tests where they pay.** End-to-end tests through all three apps against the real server on
  PostgreSQL, for ten journeys:
  1. an organiser signs up and publishes a first event;
  2. an attendee registers, signs in from the link, and sees the pass;
  3. an invitation is answered exactly once;
  4. an online scan admits and the admin map updates;
  5. a pass revoked while open flips live;
  6. a scanner in airplane mode admits from the allowlist, queues, and reconciles exactly once;
  7. an offline conflict raises one alert naming both scans;
  8. a band bound at the desk admits on a tap;
  9. a report export downloads and is deleted after its retention;
  10. organiser B sees nothing of organiser A.

  Also: unit tests for the pass's states and code rotation, the scanner's decision, queue and
  duplicate protection, and the admin's live store; a test that every endpoint has a handler, an
  authorisation test and an organiser test; tests with network loss, clock error and a slow
  database; screenshot comparisons at 360, 1280 and 1920 px.

---

## 3. Acceptance gates

A phase, step or slice is done only when its gate passes.

| Phase | Gate |
| --- | --- |
| 0 | All three apps start against the mock layer; every scenario in [02 §8](02-architecture.md) replays; no payload type is declared outside `packages/contracts` |
| 1 | A new attendee can register, receive a pass, bind a band (mock NFC), and watch the credential revoke live. An invited guest can RSVP from a link exactly once |
| 1B | The Attendee Portal signs in and lists events from the real server; a scan posted to the real ingest changes occupancy on a real WebSocket; a gate-rate row is written |
| 2 | 60 rooms update at ≥ 55 FPS under `doors_open` while a breach alert reaches the banner within 500 ms. Under `occupancy_drift`, counts return to truth without operator action |
| 3 | A device in airplane mode admits an allowlisted credential in < 120 ms, queues the scan, and reconciles exactly once on reconnect. `offline_conflict` raises one alert naming both scans. `clock_skew` orders scans correctly. An interior gate refuses a QR |
| 4 | The mock layer is removed and every screen passes against the real API with no copy changes — only transport swaps |
| 5.1 | A pull request to `main` cannot merge unless every check passes. The 8 skipped real-PostgreSQL tests pass in the checks. The job runner processes one job of each queue |
| 5.2 | The generated cross-organiser test passes for 100% of endpoints and live channels on real PostgreSQL with the three database logins. Every organiser table has forced row-level security, proven by a query in the checks. Each organiser's audit chain verifies. Organiser B's scanner refuses organiser A's QR offline. An organiser's data export followed by destroying its key is shown on staging. Faults 1–7 and 21 are fixed, each with a test |
| 5.3 | On staging, with two servers behind the load balancer on the chosen managed PostgreSQL and its connection pooler: killing one server during 40 scans a second causes **zero** double admissions or double collections, checked against the log by a script; a restart during entry is deciding again within 10 s for an event with 1 million scans; an undo takes under 200 ms; every scheduled job reports a last success within twice its schedule |
| 5.4 | With 1 million scans in one event and 200,000 attendees across 300 organisers, on production-sized servers: **60 scans a second on one event plus 150 a second across the platform for 30 minutes**, at p95 under 150 ms and p99 under 400 ms on the server; an **18,000-scan offline backlog** drains in under 5 minutes while live scans stay under 300 ms p95; 25,000 open pass screens plus 60,000 connections across the platform, with a revoke reaching the screen within 5 s at p95 and memory growing less than 5% over 8 hours; a 50,000-pass allowlist is 3 MB or less compressed, a change set 50 KB or less, and a refresh completes within 10 s at p95 on a slow 3G connection; a sign-in link is accepted by the email provider within 30 s at p95 **during** a 50,000-pass bulk send; 20 registrations a second for 15 minutes at p95 under 800 ms; a small event's p95 changes by no more than 10% while the 50,000-person event is at its peak |
| 5.5 | A restore to a point in time completes within 1 hour, losing at most 5 minutes of data. A rehearsal day passes: database failover under load, a gate offline, the email provider down, and a bad deploy rolled back within 10 minutes. The outside security test has no high findings open. An automated accessibility check shows zero serious issues, and a manual screen-reader pass covers the pass, registration and scanner verdict screens |
| 5.6 | Set when the step is planned |
| UI and UX improvement | Set when the phase is planned (§2.3) |
| Each product slice | The product works end to end with the slice switched off and on; its new rules have tests; the cross-organiser test still passes; [01](01-product.md) and [06](06-screens.md) describe it, and §1 records it |
| 6 | Forecast warnings arrive at least 15 minutes before a simulated saturation; no model output can change a scan verdict |

### 3.1 The load to plan for

The gates above are measured against these figures. They assume: one wristband tap or QR read takes
about 2–4 s per lane, and a security search caps a lane at about 0.2–0.3 scans a second; attendees
keep the pass screen open in the queue; scanners refresh the allowlist every 5 minutes. Figures are
estimates from the scale study, not measurements.

| Load | Wedding (500) | Conference (5,000) | Festival (50,000 a day) | Busy Saturday on the platform (about 300 organisers, 50–100 live events) |
| --- | --- | --- | --- | --- |
| Registrations | Replies over weeks, under 0.1 a second | About 3 a second in the first 10 minutes (about 30 requests a second) | An import of 50,000, or 10,000 self-registrations in 15 minutes (about 11 a second, over 100 requests a second) | 20–30 a second at peaks |
| Emails (passes and sign-in links) | About 700 | About 12,000, peaking at 5 a second | 50,000–100,000 in a few hours, with sign-in links needed at the gate at the same time | About 200,000 a day, bursts of 50,000 an hour |
| Open pass screens / code fetches | 300 / 0.3 a second | 3,000 / 3–4 a second | 15,000–25,000 / 15–30 a second | 40,000–80,000 / about 80 a second |
| Gate scans | Peak about 1 a second | 3–5 a second at the doors; 3–4 a second at session changes | About 7 a second over the busiest 30 minutes, bursts of 20–25. **Sync storm:** 60 scanners × 300 queued = 18,000 scans in 1–2 minutes, about 300 a second | 100–200 a second sustained, about 500 in bursts |
| Live connections (attendees; operators; scanners) | 300; 3; 3 | 3,000; 10–15; 50 | 15,000–25,000; 20–40; 60–100 | 40,000–80,000 |
| Public occupancy refreshes | — | About 200 a second if 2,000 event pages are open | About 1,000 a second if 10,000 are open | Grows with events |
| Allowlist downloads | Kilobytes | About 3–4 MB × 50 scanners every 5 minutes | **30–40 MB × 60–100 scanners every 5 minutes (6–8 MB a second)** before 5.4 | — |
| Reports and exports | Trivial | A workbook of 5,000 rows | A workbook of 50,000 rows; about 260,000 gate-rate rows over 3 days | Dozens an hour |

---

## 4. Risks

| Risk | Mitigation |
| --- | --- |
| Features built before organisers are separated must be redone | The rule in §2: no new feature before 5.2 passes its gate |
| Data leaks between organisers, as the shared registration answers show | Row-level security forced in the database; the generated cross-organiser test; independent review of anything that filters by organiser (§2.6) |
| A second server admits people wrongly | One lock per event in the database and catch-up from the scan log (5.3); a gate that kills a server under load |
| A festival entrance stalls: history replays, database calls one after another, a 30–40 MB allowlist | 5.3 and 5.4, each with measured gates |
| The legally promised purge never runs | A job runner in production with an alert when any job is overdue (5.3) |
| One organiser's busy event slows the others | Limits per organiser, fair queues, a separate scan path; the noisy-neighbour load test (5.4) |
| One phone holding many passes invites resale, or passes given to strangers | Named passes, identity checks an event can switch on, a separate rotating code per pass, re-issue on handover |
| Relaxing D-11 and D-05 per event: a reusable code is as easy to copy as a basic wristband, and QR at interior gates is slower | Limited to presets, and refused when the event has VIP or Private Invitation tickets (O-35, O-36) |
| Access rules over tiers, ticket types, ages and bookings are easy to misconfigure, so doors wrongly open or shut | A "who can enter this room now" preview; heavy tests of the rule evaluation |
| Children's data and the location exceptions; someone posing as a guardian | Legal review first (O-43, O-44); release only to linked adults; lookups narrow, reasoned and audited |
| A forwarded claim link, or a guest record merged into the wrong account, hands a pass to the wrong person | Links tied to a contact; re-issue on handover; erasing everywhere done only by Synan |
| Emergency mode misused | A typed confirmation, an alert to every operator, and an audit entry |
| Fraud that makes Synan send codes to costly numbers ("SMS pumping") | Limits per number, per address and per number prefix; accepted countries set per event; bot protection on sign-up and sign-in |
| Codes by phone are weaker than email: a stolen SIM, a code on a lock screen, a shared phone | A phone code gives a pass, never operator power; operators keep password and second factor; first name only in text messages; photo ID at the desk for VIP |
| Sender names take weeks and cost money each month; WhatsApp needs Meta's approval | Start registration at once (O-49); email and printed passes meanwhile |
| Emails from Synan land in spam with local providers | Measure inbox placement before launch; SMS as the fallback for sign-in |
| Translation quality and cost; Luganda's letter ŋ makes a text message cost about 2.3 times as much | A paid translator and a native reviewer; wording of text messages checked for cost |
| Law in each country: registration with regulators, rules on sending data abroad, storage inside Rwanda | The items in §5; Rwanda deferred (O-24) |
| Many agents working at once break each other's work or the specification | The working rules in §2.6 |
| Web NFC is Android-only | Desk provisioning is the primary path; in-browser NFC is an accelerator; events without wristbands need only a camera (O-35) |
| Gate staff arrive with iPhones | At wristband events, gate devices are venue-owned Android or fixed readers (D-09); at events without wristbands any phone works |
| A lost scanner is used to forge passes | Scanners hold public keys and scrambled credential references only (D-12), short pass codes included |
| Offline reconciliation disputes | Idempotency keys, clock-offset ordering, conflicts raised as alerts, and an explicit reconciliation report |
| Occupancy drifts because nobody taps out | Implied exits, session-end reset, manual recount (D-10), and an overnight reset at multi-day events |
| Mocks and the real server disagree | A real backend from Phase 1B, endpoints switched over one at a time, and end-to-end tests against the real server |
| Admin density on small laptops | One breakpoint at 1280 collapses the right rail into a tab |
| The attendee redesign exceeds the bundle budget | Route splitting, lazy loading, CSS animation where it is enough; the light pass page for old phones |
| Scope creep into ticketing and payments | Synan never holds attendees' money (O-02); paid orders are imported |
| Edge hardware is unspecified | AI is last; nothing before it depends on it |

---

## 5. Before launch

Things outside the build phases that must exist before Synan runs a real event. None is started.

| Item | Why | Open question |
| --- | --- | --- |
| Hosting, a managed PostgreSQL with a standby and point-in-time recovery, a connection pooler, and a staging copy | Nothing has run on a real database. The concurrency, role-separation and privilege checks in `packages/db/test/real-postgres.test.ts` need one, and so do gates 5.3–5.5 | O-24 |
| Backups and a restore drill | Point-in-time recovery for 14–35 days; at most 5 minutes of data lost and 1 hour to restore; a drill every quarter and before the first large event; a weekly copy to a second region (a legal check if it is outside Africa) | O-24 |
| Encryption keys and the three database logins in a key vault, never in a settings file | The server refuses to start in production without them; the planned key vault and rotation replace environment settings (fault 21) | |
| A transactional email provider with a verified sending domain, and separate streams for urgent and bulk mail | Passes, sign-in links and invitations are only logged today | O-13 |
| SMS and WhatsApp senders | A sender name registered separately with MTN and Airtel takes about 2 weeks, needs a letter on company letterhead and sample messages, and costs about UGX 250,000 a month per name; WhatsApp needs Meta business verification, a display name, and approval of each message template in each language | O-48, O-49 |
| An outside security test (penetration test) | Scope: separation between organisers, sign-in, the scanner's offline cryptography, the allowlist, live connections. About USD 8,000–20,000 | O-55 |
| Venue-owned Android gate devices, or fixed readers, for events that use wristbands | A web app can read wristbands only in Chrome on Android (D-09) | O-14 |
| Wristband stock and the chip profile for VIP and Private Invitation bands | For events that use wristbands | O-03 |
| Trademark search for the name and the mark; purchase of the domains | Only web searches and domain lookups have been done (D-18, D-20) | |
| A data-processing agreement for organisers, a list of the services that handle data on Synan's behalf (cloud, email, SMS, Cloudflare), and a statement of where data is stored | Synan handles event data for organisers | O-29 |
| Registration with data-protection regulators | Uganda: the Personal Data Protection Office, renewed yearly. Kenya: the Data Commissioner, above set thresholds. Tanzania: every controller and processor, valid 5 years. Organisers are prompted to register too | O-29 |
| A privacy notice for each channel and language; terms between Synan and organisers, separate from a template for each event's terms; records of processing; a named privacy contact | The system processes personal and presence data | O-29 |
| A breach runbook | Uganda expects notice immediately; Kenya and the GDPR within 72 hours | |
| Privacy policy, terms, consent wording and children's data handling, reviewed by a lawyer | The system processes personal and presence data, including children's | O-06, O-08, O-11, O-43, O-44 |
| The retention grace period confirmed | The purge is irreversible | O-06 |
| A decision on event photographs | Screens are built for both cases | O-20 |
| Apple and Google Wallet passes | Specified in [06 A4](06-screens.md), not built; needs developer accounts and certificates, per organiser, so after 5.2 | |
| A status page, an on-call rota, and an event-day support line by phone and WhatsApp | Organisers need help on the day | O-55 |
| An accessibility review against WCAG 2.2 AA, and the load tests of [02 §9](02-architecture.md) | Gates 5.4 and 5.5 | |
| The running budget approved | About USD 1,500 a month for production and staging | O-55 |
