# Synan Documentation — Index, Rules, Decisions

This folder is the specification. Seven documents, one topic each. Start here.

Synan was called Connexia until 2026-11-23 (D-18). The archived source PDFs still carry the old
name; the project folder and the GitHub repository were renamed to `synan` on 2026-11-25 (O-56).

---

## 1. The documents

| File | Topic | Read it when you need |
| --- | --- | --- |
| [01-product.md](01-product.md) | What Synan is and how it behaves | scope, the end-to-end flow, surfaces, gate devices, roles, attendee tiers, credentials, contacts, sign-in and pass delivery, the scan decision and occupancy rules, offline behaviour, event lifecycle, reporting, parties and dependants, event profiles and presets, ticket types and capacity, extras collected by a tap, many organisers, languages, event messages, emergencies and other on-the-day exceptions |
| [02-architecture.md](02-architecture.md) | How it is built | the full stack, repo layout, data model, REST and WebSocket contracts, mock strategy, performance targets |
| [03-security-privacy.md](03-security-privacy.md) | How it is protected | threat model, credential cryptography, authentication, privacy, retention and purge, audit, response matrix |
| [04-edge-ai.md](04-edge-ai.md) | Local intelligence | models, the four intelligence modules, guardrails, where AI appears in the UI |
| [05-design-system.md](05-design-system.md) | How it looks and moves | principles, colour, type, form, motion, identity, components, reference library |
| [06-screens.md](06-screens.md) | Every route and screen | Attendee Portal, Admin Command, Gate Scanner |
| [07-roadmap.md](07-roadmap.md) | Build order and live status | what is built today, the way forward (engineering phases, product slices, how we build), acceptance gates and load figures, risks, what must exist before launch |

One reference file sits beside them:

| File | What it is |
| --- | --- |
| [design_base.md](design_base.md) | The owner's collection of design resources: inspiration galleries, component libraries, design prompts and systems, skills, tools, icons, fonts. A link list, not specification. What may be imported from it is governed by [05 §10](05-design-system.md). It keeps its original name by the owner's choice. |

`archive/` holds the original source material. It is read-only and **not** the specification:

