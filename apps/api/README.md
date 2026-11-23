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
corepack pnpm --filter @synan/api typecheck
```

Configuration: copy `.env.example` to `.env`. Every key is optional in development; keys are generated
at startup when absent. The startup log prints the seeded accounts and the admin TOTP secret.

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
