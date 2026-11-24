# Contributing to Synan

Synan is built by many people and AI agents working at the same time. These rules keep the work
safe to combine. They are the working rules of [docs/07-roadmap.md §2.6](docs/07-roadmap.md#26-how-we-build),
in plain words; that section is the authority if the two ever differ.

## The rules

1. **One branch and one worktree each.** Every person or agent works on their own branch, in their
   own git worktree (`git worktree add ../synan-<task> -b <type>/<task>`). Two agents never share a
   working copy, and nobody edits another's worktree.
2. **Owners for the risky areas.** One agent at a time owns each of: database migrations; sign-in,
   row-level security and cryptography; the contracts package (`packages/contracts`). Say in the
   pull request that you hold the area. A migration claims its number in the pull request; if two
   pull requests claim the same number, the later one renumbers. `.github/CODEOWNERS` names who
   approves changes to these paths.
3. **Small changes.** One concern per pull request. Pull requests go into `main` only, through the
   merge queue, and only when every required check passes. Never push to `main` directly, never
   force-push a shared branch.
4. **Independent review** — by a person, or by an agent that did not write the change — is required
   for: migrations (locks, and whether they can be undone); sign-in, row-level security and
   cryptography; anything that filters by organiser; any change that deletes or weakens tests; and
   the consistency of the documents.
5. **The specification changes in the same pull request.** When behaviour changes, update the
   document that describes it (`docs/01-product.md` to `docs/06-screens.md`) in the same pull
   request. When the status of anything changes, update `docs/07-roadmap.md` §1. Update the one
   existing document on a topic; do not start a second one.
6. **Tests are not removed quietly.** The number of passing tests per suite is recorded in
   `scripts/test-counts.json`, and the checks fail when a suite drops below it. If a drop is
   deliberate, record it with the reason (below); that pull request needs independent review.
7. **Migrations only move forward.** Never edit a migration that has been merged: add a new one.
   The checks compare every merged migration with its recorded checksum.

## Before you push

```sh
corepack pnpm install
corepack pnpm check            # the fast subset of CI, about 3–5 minutes
corepack pnpm check --quick    # without the PGlite suites, about 1 minute, while iterating
```

`check` runs: lockfile in sync, repository hygiene (root allow-list, file sizes, no `.env` files),
Markdown links, applied migrations unchanged, typecheck of all 8 packages, the test suites on the
in-memory backend and on PGlite, the test-count guard, and the migration check on PGlite.

Also run, when your change touches them:

| What changed | Run |
| --- | --- |
| Anything in the three apps | `corepack pnpm build:apps && corepack pnpm budget` (the real-API build: set `VITE_API_URL` first) |
| Dependencies | `corepack pnpm audit:deps` |
| The database schema | `corepack pnpm --filter @synan/db db:generate`, then `corepack pnpm db:migrate:check` |
| A new migration | `corepack pnpm db:migrations:verify --update` to record it, and commit `packages/db/migration-checksums.json` |
| Tests added | `node scripts/test-counts.mjs update --suites <suite>` after running the suite, to raise its baseline |
| Tests removed on purpose | `node scripts/test-counts.mjs update --suites <suite> --reason "why"` |

`pnpm` is used through corepack (`corepack pnpm …`); you do not need it on your PATH.

## The checks on every pull request

The workflow is `.github/workflows/ci.yml`. It runs on every pull request and on pushes to `main`,
`build/**` and `ci/**`:

| Job | What it checks |
| --- | --- |
| Typecheck (8 packages) | `tsc` in every workspace package |
| Tests (contracts, db, api-memory, api-pglite, scanner) | each suite, as defined in `scripts/run-suite.mjs` |
| Real PostgreSQL 17 | migrations on an empty database and as an upgrade of the base, `drizzle-kit generate` shows no difference, the real-server database checks, and the job-runner smoke test |
| Build apps (mock, api) and bundle budgets | the three apps built in both modes; budgets in `scripts/bundle-budgets.json` |
| Dependency audit | fails on a high or critical advisory in a production dependency |
| Secret scan (gitleaks) | every commit; reviewed false positives in `.github/.gitleaksignore` |
| Static analysis (semgrep) | semgrep's open rules; reviewed false positives in `.github/semgrep-accepted.json` |
| Repository hygiene | root allow-list, file sizes, no `.env` files, frozen lockfile, Markdown links, applied migrations unchanged |
| Test counts | no suite passes fewer tests than `scripts/test-counts.json` without a recorded reason |
| All required checks | passes only when every job above passed; this is the check branch protection requires |

When a check is red, open the run from the pull request's **Checks** tab. Each job writes a short
summary (test counts, the bundle table, the audit result) at the top of the run page.

## Commit messages

Say what changed and why, in the imperative, in plain words. Agents end their commit messages with
their `Co-Authored-By` line.
