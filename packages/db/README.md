# @synan/db

PostgreSQL schema (Drizzle), SQL migrations, seed, and helpers. The data model is specified in
[docs/02-architecture.md §4](../../docs/02-architecture.md); retention, vault and audit in
[docs/03-security-privacy.md §5–§7](../../docs/03-security-privacy.md). This README only says how to use the package.

## Use

```ts
import { createDb, schema, withVaultScope, roomOccupancy, purgeEventMovementData } from "@synan/db";
import { eq } from "drizzle-orm";

const db = createDb(process.env.DATABASE_URL!);           // node-postgres Pool + Drizzle
const live = await db.select().from(schema.events).where(eq(schema.events.state, "live"));

// pii_vault tables have forced row-level security: always go through a scope.
const people = await withVaultScope(db, "operator", (tx) => tx.select().from(schema.attendees));

const rooms = await roomOccupancy(db, live[0]!.id);         // derived from scans + adjustments
await db.$client.end();
```

- Package root — everything (needs `pg`, Node only).
- `/schema` subpath — table and enum definitions only.
- Row types: `Event`, `NewEvent`, `Scan`, `NewScan`, … (`$inferSelect` / `$inferInsert` of each table).
- Property keys are the SQL column names (snake_case, as in the spec).

## Commands

Run from the repo root (`pnpm` is invoked through corepack):

| Command | Does |
| --- | --- |
| `corepack pnpm --filter ./packages/db test` | Applies the migrations to an in-process PostgreSQL (PGlite) and runs the test suite |
| `corepack pnpm --filter ./packages/db typecheck` | Type-checks sources and tests |
| `DATABASE_URL=… corepack pnpm --filter ./packages/db db:migrate` | Applies pending migrations |
| `DATABASE_URL=… corepack pnpm --filter ./packages/db db:seed` | Seeds an empty, migrated database with the demo dataset |
| `corepack pnpm --filter ./packages/db db:generate` | Generates a migration after a schema change in `src/schema` |
| `corepack pnpm --filter ./packages/db db:generate:custom --name=x` | Creates an empty hand-written migration |

Never use `drizzle-kit push`: partitioning, row-level security, triggers and SQL functions live in
hand-written migrations that `push` does not know about.

## Migrations

| File | Kind |
| --- | --- |
| `0000_prelude.sql` | Hand-written: `btree_gist`, `scan_corrected_at()` |
| `0001_schema.sql` | Generated from `src/schema`, plus one marked hand edit (`scans … PARTITION BY LIST (event_id)`) |
| `0002_rules.sql` | Hand-written: triggers, exclusion constraint, audit chain, RLS, occupancy, rollups, purge |

The migrating role must be able to `CREATE EXTENSION btree_gist`. The application role must not be
a superuser or have `BYPASSRLS`, or vault row-level security does not apply to it.

## SQL functions

| Function | TypeScript wrapper |
| --- | --- |
| `room_occupancy(event_id, as_of)` · view `current_room_occupancy` | `roomOccupancy()` |
| `last_counted_room(event_id, ephemeral_id, as_of)` | `lastCountedRoom()` |
| `purge_event_movement_data(event_id, force, actor_id)` | `purgeEventMovementData()` |
| `rebuild_event_rollups(event_id)` | `rebuildEventRollups()` |
| `take_attendance_snapshot(event_id, at)` | `takeAttendanceSnapshot()` |
| `audit_verify()` · `audit_prune()` | `auditVerify()` · `auditPrune()` |
| `pii_vault.erase_attendee(attendee_id, actor_id)` | `eraseAttendee()` |