| File | What it was |
| --- | --- |
| `archive/technical-blueprint.pdf` | Original architecture blueprint (5 pages; pages 4–5 duplicate §4.2–§6) |
| `archive/ai-data-privacy-blueprint.pdf` | Edge AI and data privacy addendum (3 pages) |
| `archive/multi-tier-access-security-v2.1.pdf` | Multi-tier access and breach mitigation spec, v2.1 (4 pages) |
| `archive/inspiration-clip.mp4` | Recording of a sample site whose interface is the primary visual reference for the Attendee Portal |
| `archive/synan.mp4`, `archive/synan1.mp4`, `archive/synan2.mp4` | Three reference recordings supplied by the owner on 2026-11-24 for the planned UI and UX improvement phase (O-27) |

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
| D-05 | 2026-11-23 | QR payload: stable, or rotating? | **Rotating in the portal.** The emailed copy is single-use. Where a QR is accepted is D-11; how it is verified is D-12. Since D-33, the same applies to a copy sent by SMS or WhatsApp. | [01 §5.1](01-product.md), [03 §2](03-security-privacy.md) |
| D-06 | 2026-11-23 | Anti-passback: amber notice, or suspend the credential? | **Amber** for a repeat entry at the same perimeter. **Suspend for review** only on impossible travel. | [01 §7](01-product.md), [03 §8](03-security-privacy.md) |
| D-07 | 2026-11-23 | Scanner: phone PWA, or attested devices behind an edge gateway? | **PWA for version 1.** Mutual TLS device certificates and the venue edge gateway arrive in the hardening phase. | [03 §4](03-security-privacy.md), [07 §2](07-roadmap.md) |
| D-08 | 2026-11-23 | Edge AI: build now, or later? | **Last.** AI is integrated only after the full system is built and hardened. Deterministic rules do the work until then; the model is advisory when it arrives. | [04](04-edge-ai.md), [07 §2](07-roadmap.md) |
| D-09 | 2026-11-23 | What devices staff a gate, given iPhones cannot read wristbands from a web app? | **Venue-owned Android devices, fixed readers, or an external NFC reader.** Personal phones are not gate devices. **Amended by D-32:** this applies at events that use wristbands. At an event without them, any phone may scan. | [01 §2](01-product.md), [06 §3](06-screens.md) |
| D-10 | 2026-11-23 | How is occupancy kept true when people do not tap out? | **Implied exit** on entering another room, **session-end reset**, and an audited **manual recount**. | [01 §7](01-product.md) |
| D-11 | 2026-11-23 | Where is a QR code accepted? | **Perimeter gates and desks only**, for arrival and wristband pickup. Interior gates are wristband-only. **Amended by D-32:** this is the default carrier policy, and it applies at events that use wristbands. An event without them accepts QR codes at every gate. | [01 §5.1, §12.3](01-product.md), [06 §3](06-screens.md) |
| D-12 | 2026-11-23 | How is the rotating QR verified without putting secrets on scanners? | **Server-signed short-lived codes.** Scanners hold public keys only. | [03 §2](03-security-privacy.md) |
| D-13 | 2026-11-23 | What happens when offline gates each accept something only one should have? | **Accepted at the gate, caught at sync, raised as an alert.** Never silently discarded. | [01 §8](01-product.md), [03 §8.2](03-security-privacy.md) |
| D-14 | 2026-11-23 | How are offline scans ordered when device clocks are wrong? | **Each scan carries the device's measured clock offset**; the server orders by corrected time. | [01 §8](01-product.md), [02 §4.4](02-architecture.md) |
| D-15 | 2026-11-23 | Build every app on mocks before any backend? | **No. A thin real backend follows the Attendee Portal** (Phase 1B); endpoints then switch over one at a time. | [07 §2](07-roadmap.md) |
| D-16 | 2026-11-23 | What will the AI learn from, if raw scans are purged? | **Per-gate, per-minute scan rates, recorded from the first real scan** and kept indefinitely. | [02 §4.5](02-architecture.md), [04](04-edge-ai.md) |
| D-17 | 2026-11-23 | Which supporting tools fill the gaps in the stack? | TanStack Query, `ws`, `jose`, Drizzle, pg-boss, PostgreSQL `LISTEN`/`NOTIFY`, `vite-plugin-pwa` with IndexedDB, Vitest and Playwright. **No Redis or message broker in version 1.** | [02 §2](02-architecture.md) |
| D-18 | 2026-11-23 | What is the product called? | **Synan**, from the Greek *synántisi*, a meeting or gathering. It replaces the working name Connexia everywhere, including the package scope (`@synan/*`). Kairos was rejected: it is already an identity and access company. A formal trademark search and domain purchase are still to be done. | Everywhere |
| D-19 | 2026-11-23 | What should the brand feel like, and how is the Attendee Portal structured? | **Hospitable and modern, not security-flavoured.** A full rebrand: logo, colour, and type are all replaced, chosen by the owner from a brand board of options. The Attendee Portal follows **Direction A**, the structure of the owner's sample site, without copying that site's identity. Once an option is chosen, the other options' mock-up files are deleted. | [05 §2.1, §6](05-design-system.md), [06 §1](06-screens.md) |
| D-20 | 2026-11-23 | Which identity? | **Option 1, "Meeting point" system with the "Fit" logo.** Neutral near-black ground, Daybreak blue `#8AB4FF` accent; Bricolage Grotesque, Instrument Sans, Geist Mono; the Fit mark with the "[S]ynan" lockup, where the mark replaces the S. No design rule was changed. All other options and logo candidates were deleted. | [05 §3, §4, §6](05-design-system.md) |
| D-21 | 2026-11-23 | How is an event's data retrieved afterwards? | **A post-event summary screen, and an Excel workbook download.** Every closed event has a one-page summary of how it went. The primary export is a real `.xlsx` workbook: a summary sheet, one sheet per report, and an attendee sheet. CSV and a PDF summary remain. Both are built from data that survives the purge. | [01 §10](01-product.md), [06 D13c](06-screens.md) |
| D-22 | 2026-11-23 | Should the website have ambient motion, and what needs work in the interface? | **Little animation overall; motion is spent on rewarding interaction.** Pressing something that matters is acknowledged instantly, and key moments (completing registration, the pass becoming ready, binding a wristband, acknowledging an alert, an admitted scan) get a short, crafted confirmation. A single minimal ambient background on the Attendee Portal is allowed as an exception to the no-decorative-motion rule. The visual style is approved as it stands; the work now is user-friendliness, app flow, and how content balances on screen. The Command Center is to be calmer and cleaner. | [05 §5](05-design-system.md) |
| D-23 | 2026-11-24 | Which kinds of account does the operator side have? | **Seven roles, each seeing only what its job needs.** Two are added: **Supervisor** (runs the live event: Command Center, alerts, gates, passes under review) and **Desk clerk** (the registration desk: find an attendee, bind and replace wristbands). Security Staff stay scanner-only. The server enforces every role on every request; the console shows each role only its own screens. A read-only Viewer role was considered and left until someone needs it. | [01 §3](01-product.md) |
| D-24 | 2026-11-24 | Is the product dark only? | **No: a light theme is added to all three apps.** Each device can choose System (the default, following the device), Light, or Dark. The dark theme stays as it is. The light theme is the same brand: the same type and logo, an off-white ground with near-black ink, and a deeper companion of the Daybreak blue where the original lacks contrast. The pass QR code is black on white in both. | [05 §3](05-design-system.md) |
| D-25 | 2026-11-24 | Which events is Synan for? | **Any kind of event.** A conference, a wedding, a festival, a trade show, a class, a community gathering. The product must be flexible: an organiser sets an event up to suit its kind, and people can come as a family, a couple, or a group, not only one person at a time. The detailed design is written into [01 §11–§18](01-product.md) as a proposal; its points are decided in D-27 to D-36 or still open among the questions from O-28 onwards, and what is built is recorded only in [07 §1](07-roadmap.md). | [01 §1, §11–§14, §16–§18](01-product.md), [07 §2](07-roadmap.md) |
| D-26 | 2026-11-24 | One organiser, or many? | **Many organisers.** Synan is a service that many organisers sign up to, each with their own events, venues, staff, and attendee data kept apart from every other organiser. The system as built assumes a single organisation; separating organisers is foundation work and comes before new features. | [01 §3, §15](01-product.md), [02](02-architecture.md), [07 §2](07-roadmap.md) |
| D-27 | 2026-11-24 | Does a person have one account across organisers, or one with each? (O-28) | **One sign-in and one wallet per person.** A person signs in once and sees their passes from every organiser together. Underneath, each organiser's data about that person is stored and governed separately, joined by a hidden directory that no organiser can read. An organiser never sees another organiser's data, and a person can still erase themselves everywhere at once. | [01 §15.2](01-product.md), [07 §2.2](07-roadmap.md) |
| D-28 | 2026-11-24 | Who answers for attendees' data in law? (O-29) | **The organiser answers for event data; Synan answers for accounts.** For registrations, answers and scans, the organiser is the controller and Synan the processor, under a written data-processing agreement with every organiser. For a person's sign-in account and for operator accounts, Synan is the controller. To be confirmed by a lawyer before launch. | [01 §15.7](01-product.md), [07 §5](07-roadmap.md) |
| D-29 | 2026-11-24 | Where is Synan hosted? (O-24) | **Azure South Africa North (Johannesburg)**, with managed PostgreSQL (a standby and point-in-time recovery), container hosting, a key vault and file storage, and Cloudflare in front. The network delay from MTN and Airtel Uganda and from Safaricom is measured first; if it is bad, AWS Cape Town is the fallback. Events in Rwanda wait until storage outside Rwanda is allowed, or until there is hosting inside Rwanda. | [07 §2.2, §5](07-roadmap.md) |
| D-30 | 2026-11-24 | What does declining presence consent change? (O-43) | **A person who declines is still counted, for safety, but left out of movement analysis** (time spent in zones, and movement between them). Declining never blocks entry and is never a condition of getting a wristband. Subject to legal review before launch. | [01 §7](01-product.md), [07 §2.2, §5](07-roadmap.md) |
| D-31 | 2026-11-24 | How does a new organiser join? (O-30) | **Organisers sign up themselves, on a trial:** one live event of up to 300 attendees, not publicly listed, with a daily message cap. The first admin must use a second sign-in factor. Synan checks that the business is real before the organiser goes bigger, and two admins with a second factor are needed before the first larger live event. | [01 §15.5](01-product.md), [07 §2.2](07-roadmap.md) |
| D-32 | 2026-11-24 | Must every event use wristbands? (O-35) | **No: wristbands are optional per event.** An event chooses one of three carrier policies: wristbands inside (the default, D-11), QR codes at every gate, or wristbands everywhere, fixed once the event is live. An event without wristbands uses QR codes throughout, scanned by any phone, a staff member's own included. This amends D-09 and D-11: both apply where an event uses wristbands. | [01 §2, §5.1, §12.3](01-product.md), [03 §2, §4](03-security-privacy.md), [06 §3](06-screens.md) |
| D-33 | 2026-11-24 | Can people use a phone number instead of email, and are SMS and WhatsApp used? (O-48) | **Yes.** A person can register and sign in with an email address or a mobile number; either is enough. Sign-in is by an email link or a six-digit code by SMS or WhatsApp. SMS and WhatsApp carry sign-in codes, passes, reminders and emergency messages. Push notifications are still not planned. | [01 §1, §5.4, §17, §18.1](01-product.md), [03 §3](03-security-privacy.md) |
| D-34 | 2026-11-24 | Which messaging services, and under what sender name? (O-49) | **A local SMS provider with direct MTN and Airtel routes, and Meta's own WhatsApp service.** Twilio only as a fallback outside East Africa. One shared sender name, "SYNAN", with every message opening with the event name. Registration of the sender name with each mobile network, and Meta's business approval, start now: they take weeks. | [01 §5.4](01-product.md), [02 §2](02-architecture.md), [07 §5](07-roadmap.md) |
| D-35 | 2026-11-24 | Which email provider? (O-13) | **Resend.** It honours a duplicate-protection key for 24 hours, which the outbox relies on. Urgent mail (sign-in links) and bulk mail (passes) go in separate streams. | [02 §2](02-architecture.md), [03 §6](03-security-privacy.md), [07 §2.2](07-roadmap.md) |
| D-36 | 2026-11-24 | Does Synan handle payments? (O-02) | **Synan never holds attendees' money.** Paid orders and ticket codes from elsewhere are imported now. Later, a pay link through the organiser's own payment account, with the organiser as the merchant. Synan never takes payments directly. | [01 §1, §13.6](01-product.md), [07 §2.4](07-roadmap.md) |
| D-37 | 2026-11-24 | What does Synan look like after the "too many lines" review? | **Attendee Portal: the calm direction everywhere, with the event page in the richer showcase style. Admin Command: the instrument direction. Square corners throughout.** The owner chose from working mock-ups of three directions. Attendee: one statement per screen, soft surfaces, space and tone instead of ruled lines, a slow living background; the event page alone carries the full-width event picture, the large layered title, the glass card of key facts, and a small live panel. Admin: a floating top bar with live gate status, figures in one instrument strip, a still dot grid under the venue map, no animation at all. Corners stay square, or as near to it as a control allows: the owner asked for little or no rounding. Motion on the Attendee Portal stays subtle (D-22). This replaces the hairline-and-frame rules; the square-corner rule stays. The owner confirmed the combined design from a working mock-up on 2026-11-25; it is now being applied to the real apps. | [05](05-design-system.md) |

