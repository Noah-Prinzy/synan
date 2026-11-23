# Connexia Documentation — Index, Rules, Decisions

This folder is the specification. Seven documents, one topic each. Start here.

---

## 1. The documents

| File | Topic | Read it when you need |
| --- | --- | --- |
| [01-product.md](01-product.md) | What Connexia is and how it behaves | scope, the end-to-end flow, surfaces, gate devices, roles, attendee tiers, credentials, the scan decision and occupancy rules, offline behaviour, event lifecycle |
| [02-architecture.md](02-architecture.md) | How it is built | the full stack, repo layout, data model, REST and WebSocket contracts, mock strategy, performance targets |
| [03-security-privacy.md](03-security-privacy.md) | How it is protected | threat model, credential cryptography, authentication, privacy, retention and purge, audit, response matrix |
| [04-edge-ai.md](04-edge-ai.md) | Local intelligence | models, the four intelligence modules, guardrails, where AI appears in the UI |
| [05-design-system.md](05-design-system.md) | How it looks and moves | principles, colour, type, form, motion, identity, components, reference library |
| [06-screens.md](06-screens.md) | Every route and screen | Attendee Portal, Admin Command, Gate Scanner |
| [07-roadmap.md](07-roadmap.md) | Build order and live status | phases, acceptance gates, what is built today, risks |

`archive/` holds the original source material. It is read-only and **not** the specification:

| File | What it was |
| --- | --- |
| `archive/technical-blueprint.pdf` | Original architecture blueprint (5 pages; pages 4–5 duplicate §4.2–§6) |
| `archive/ai-data-privacy-blueprint.pdf` | Edge AI and data privacy addendum (3 pages) |
| `archive/multi-tier-access-security-v2.1.pdf` | Multi-tier access and breach mitigation spec, v2.1 (4 pages) |
| `archive/inspiration-clip.mp4` | Visual inspiration clip |

Where an archived file and a numbered document disagree, the numbered document wins.

---

## 2. Rules for this folder

1. **One topic, one document.** Information lives in exactly one place. If two documents need the
   same fact, one states it and the other links to it.
2. **Update, never append a sibling.** New findings are folded into the section they affect. No
   `-v2`, no `-notes`, no per-phase "complete" reports, no status files. Status lives in
   [07-roadmap.md](07-roadmap.md) and nowhere else.
3. **A new file needs a new topic.** Before creating a document, check the table above. If the topic
   fits an existing file, it goes there.
4. **Naming.** `NN-topic.md` — two-digit order, lowercase, hyphenated, no spaces, no version numbers
   or dates in the name. Archived files use the same lowercase-hyphen style.
5. **Decisions are recorded once**, in §4 below. A decision is superseded by editing its row, not by
   adding a second opinion.
6. **Packages do not carry specification.** A package README says how to use the package and links
   here.
7. **Binary formats are archive only.** Anything that must be kept current is Markdown.

---

## 3. Reference tags

Two kinds of tag appear throughout the documents and may be used in code comments where a choice
looks arbitrary.

**`P-nn` — gap patches.** Seventeen gaps found in the original Technical Blueprint, each closed by a
ratified patch (ratified 2026-11-22). The patch text now lives in the section listed.

| ID | Gap closed | Now specified in |
| --- | --- | --- |
| P-01 | Blueprint contradicted itself on the QR credential | [01 §5.1](01-product.md) |
| P-02 | Credential lifecycle undefined | [01 §5.2](01-product.md) |
| P-03 | No venue / zone hierarchy | [01 §6](01-product.md), [02 §4](02-architecture.md) |
| P-04 | No registration or entitlement model | [01 §4](01-product.md), [02 §4](02-architecture.md) |
| P-05 | Checkpoints referenced, never modelled | [01 §6](01-product.md), [02 §4](02-architecture.md) |
| P-06 | Occupancy mathematics unspecified | [01 §7](01-product.md) |
| P-07 | "60 FPS telemetry" confused render rate with data rate | [02 §6](02-architecture.md), [02 §9](02-architecture.md) |
| P-08 | No scanner client in the frontend | [01 §2](01-product.md), [06 §3](06-screens.md) |
| P-09 | No offline or degraded mode | [01 §8](01-product.md) |
| P-10 | NFC wristband provisioning absent | [01 §5.3](01-product.md) |
| P-11 | Email pass delivery unspecified | [01 §5.4](01-product.md) |
| P-12 | Attendee location is personal data, unaddressed | [03 §5](03-security-privacy.md) |
| P-13 | Event lifecycle and timezone undefined | [01 §9](01-product.md) |
| P-14 | Reporting under-specified | [01 §10](01-product.md) |
| P-15 | No staff assignment, shift, or audit trail | [01 §3](01-product.md), [03 §7](03-security-privacy.md) |
| P-16 | WebSocket authentication via query string | [03 §3](03-security-privacy.md) |
| P-17 | No SLOs or acceptance criteria | [02 §9](02-architecture.md) |

