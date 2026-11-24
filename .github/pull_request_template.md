## What and why

<!-- One or two sentences: what this change does and why. Link the roadmap step or decision (D-xx, O-xx). -->

## Checklist (docs/07-roadmap.md §2.6)

- [ ] Small and focused: one concern, branched from the current base, from my own branch and worktree.
- [ ] `corepack pnpm check` passes locally.
- [ ] The specification is updated in this same pull request where behaviour changed (`docs/01-product.md` to `docs/06-screens.md`), or nothing in it changed.
- [ ] `docs/07-roadmap.md` §1 is updated if the status of anything changed (built, verified, measured).
- [ ] No test was deleted, skipped or weakened; or the drop is recorded in `scripts/test-counts.json` (`reductions`, with the reason) and called out below.

## Risky areas (independent review required)

Tick every area this change touches. Each one needs review by a person, or by an agent that did not write the change.

- [ ] Database migrations (locks, whether it can be undone, add before remove). Migration number claimed: `____`
- [ ] Sign-in, row-level security or cryptography
- [ ] Anything that filters by organiser
- [ ] The contracts package
- [ ] Tests deleted or weakened, or a test-count baseline lowered
- [ ] Consistency of the documents
- [ ] None of the above

## How it was checked

<!-- Commands run, what was looked at by hand, and what could not be checked (for example, needs a real phone or a real PostgreSQL server). -->
