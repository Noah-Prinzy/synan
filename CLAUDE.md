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

## Where we are and what is next

Last updated: 2026-11-25, afternoon.

**Branches on GitHub**

| Branch | What it is |
| --- | --- |
| `build/synan-foundations` | The main line. Everything is here, including the confirmed design. Start from this branch. |
| `main` | The default branch, far behind. Nothing is pushed to it without the owner saying so. |

**Roadmap step 5.1, "every change is checked automatically": done**

- The checks run on GitHub for every push to `main`, `build/**`, `ci/**`, and `integration/**`, and
  for every pull request: typecheck, seven test suites, the database and API suites on a real
  PostgreSQL 17, builds and size budgets, a dependency audit, a secret scan, a code scan, repository
  hygiene, a test-count guard, and the end-to-end journeys with accessibility checks. All 18 jobs
  were green on the main line on 2026-11-25, including on the final commit of the day.
- To check a branch that does not match those patterns, push it to a `ci/<name>` branch, read the
  run, then delete that branch.
- The faults the end-to-end tests found are fixed and merged after an independent review: staff
  activation, live "under review" on the pass, expired exports, accessible names.
- Left to do:
  1. The owner applies the GitHub setting that makes the checks compulsory (Settings → Rules →
     Rulesets: block force pushes, require a pull request, require the check "All required
     checks"). It needs the repository owner's account.
  2. Make the end-to-end job a required check once it has stayed green over several runs.
  3. Bring `docs/07-roadmap.md` §1 up to date with the real-PostgreSQL results, the checks, and
     the new design.
  4. Small follow-ups from the review: a pending staff account whose invitations were cleaned up
     after 30 days cannot be re-invited (take `invited_at` from the audit log in the backfill, or add
     a way to delete a staff account); remove the unused `userInvites.consume`.
  5. There is no screen in the Admin Command for inviting staff; it can only be done through the
     API. Build it early in the next round.

**Design (decision D-37): applied and merged**

The owner confirmed the design from mock-ups and it is now in the real apps: the calm direction for
the Attendee Portal, the event page in the richer showcase style, the instrument direction for the
Admin Command (a top bar replaces the side rail), square corners, no ruled lines, fields with a 2px
foot edge. The attendee background is "Arrivals", chosen by the owner from a lab of ideas: a
festival crowd drawn from small glyphs that walks across the whole screen (`packages/ui/src/theme/`).
The owner rejected, in turn, a field of dots, thin drifting curves, and a soft gradient: they want a
background that fills the whole screen with visible, gentle life. The admin has no animation and the
Gate Scanner's look is unchanged.

Open on the design: Arrivals is heavier than a plain background (the artist measured roughly 10% of
main-thread time at phone size and 25–30% at desktop size in a test browser; it now runs at 12
frames a second on a computer and 10 on a phone and steps down when painting is slow). Measure it on
a real mid-range phone before launch, and make sure typing, scrolling and the pass screen never
feel slow. `docs/05-design-system.md` and `docs/06-screens.md` describe the design as built.

**Next (roadmap step 5.2, "Many organisers")**

Starts when 5.1 is done. A table-by-table plan was written; its eleven questions for the owner come
first, each with a recommendation: web addresses of the form `/organiser/event`; Synan's own staff
get no standing access to an organiser's data (an organiser-approved 24-hour support grant, and a
two-admin 4-hour emergency access); an organiser who leaves has 30 days to export before their key
is destroyed; deleting a personal account stops sign-in at once and erases within 24 hours.

**Waiting on the owner**

- The eleven many-organisers questions.
- Confirm two small rules: the scanner works offline from an out-of-date pass list for 2 hours past
  the end of a shift, with a warning, then stops; and a 150 KB size ceiling for the scanner app.
- Let the lead agent stop every session on the original laptop for a few minutes, so its project
  folder can be moved to `synan` (steps below, O-56). On the second PC, delete the old, empty
  `D:\Connexia` folder. — Axel
- Two things only the owner can start, because they take weeks: registering the "SYNAN" sender name
  with the mobile networks, and a lawyer's review of who answers for the data (D-28) and what
  declining presence tracking means (D-30).

**Moving the project folder from `connexia` to `synan` (O-56)**

Written by Axel, 2026-11-25. The GitHub repository is already `Noah-Prinzy/synan`, and the second PC
already works from `D:\Synan`. Do this once on each device that still has a `connexia` folder,
then delete this section and mark O-56 settled in `docs/00-index.md`.

1. Stop everything that works inside the folder: every agent and Claude session, dev servers, the
   end-to-end stack, editors, and terminals opened in it. Windows refuses to rename a folder that a
   running program is working in; if it still refuses, a session is still open there.
2. Rename the folder `connexia` to `synan`. If it cannot be freed, copy it instead into a new
   sibling `synan` folder, leaving out every `node_modules` (on Windows:
   `robocopy <old> <new> /E /XD node_modules /XJ`), and delete the old folder at the end.
3. In the new folder: `git remote set-url origin https://github.com/Noah-Prinzy/synan.git`.
4. The agents' working copies beside it (today only `synan-design`; `git worktree list` shows
   them all) are git worktrees that
   point at the main folder by its full path. From the new main folder, run
   `git worktree repair ../synan-design` (one path per working copy), then `git worktree list` to
   check.
5. Run `corepack pnpm install` in the main folder and in each worktree: pnpm's links on Windows
   hold full paths and break when the folder moves. Then `corepack pnpm -r typecheck`.
6. The PostgreSQL 17 server is unaffected: it lives in `~/.synan-tools`, outside the project.
7. Claude keeps its memory per folder path, under `~/.claude/projects/<the path with dashes>`.
   Copy the old folder's `memory` directory to the new path's entry so it carries over.
8. If the folder was copied, delete the old one with `rmdir /s /q <old>` (Windows) once nothing is
   open in it. Do not use Explorer or `Remove-Item`, which can follow pnpm's links.

**On the original laptop only**

These do not exist on a fresh clone: a PostgreSQL 17 server kept outside the repository
(`corepack pnpm pg:start` and `pg:stop`), and extra working copies beside the main folder for
agents, when any are in use (none at the moment). On another device, clone the repository, check out
`build/synan-foundations`, run `corepack pnpm install`, and work from there.