**`D-nn` — owner decisions.** See §4.

---

## 4. Decision log

Decisions taken by the project owner to reconcile sources that disagreed. Each row is binding.

| ID | Date | Question | Decision | Where applied |
| --- | --- | --- | --- | --- |
| D-01 | 2026-11-23 | Design direction: strict frontend plan, or the "Option 2" redesign? | **Split by surface.** The Attendee Portal takes the redesigned layouts; Admin Command and Gate Scanner keep the strict instrument rules. The brand colour is never a fill on any surface. | [05 §2](05-design-system.md), [06 §1](06-screens.md) |
| D-02 | 2026-11-23 | Attendee tiers: General / Speaker / Crew, or the security spec's four? | **Four tiers:** VIP, Ordinary, Private Invitation, Public. Speakers and crew are staff roles, not attendee tiers. | [01 §3–§4](01-product.md) |
| D-03 | 2026-11-23 | Retention: 30 days, or wipe at event end? | **Wipe identifiable movement data at event end plus a grace period.** Aggregates are kept; alerts and audit are kept 12 months. | [03 §6](03-security-privacy.md) |
| D-04 | 2026-11-23 | Location data: zone presence, or coordinates? | **Zone presence only.** No coordinates are stored, streamed, or shown. | [03 §5](03-security-privacy.md) |
| D-05 | 2026-11-23 | QR payload: stable, or rotating? | **Rotating in the portal.** The emailed copy is single-use. Where a QR is accepted is D-11; how it is verified is D-12. | [01 §5.1](01-product.md), [03 §2](03-security-privacy.md) |
| D-06 | 2026-11-23 | Anti-passback: amber notice, or suspend the credential? | **Amber** for a repeat entry at the same perimeter. **Suspend for review** only on impossible travel. | [01 §7](01-product.md), [03 §8](03-security-privacy.md) |
| D-07 | 2026-11-23 | Scanner: phone PWA, or attested devices behind an edge gateway? | **PWA for version 1.** Mutual TLS device certificates and the venue edge gateway arrive in the hardening phase. | [03 §4](03-security-privacy.md), [07 §2](07-roadmap.md) |
| D-08 | 2026-11-23 | Edge AI: build now, or later? | **Last.** AI is integrated only after the full system is built and hardened. Deterministic rules do the work until then; the model is advisory when it arrives. | [04](04-edge-ai.md), [07 §2](07-roadmap.md) |
| D-09 | 2026-11-23 | What devices staff a gate, given iPhones cannot read wristbands from a web app? | **Venue-owned Android devices, fixed readers, or an external NFC reader.** Personal phones are not gate devices. | [01 §2](01-product.md), [06 §3](06-screens.md) |
| D-10 | 2026-11-23 | How is occupancy kept true when people do not tap out? | **Implied exit** on entering another room, **session-end reset**, and an audited **manual recount**. | [01 §7](01-product.md) |
| D-11 | 2026-11-23 | Where is a QR code accepted? | **Perimeter gates and desks only**, for arrival and wristband pickup. Interior gates are wristband-only. | [01 §5.1](01-product.md), [06 §3](06-screens.md) |
| D-12 | 2026-11-23 | How is the rotating QR verified without putting secrets on scanners? | **Server-signed short-lived codes.** Scanners hold public keys only. | [03 §2](03-security-privacy.md) |
| D-13 | 2026-11-23 | What happens when offline gates each accept something only one should have? | **Accepted at the gate, caught at sync, raised as an alert.** Never silently discarded. | [01 §8](01-product.md), [03 §8.2](03-security-privacy.md) |
| D-14 | 2026-11-23 | How are offline scans ordered when device clocks are wrong? | **Each scan carries the device's measured clock offset**; the server orders by corrected time. | [01 §8](01-product.md), [02 §4.4](02-architecture.md) |
| D-15 | 2026-11-23 | Build every app on mocks before any backend? | **No. A thin real backend follows the Attendee Portal** (Phase 1B); endpoints then switch over one at a time. | [07 §2](07-roadmap.md) |
| D-16 | 2026-11-23 | What will the AI learn from, if raw scans are purged? | **Per-gate, per-minute scan rates, recorded from the first real scan** and kept indefinitely. | [02 §4.5](02-architecture.md), [04](04-edge-ai.md) |
| D-17 | 2026-11-23 | Which supporting tools fill the gaps in the stack? | TanStack Query, `ws`, `jose`, Drizzle, pg-boss, PostgreSQL `LISTEN`/`NOTIFY`, `vite-plugin-pwa` with IndexedDB, Vitest and Playwright. **No Redis or message broker in version 1.** | [02 §2](02-architecture.md) |

