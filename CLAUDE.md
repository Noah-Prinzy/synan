# Synan: working notes for Claude

Read this first in every session, on any device. It tells you how this project is run and where to
pick up. Keep the last section current: update it whenever work stops for the day.

## What Synan is

An event operations platform: registration, QR and NFC wristband passes, gate scanning online and
offline, live occupancy, alerts, and reports. It is for any kind of event and for many organisers.

| Part | Folder |
| --- | --- |
| Attendee Portal | `apps/attendee` |
| Admin Command console | `apps/admin` |
| Gate Scanner | `apps/scanner` |
| API | `apps/api` |
| Shared definitions, database, sample data, design | `packages/contracts`, `packages/db`, `packages/mock`, `packages/ui` |
| End-to-end tests | `e2e/` |

The specification is in `docs/`. Start with `docs/00-index.md` (the map, the decision log, the open
questions) and `docs/07-roadmap.md` (§1 where we are, §2 the way forward).

## How the owner works

- The owner directs and is not a programmer. Report in plain language: what was done, what was
  checked and how, what was not checked. No jargon without a gloss.
- You are the lead. You brief agents, check their work yourself before reporting it, keep the
  documents, and bring decisions to the owner with a recommendation. They often answer "accept all".
- Use several agents in parallel, all on the Opus model, each with a narrow brief and its own files.
- **Documents law:** one document per topic. Update the existing document; never create a
  near-duplicate. Status (built, verified, not verified) lives only in `docs/07-roadmap.md`.
- **Push everything.** The owner works from more than one device. Commit verified work and push it
  as you go. Work in progress goes on its own branch. Never push to `main`, never force-push, never
  commit secrets.
- Agents may do anything needed to build the product, provided it damages nothing and leaks nothing.
  Stop and ask before anything destructive or anything that sends the owner's details elsewhere.

## Rules of the build

- **No new product feature before roadmap step 5.2 ("Many organisers") passes.** The system was
  built for one organisation; anything added first has to be redone. Fixes, tests, and the approved
  design work may continue.
- One branch and one working copy per agent when agents would touch the same files. Agents commit
  and push their own branch only; the lead merges.
- Risky areas need a second look by someone who did not write the change: database migrations;
  sign-in, row-level security, and cryptography; the contracts package; anything that filters by
  organiser; any change that removes or weakens a test.
- When behaviour changes, the document that describes it changes in the same piece of work.
- Verify before saying something works. Run it, or say plainly that it was not run.

## Practical notes

- The package manager is pnpm. If `pnpm` is not on the PATH, use `corepack pnpm …`.
- Tests: `corepack pnpm --filter @synan/<package> test`. The API also has `test:pg` (an in-process
  stand-in for PostgreSQL) and a real-PostgreSQL mode, `test:realpg`, which needs a server and
  `REAL_PG_ADMIN_URL`. Typecheck everything with `corepack pnpm -r typecheck`.
- Each app runs on sample data by default and on the real API when `VITE_API_URL` is set.
- Dev sites: `corepack pnpm --filter @synan/attendee dev` (port 5173) and
  `corepack pnpm --filter @synan/admin dev` (port 5174, under `/admin/`).
- The repository is private. The automatic checks run on GitHub Actions; without the `gh`
  command-line tool signed in, only the owner can read their results, in the browser.
- Commits end with the line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. If no git
  identity is configured on the device, reuse the author of an earlier commit with
  `-c user.name=… -c user.email=…`.
- Too many heavy agents at once slow a laptop until tests time out. About three test-running agents
  at a time is the limit found so far; tell agents to rerun on a timeout before drawing conclusions.

## Task for an agent that can read GitHub Actions

Added 2026-11-25. Remove this section when the task is done.

The lead agent on the owner's laptop cannot read GitHub Actions results (the repository is private
and that machine has no signed-in GitHub tool). If you can, please do this.

**Goal:** make the CI workflow green on branch `integration/5.1`, then report.

**What is known.** On the run for commit `4a0db19`, the gate job "All required checks" failed
with one cause: `static-analysis failure`. Every other required job passed, including the real
PostgreSQL job. The static analysis job is "Static analysis (semgrep)" in
`.github/workflows/ci.yml`. It runs semgrep, then `scripts/semgrep-report.mjs`, which fails the
job when a finding of severity ERROR, HIGH or CRITICAL is not listed in
`.github/semgrep-accepted.json` (one entry per rule and file, each with a written reason).

**A guess was already pushed** after that run: two test files used `ws://api.test` and were
changed to `wss://api.test` (`apps/admin/test/live-stream.test.ts`,
`apps/attendee/test/stream.test.ts`), because the rule `detect-insecure-websocket` flags insecure
WebSocket addresses. That may or may not have been the cause. Check the newest run first.

**Steps**

1. Open the newest CI run for `integration/5.1`. If "All required checks" is green, skip to 5.
2. Open "Static analysis (semgrep)". Read the findings in the job summary or the report step: each
   has a severity, a rule, a file and a line.