---

## 5. Open questions

Tracked here so they are not scattered. None blocks frontend work unless marked.

| # | Question | Working assumption |
| --- | --- | --- |
| O-01 | Multi-tenant from day one? | Settled 2026-11-24 by D-26: **many organisers**, kept apart by the database. It is the second engineering phase and comes before any new feature ([07 §2.2](07-roadmap.md)). How a person's account works across organisers is D-27. |
| O-02 | Payments and ticket sales in scope? | Settled 2026-11-24 by D-36: **Synan never holds attendees' money.** Paid orders and ticket codes are imported; later, a pay link through the organiser's own account; never direct ([01 §13.6](01-product.md)). |
| O-03 | Fixed NFC reader vendor? | Undecided. Scan ingest stays reader-agnostic. |
| O-04 | Does the wristband carry a printed QR as visual fallback? | No. The band carries its NFC identity only. |
| O-05 | Offline fail-open window for a stale allowlist | 15 minutes. Confirm with operations. |
| O-06 | Grace period before the post-event purge | 72 hours, configurable per event. Confirm with legal. |
| O-07 | How long a signed portal QR is valid, and how far ahead the portal fetches codes | Each code valid 60 seconds; the portal holds 15 minutes of codes in advance. Proposed: hold enough codes to cover the doors-open window, 6 to 12 hours, so a pass still works when a guest switches mobile data off in the queue; each code still lasts 60 seconds, and a code used by someone else is caught as `already_inside`. The mechanism is settled (D-12); the numbers need a security review before any real event. |
| O-13 | Transactional email provider | Settled 2026-11-24 by D-35: **Resend**, with separate streams for urgent and bulk mail. Wired in during the production-core step ([07 §2.2](07-roadmap.md)). |
| O-14 | Which Android device model is the standard gate device | Undecided. Needed for events that use wristbands ([01 §12.3](01-product.md)); must be in hand before the first such event. |
| O-08 | Minimum crowd size before a zone aggregate is displayed (k-anonymity) | k = 5, applied to public views only; operators see exact counts. Confirm with legal. |
| O-09 | Schema for staff credentials (speakers, crew, security) | Same credential and carrier model as attendees, held by a staff user instead of a registration. Finalise in Phase 4. |
| O-10 | Kiosk onboarding for the Public tier: own device mode, or a route in the Attendee Portal? | A locked route in the Attendee Portal. Design not started. |
| O-11 | Do breach alerts keep the credential reference after the purge? | Yes, for 12 months, as a security record. Confirm with legal. |
| O-12 | Edge inference hardware per venue | Undecided. Sized in Phase 6. |
| O-15 | Bundle budget for the attendee pass screen. 90 KB cannot be met: React and the router alone are 81 KB | Settled 2026-11-24: **125 KB gzip, counting HTML, styles and code loaded before the pass appears.** The current framework stays; a rebuild on a lighter one was rejected. Measured again on 2026-11-24 by following the build’s own imports: 128.1 KB, about 3 KB over. The measuring method must be agreed before anyone trims or revisits the budget. |
| O-16 | Should a repeat read of a spent emailed QR at the same gate be ignored as a duplicate, rather than shown as `pass_spent`? | No: the specified order stands for now. |
| O-17 | How fixed readers authenticate, since they have no signed-in user | Settled: each device holds a device token and exchanges it at `POST /auth/device-token` for a short-lived access token. |
| O-18 | Should a revoked or suspended credential be refused at an exit gate? | Yes, as built. Confirm with operations: it may be better to let the person leave and raise an alert. |
| O-19 | Should event pages show live occupancy to visitors who are not signed in? | Yes, through a public occupancy read that hides small counts and is polled every few seconds. The live channel stays closed to visitors who are not signed in. |
| O-20 | Will events have photographs, and who supplies them? | Unknown. Screens are built to look intentional with or without an image. |
| O-21 | Does leaving through a perimeter exit remove a person from the room they were last counted in? | Not today. |
| O-22 | Missing endpoints: MFA enrolment, and a scanner heartbeat | Settled: both exist. |
| O-23 | Keep per-person session attendance after the event, for example for attendance certificates? | No. It would reverse part of D-03. Owner to say if wanted. Certificates for the event as a whole do not need it (O-53). |
| O-24 | Where is Synan hosted, and on which managed PostgreSQL? | Settled 2026-11-24 by D-29: **Azure South Africa North (Johannesburg)**, after measuring the network delay from Uganda and Kenya; AWS Cape Town if the measurement is bad ([07 §5](07-roadmap.md)). |
| O-25 | How long should the link in a scheduled-report email last? Anyone holding the link can download the file. | 24 hours, provisional (configurable from 5 minutes to 72 hours). Owner to confirm. |
| O-26 | Admin Command loads about 188 KB at start with the real API, over its 180 KB budget, because the client checks every request and reply against the contracts | Settled 2026-11-24: **the budget is 200 KB and the checks stay.** The console runs on laptops and venue Wi-Fi, and the checks stop bad data reaching a screen. Dropping them (about 40 KB) was rejected. |
| O-27 | The overall look uses too many lines and reads as confusing. Owner, 2026-11-24: "there is too many lines and it is a bit confusing; the idea is good but the system looks confusing." This is a general change across the product, not one screen | Settled 2026-11-24 by D-37. |
| O-28 | **The studies disagree.** Does a person have one Synan account across all organisers, or a separate account with each? The product study: one account, one wallet holding passes from every organiser. The engineering study: accounts per organiser, joined by a hidden platform directory, so each organiser's data stays cleanly its own | Settled 2026-11-24 by D-27: **one sign-in and one wallet per person**, with each organiser's data about them stored and governed separately ([01 §15.2](01-product.md)). |
| O-29 | Who answers for attendees' data in law? | Settled 2026-11-24 by D-28: **the organiser answers for event data, with Synan as processor under a written agreement; Synan answers for accounts** ([01 §15.7](01-product.md)). To be confirmed by a lawyer before launch. |
| O-30 | How does a new organiser join? | Settled 2026-11-24 by D-31: **organisers sign up themselves, on a trial of one live event and 300 attendees**; Synan verifies them before they go bigger ([01 §15.5](01-product.md)). The demo event is part of O-38. |
| O-31 | Can people discover events across organisers? | **Each organiser has its own public page in version 1**, provisional. A shared listing across organisers comes later, opt-in for each event, and only for organisers Synan has verified. Owner to decide. |
| O-32 | Can organisers share a venue? | **No, each organiser has its own venues for now**, provisional. Owner to decide. |
| O-33 | When may Synan's own staff see an organiser's data? | **Never by default**, provisional: only through a time-limited support grant the organiser approves, or in an emergency with a reason and a second Synan administrator; everything copied into the organiser's own audit log ([01 §15.6](01-product.md)). Owner to decide. |
| O-34 | How is Synan priced, and how are an organiser's limits set? | **Set by hand at first**, provisional: a plan table and invoices, no billing system. Test first a free tier (up to about 100 guests, events without wristbands, email and the light pass page) and per-event packs priced by guest count, paid by mobile money, with SMS and WhatsApp included up to a cap. Then subscriptions for organisers with repeat events, and wristband and scanner rental quoted per event. Prices in Uganda shillings. Owner to decide. |
| O-35 | May an event choose how QR codes and wristbands are used, which narrows D-09 and D-11 to "where the event uses wristbands"? And at events with no wristbands, may any phone run the Gate Scanner, a staff member's own included? | Settled 2026-11-24 by D-32: **yes to both.** Wristbands are optional per event; three carrier policies; at events without wristbands any phone may scan. D-09 and D-11 apply where wristbands are used ([01 §12.3](01-product.md)). |
| O-36 | **The studies disagree.** How does a guest with only a sent or printed pass come and go? The reach study: every sent or printed copy stays single-use, and admits again only after an exit scan at the perimeter (or at the desk with ID). The product study: an event may make printed passes reusable at every gate, protected like a standard wristband | **Both, in turn**, provisional: sent and printed copies are single-use and re-admit only after an exit scan; in addition, an event with QR at every gate and no VIP or Private Invitation tickets may make printed passes reusable. That second part is an exception to D-05 ([01 §5.1, §12.3](01-product.md)). Owner to decide. |
| O-37 | May an organiser create or rename tiers, or create staff roles? | **No**, provisional: ticket types carry the names an organiser wants; the seven roles stay, with each checkpoint's job set per event ([01 §12.4](01-product.md)). Owner to decide. |
| O-38 | Should events gain a rehearsal state and a cancelled state? | **Yes to both**, provisional: rehearsal sits between published and live, and its test scans are wiped when the event goes live; cancelled is final and starts the retention clock. Every new account also gets a demo event ([01 §9](01-product.md)). Owner to decide. |
| O-39 | May one scan admit a whole party at a gate? | **No**, provisional: one scan per person at gates; group work happens at the desk. Owner to decide. |
| O-40 | Are unnamed "and guest" passes allowed? | **Per event**, provisional: on by default only for the wedding and gala presets; the manager or the desk names the guest before the event starts. Owner to decide. |
| O-41 | How freely can a pass move between people? | Provisional: a handover link is tied to the recipient's email or mobile number; an open link only for allocations. Transfers until the event starts unless the event sets otherwise; after check-in, operators only ([01 §11.3–§11.4](01-product.md)). Owner to decide. |
| O-42 | May a party manager keep an address book of the people they often book for? | **Yes**, provisional: private to the manager and invisible to organisers until a person on it is booked. Owner to decide. |
| O-43 | What does declining presence consent change? Today the choice is recorded but nothing at the gate reads it | Settled 2026-11-24 by D-30: **a person who declines is still counted for safety but left out of movement analysis; declining never blocks entry** ([01 §7](01-product.md)). Subject to legal review before launch. |
| O-44 | **The studies disagree.** Below what age must a guardian register a person? The product study: 18 by default, and an organiser may lower it to the local age. The reach study: everyone under 18 is registered by a guardian in a party, never alone, and a child gives no presence consent | **18, and organisers cannot lower it**, provisional: a child is always registered by a guardian, who answers and consents for them. A lower age for a country is set by Synan, not the organiser, and only after legal review there ([01 §11.6](01-product.md)). Owner to decide. |
| O-45 | May staff look up where a lost child was last seen? | **Yes, per event**, provisional: supervisor or admin only, with a reason; the zone and time of the last gate only, never a history; only for children linked to a guardian; audited; never available to attendees ([01 §11.6](01-product.md)). Owner to decide. |
| O-46 | In an emergency, may supervisors see the names of people not yet accounted for? | **Yes**, provisional: in emergency mode only, supervisor and above, worked out when asked and never stored, every view audited ([01 §18.1](01-product.md)). Owner to decide. |
| O-47 | Should events ask about access needs? | **Yes, as one optional question**, provisional: explicit separate consent; desk clerk and supervisor see the needs from the fixed list, never the note; organiser and admin see the note; counts only in reports; deleted with movement data ([01 §18.6](01-product.md)). Owner to decide. |
| O-48 | May a person register and sign in with a mobile number and no email, and do SMS and WhatsApp become channels? This takes "Push or SMS notifications" off the not-planned list in part | Settled 2026-11-24 by D-33: **yes.** Email or mobile number; SMS and WhatsApp for sign-in, passes, reminders and emergencies; push notifications still not planned ([01 §5.4](01-product.md)). |
| O-49 | Which messaging providers, and under what sender name? | Settled 2026-11-24 by D-34: **a local SMS provider with direct MTN and Airtel routes, and Meta's WhatsApp service; one shared "SYNAN" sender name; registration starts now** ([07 §5](07-roadmap.md)). A sender name per organiser, as a paid extra, stays a later option. |
| O-50 | Should a pass carry a short code that staff can type? | **Yes**, provisional: ten characters, accepted once per admission at entrances and desks only, held on scanners only in a scrambled one-way form ([01 §5.4](01-product.md)). Owner to decide. |
| O-51 | Printing passes and badges ("Badge printing" is on the not-planned list) | **Printed passes and badges on ordinary paper, and a door list, yes**; badge printers no; provisional. Owner to decide. |
| O-52 | More than one language ("More than one language" is on the not-planned list)? Which first, and who pays for translation? | **Yes**, provisional: English and Swahili first; Luganda for everything attendees see and the scanner, once a paid translator and a native reviewer are in place; French when Rwanda or the DRC opens; Admin Command in English. Synan pays for its own wording; organisers write their own event text. No machine translation (D-08) ([01 §16](01-product.md)). Owner to decide. |
| O-53 | Certificates and surveys (both on the not-planned list)? | Provisional: **certificates for attending the event, yes**, which D-03 already allows; certificates by session, no (O-23 stays "No"). **Surveys: a link to the organiser's own survey in the thank-you message**; no survey builder ([01 §17](01-product.md)). Owner to decide. |
| O-54 | The rules for event messages | Provisional: quiet hours 21:00 to 07:00 in the recipient's time zone, except sign-in codes and urgent safety changes; at most two non-urgent messages a day per event; news and marketing only with agreement given per channel; directions never in a message, only a link to the event page ([01 §17](01-product.md)). Owner to decide. |
| O-55 | Running costs and the services around the platform | Provisional: about USD 1,500 a month for production and a test copy of it (staging) together; USD 8,000–20,000 once for an outside security test (penetration test); Cloudflare at the network edge (decided with hosting, D-29); a paid status page and monitoring service (Better Stack or Grafana Cloud). Figures are estimates to check against the providers' price calculators. Owner to decide. |
| O-56 | The top-level project folder and the GitHub repository are still named `connexia`. Rename them to match Synan (D-18)? | Settled 2026-11-25: **the GitHub repository is `Noah-Prinzy/synan`**, and every copy points there. On the owner's second machine the project now lives in a folder named `Synan` (set up and checked there by Axel, the owner's agent on that machine). On the original laptop the folder is still named `connexia`; it is renamed at a moment when no agents or development servers are running. Folder locations are per machine and are not recorded here. |
| O-57 | Should operators give their second factor when they sign in, or only at the first sensitive action (as built)? | As built, provisional: at the first sensitive action, after which it lasts 15 minutes. Owner to decide. |
| O-58 | D-17 names four tools that are not in use: TanStack Query, vite-plugin-pwa, Playwright, and MSW. The install-on-phone support is hand-written instead. Adopt them, or amend D-17? | Adopt Playwright for end-to-end tests in roadmap step 5.1; amend D-17 for the other three, provisional. Owner to decide. |
| O-59 | Which accessibility standard does Synan target? | WCAG 2.2 level AA in both themes, provisional. Owner to confirm. |