---

## 5. Open questions

Tracked here so they are not scattered. None blocks frontend work unless marked.

| # | Question | Working assumption |
| --- | --- | --- |
| O-01 | Multi-tenant from day one? | Org column present; single organisation in version 1. |
| O-02 | Payments and ticket sales in scope? | Out of scope. VIP is granted by admin approval or paid externally. |
| O-03 | Fixed NFC reader vendor? | Undecided. Scan ingest stays reader-agnostic. |
| O-04 | Does the wristband carry a printed QR as visual fallback? | No. The band carries its NFC identity only. |
| O-05 | Offline fail-open window for a stale allowlist | 15 minutes. Confirm with operations. |
| O-06 | Grace period before the post-event purge | 72 hours, configurable per event. Confirm with legal. |
| O-07 | How long a signed portal QR is valid, and how far ahead the portal fetches codes | Each code valid 60 seconds; the portal holds 15 minutes of codes in advance. The mechanism is settled (D-12); these two numbers need a security review before Phase 3. |
| O-13 | Transactional email provider | Undecided. Chosen in Phase 4. |
| O-14 | Which Android device model is the standard gate device | Undecided. Must be in hand before Phase 3. |
| O-08 | Minimum crowd size before a zone aggregate is displayed (k-anonymity) | k = 5. Confirm with legal. |
| O-09 | Schema for staff credentials (speakers, crew, security) | Same credential and carrier model as attendees, held by a staff user instead of a registration. Finalise in Phase 4. |
| O-10 | Kiosk onboarding for the Public tier: own device mode, or a route in the Attendee Portal? | A locked route in the Attendee Portal. Design not started. |
| O-11 | Do breach alerts keep the credential reference after the purge? | Yes, for 12 months, as a security record. Confirm with legal. |
| O-12 | Edge inference hardware per venue | Undecided. Sized in Phase 6. |

---

## 6. Changelog

| Date | Change |
| --- | --- |
| 2026-11-22 | Gap patches P-01…P-17 drafted and ratified against the Technical Blueprint. Frontend plan v1.0 written. |
| 2026-11-23 | Documentation consolidated into seven topic documents. The three blueprint PDFs, the gap register, the frontend plan, the design bookmarks, and the `packages/ui` planning notes were merged and reconciled under decisions D-01…D-08. Originals moved to `archive/`. |
| 2026-11-23 | Decisions D-09…D-17 adopted after a full review of how the system functions: gate devices, occupancy correction, the QR's narrowed role, signed QR codes, offline conflict handling, clock offsets, an early backend skeleton, gate-rate history for AI, and the supporting stack. The end-to-end flow was added to the product document. |