3. For every blocking finding, decide which it is:
   - **A real problem:** fix the code. Do not accept it.
   - **A false positive:** add an entry to `.github/semgrep-accepted.json` with the rule, the file
     path and a plain reason a reviewer can check. Keep entries narrow: one rule, one file.

   Never turn the job off, loosen the rule sets, or change `scripts/semgrep-report.mjs` to pass.
4. Commit on `integration/5.1` with a clear message ending in
   `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`, push, and wait for the new run.
   Repeat until "All required checks" is green. Do not force-push. Do not push to `main` or
   `build/synan-foundations`.
5. Also look at the "End-to-end" job. It is not required yet and may be red; note its result and
   any failing test names, but do not fix them (another engineer is fixing those on
   `fix/e2e-defects`).
6. Report to the owner in plain language: what the findings were, which were real and which were
   false alarms and why, what you changed, and the final state of every job. Add one line under
   "Where we are and what is next" in this file saying the checks are green on `integration/5.1`
   and at which commit, then delete this task section and push.

**Do not** merge `integration/5.1` into anything, delete branches, or change repository settings.
The lead agent does the merge once the checks are green.

## Where we are and what is next

Last updated: 2026-11-25, morning.

**Branches on GitHub**

| Branch | What it is |
| --- | --- |
| `build/synan-foundations` | The main line of work. Everything verified is here. Start from this branch. |
| `integration/5.1` | Being built now: five finished work branches merged into one. Becomes part of the main line when its checks pass. |
| `fix/e2e-defects` | Being built now: fixes for the faults the end-to-end tests found. |
| `design/mockups` | Throwaway design mock-ups, including the "Chosen" design. Never merged; deleted once the design is confirmed and built into the real apps. |
| `main` | The default branch, far behind. Nothing is pushed to it without the owner saying so. |

`ci/foundations`, `tests/frontend-units`, `fix/leftovers`, and `e2e/journeys` are finished work
branches waiting inside `integration/5.1`; they are deleted from GitHub once it is merged.

**In progress (roadmap step 5.1, "every change is checked automatically")**

1. Finish `integration/5.1`: all five branches merged, one set of scripts, every check passing
   locally including on a real PostgreSQL 17. Then the owner reads the GitHub Actions run and says
   green or red.
2. Finish `fix/e2e-defects`, most serious first: invited staff cannot activate their account (the
   emailed link points at a page no app has); a pass put under review at the gate does not update
   live on the attendee's phone; a deleted export still shows a download link; an accessibility rule
   ("label in name") fails on some admin and scanner controls. Merge it into the integration branch.
3. When the checks are green: merge into `build/synan-foundations`, delete the merged work
   branches, give the owner the GitHub setting that makes the checks compulsory (Settings → Rules →
   Rulesets: block force pushes, require a pull request, require the check "All required checks"),
   and bring `docs/07-roadmap.md` §1 up to date.

**Design (decision D-37)**

The owner chose, from working mock-ups: the calm direction for the whole Attendee Portal, except
the event page, which takes the richer showcase style; the instrument direction for the Admin
Command; square corners everywhere; subtle motion on the attendee side and none in the admin. A
"Chosen" mock-up combining these is being checked. The owner must confirm it before anything is
applied to the real apps. Then: update `docs/05-design-system.md`, roll it out screen by screen
(order in roadmap §2.3), delete the mock-ups.

**Next (roadmap step 5.2, "Many organisers")**

Starts when 5.1 is done. A table-by-table plan was written; its eleven questions for the owner come
first, each with a recommendation: web addresses of the form `/organiser/event`; Synan's own staff
get no standing access to an organiser's data (an organiser-approved 24-hour support grant, and a
two-admin 4-hour emergency access); an organiser who leaves has 30 days to export before their key
is destroyed; deleting a personal account stops sign-in at once and erases within 24 hours.

**Waiting on the owner**

- Confirm the "Chosen" design.
- The eleven many-organisers questions.
- Confirm two small rules: the scanner works offline from an out-of-date pass list for 2 hours past
  the end of a shift, with a warning, then stops; and a 150 KB size ceiling for the scanner app.
- Rename the project folder on the original laptop from `connexia` to `synan`, at a moment when
  nothing is running (open question O-56).
- Two things only the owner can start, because they take weeks: registering the "SYNAN" sender name
  with the mobile networks, and a lawyer's review of who answers for the data (D-28) and what
  declining presence tracking means (D-30).

**On the original laptop only**

These do not exist on a fresh clone: a PostgreSQL 17 server kept outside the repository
(`corepack pnpm pg:start` and `pg:stop`), and extra working copies beside the main folder for
agents (`synan-integration`, `synan-defects`). On another device, clone the repository, check out
`build/synan-foundations`, run `corepack pnpm install`, and work from there.