---

## 6. Changelog

| Date | Change |
| --- | --- |
| 2026-11-22 | Gap patches P-01…P-17 drafted and ratified against the Technical Blueprint. Frontend plan v1.0 written. |
| 2026-11-23 | Documentation consolidated into seven topic documents. The three blueprint PDFs, the gap register, the frontend plan, the design bookmarks, and the `packages/ui` planning notes were merged and reconciled under decisions D-01…D-08. Originals moved to `archive/`. |
| 2026-11-23 | Decisions D-09…D-17 adopted after a full review of how the system functions: gate devices, occupancy correction, the QR's narrowed role, signed QR codes, offline conflict handling, clock offsets, an early backend skeleton, gate-rate history for AI, and the supporting stack. The end-to-end flow was added to the product document. |
| 2026-11-23 | `design_base.md` restored as its own file at the owner's request; the bookmark list was moved out of 05 §10.3, which now points to it. |
| 2026-11-23 | Renamed to Synan (D-18) and rebrand direction set (D-19). First build pass recorded: the database package, the contracts package, the backend skeleton, the mock package, and the scanner scaffold exist and are tested; schema rules, build clarifications, and new open questions O-15…O-22 folded into 01, 02, 03, 05, and 06. Status moved to [07 §1](07-roadmap.md). |
| 2026-11-23 | Identity chosen (D-20). Backend security review findings fixed; secrets encrypted and enforced by the database; sign-in state moved into the database. |
| 2026-11-23 | Excel workbook export and the post-event summary screen added (D-21). The "not planned" list recorded in 01 §1 and the launch prerequisites in 07 §5. |
| 2026-11-24 | Planning pass for D-25 (any kind of event) and D-26 (many organisers), from three studies: people who come together, event profiles and entitlements; reaching people beyond email; production readiness and scale. 01 §1 rewritten for any event and many organisers, with the not-planned items under review marked; 01 §5.4 replaced (contacts, sign-in, pass delivery by email, SMS, WhatsApp and print; the Wallet line removed, as wallet passes are a roadmap item); §2, §4–§10 amended where the new design extends them; new 01 §11–§18 (parties and dependants, event profiles and presets, capacity and ticket types, extras, organisers, languages, event messages, on-the-day exceptions). 07 §2 onward rewritten as the way forward: engineering phases with measurable gates, the faults found in today's code, product slices, how we build, load figures, risks and launch prerequisites. Open questions O-28…O-56 added; O-01 settled by D-26; O-02, O-07, O-13, O-14, O-19, O-23, O-24 and O-27 updated. The owner's three reference recordings added to `archive/`. No decision was added. |
| 2026-11-24 | The owner accepted the recommended answers to ten open questions: decisions D-27…D-36 (one sign-in and wallet per person, data roles, hosting, presence consent, organiser sign-up, optional wristbands, phone numbers with SMS and WhatsApp, messaging providers, Resend, no attendee money). O-02, O-13, O-24, O-28, O-29, O-30, O-35, O-43, O-48 and O-49 marked settled; D-05, D-09 and D-11 amended to match; O-56 updated (folder and repository to be renamed). 01 and 07 §2 onward now cite the decisions; SMS taken off the not-planned list; 07 §5 gains two actions to start now and the two legal reviews. Matching sentences changed in 02 §2 and §4.1, 03 §2–§6, and 06 §1 (A4) and §3. |
| 2026-11-25 | O-56 settled: the GitHub repository and the project folder renamed to `synan`; the remote address updated. — Axel |
