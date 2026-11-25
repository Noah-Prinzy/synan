# @synan/api

Express REST + `ws` WebSocket server (Phase 1B skeleton). Specification: [docs/02-architecture.md](../../docs/02-architecture.md)
§5–§6 and [docs/03-security-privacy.md](../../docs/03-security-privacy.md). Status lives in
[docs/07-roadmap.md](../../docs/07-roadmap.md).

## Run

```sh
corepack pnpm --filter @synan/api dev        # http://127.0.0.1:5180, in-memory store, dev seed
corepack pnpm --filter @synan/api dev:pg     # same, on in-process PostgreSQL (PGlite) with @synan/db migrations
corepack pnpm --filter @synan/api test       # unit + integration, in-memory store
corepack pnpm --filter @synan/api test:pg    # the same suite on PGlite
corepack pnpm test:realpg                    # (root) the db and API suites on a real PostgreSQL (pg:start first)
corepack pnpm --filter @synan/api worker     # REPO=postgres: works every queue and runs the job schedules (DATABASE_JOBS_URL)
corepack pnpm --filter @synan/api typecheck
```

Configuration: copy `.env.example` to `.env`. Every key is optional in development; keys are generated
at startup when absent. The startup log prints the seeded accounts and the admin TOTP secret.

Storage (`REPO`): `memory` (default; stores nothing at rest and does not encrypt), `pglite`, or
`postgres` (production: three role-separated connections and real data keys are required, or startup
fails). On the SQL backends, attendee identity, MFA secrets and signing private keys are encrypted
with `@synan/db`, and sessions, sign-in links and WebSocket tickets live in the database as hashes.
After adopting encryption on an existing database, or after rotating a key, run:

```sh
corepack pnpm --filter @synan/api secrets:maintain   # re-encrypt and re-index; safe while live
```

## Using it from a client

- Base path `/api/v1`. Every request and response matches `@synan/contracts/rest` (`endpoints.*`);
  errors are `ApiError` with a code from `@synan/contracts/errors`.
- `Authorization: Bearer <access_token>` from `POST /auth/login` (operators/staff) or `POST /auth/verify`
  (attendees, after `POST /auth/email-link`). Refresh with `POST /auth/refresh`; refresh tokens rotate.
- Endpoints in the contract that are not built yet answer `501 NOT_IMPLEMENTED` (after auth and RBAC).
- WebSocket: `POST /auth/ws-ticket`, then `new WebSocket("ws://127.0.0.1:5180/stream/telemetry", ticket.protocols)`,
  then send `{"type":"hello","last_event_id":<optional>}`.

## Layout

`src/brand.ts` is the only place the product name is used at runtime (it derives from
`@synan/contracts/brand`). `src/domain/decision.ts` is the pure scan decision; `src/repo/types.ts` is
the persistence boundary with `memory.ts` and `drizzle.ts` implementations.

## Background jobs

One small interface (`src/lib/jobs.ts`) with two runners: in process (memory and PGlite backends,
tests) and pg-boss (`src/lib/pgboss-jobs.ts`, `REPO=postgres`). Every API process works the queues; the
worker process (`src/worker.ts`, script `worker`, run exactly one) works them too and runs the pg-boss
maintenance instance as the app_jobs login (`DATABASE_JOBS_URL`), which writes and fires the cron
schedules of `JOB_SCHEDULES`. Queue names are `@synan/db`'s `JOB_QUEUES`; handlers are registered in
`src/jobs.ts`. Verified on PostgreSQL 17: `test/realpg/jobs-effects-realpg.test.ts` runs every queue through
pg-boss with its real effect (the purge drops the event's scan partition). Not yet: a record of each job's
last success with an overdue alert, and API processes that only send (roadmap 5.3).

## Report exports

Workbook (`.xlsx`, default), CSV per report, written by the export job to the storage interface
(`src/lib/storage.ts`; local disk under `REPORT_STORAGE_DIR` in development) and served by a signed
link (`/api/v1/report-files/:id`, `REPORT_LINK_TTL_S`, absolute on `API_PUBLIC_ORIGIN`). The
workbook writer (`src/lib/xlsx.ts`) streams rows into the archive with `fflate` and never writes a
formula. The PDF summary is not built yet.

## Endpoints added beyond docs/02 §5

Their schemas are in `packages/contracts/src/rest`: kiosk registration, desk codes, staff invite and
activation, shift handover, gate heartbeat, MFA enrolment, webhooks, devices and the device token,
data-request queue and own export, and the post-event summary.
