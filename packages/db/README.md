# @synan/db

PostgreSQL schema (Drizzle), SQL migrations, seed, and helpers. The data model is specified in
[docs/02-architecture.md §4](../../docs/02-architecture.md); retention, vault and audit in
[docs/03-security-privacy.md §5–§7](../../docs/03-security-privacy.md). This README only says how to use the package.

## Use

```ts
import { createDatabases, createCipher, EnvKeyProvider, readAttendee, roomOccupancy, schema } from "@synan/db";
import { eq } from "drizzle-orm";

// One pool per database role (see "Roles"). Without vaultUrl/scanUrl, vault and scan reuse db.
const dbs = createDatabases({
  url: process.env.DATABASE_URL!,              // login in app_api
  vaultUrl: process.env.DATABASE_VAULT_URL,    // login in app_vault
  scanUrl: process.env.DATABASE_SCAN_URL,      // login in app_scan
});
const cipher = await createCipher(EnvKeyProvider.fromEnv());

const live = await dbs.db.select().from(schema.events).where(eq(schema.events.state, "live"));
const rooms = await roomOccupancy(dbs.db, live[0]!.id);
const person = await readAttendee(dbs.vault, cipher, attendeeId);   // decrypted identity
await dbs.end();
```

- Package root — everything (needs `pg`, Node only). `/schema` subpath — table and enum definitions only.
- Row types: `Event`, `NewEvent`, `Scan`, … (`$inferSelect` / `$inferInsert` of each table).
- Property keys are the SQL column names (snake_case, as in the spec).
- `createDb(url)` still returns a single pool for single-role use.

## Encrypted columns

`pii_vault.attendees.email`, `.full_name`, `.profile_jsonb`, `users.mfa_secret_enc` and
`signing_keys.private_key_enc` are written and read only through the helpers in `src/secrets.ts`:
`createAttendee`, `updateAttendeeIdentity`, `readAttendee(s)`, `findAttendeeByEmail`,
`emailBlindIndex`, `setMfaSecret` / `readMfaSecret`, `insertSigningKey` / `readSigningPrivateKey`,
and for operator addresses `insertUser`, `setUserEmail`, `findUserByEmail`, `readUserEmail`.
Enforcement is on (migration 0008): plaintext or malformed values in those columns are refused, and
`createCipher` is strict by default. Operator addresses are enforced too (migration 0009): uniqueness
rests on `users.email_hash`.
Envelopes are `ev1.<kid>.<iv>.<ciphertext>` (AES-256-GCM), bound to their table, column and row.

| Variable | Value |
| --- | --- |
| `DB_DATA_KEYS` | `kid:base64,kid:base64` — 32-byte AES keys, every version still in use |
| `DB_DATA_KEY_ACTIVE` | kid for new encryptions (default: last listed) |
| `DB_BLIND_INDEX_KEYS` | `kid:base64,…` — HMAC keys for the email blind index (a legacy string key may be given as `kid:utf8:<secret>`) |
| `DB_BLIND_INDEX_KEY_ACTIVE` | kid for new index values (default: last listed) |

Generate a key with `generateKeyMaterial()`. The seed and tests use `devKeyProvider()`, which is
refused when `NODE_ENV=production`.

**Rotate the data key:** add the new key to `DB_DATA_KEYS`, make it active, restart, then run
`reencryptSecrets({ db, vault, cipher })` (resumable, safe while live). Remove the old key only
once a run reports zero updates. **Rotate the blind-index key:** add and activate it, run
`reindexEmailBlindIndex({ vault, cipher })`, and keep the old key until outstanding invitations and
sign-in links (which store only the hash) have expired.

## Sign-in state

`src/auth.ts`: `hashToken`, `startSession`, `rotateSession` (detects reuse and revokes the family),
`revokeFamily`, `revokeHolderSessions` (`rotateSession` takes either `expiresAt` or `ttl: { userSeconds, attendeeSeconds }`), `createLink` / `redeemLink` (single use),
`mintWsTicket` / `consumeWsTicket` (single use), `cleanupAuthState` (schedule it, e.g. every 10 minutes).

## Reports, allowlist, access rules, carriers

- **Reports** (`src/reports.ts`): `reportAttendance`, `reportArrivals`, `reportDwell`, `reportFlow`,
  `reportPeakOccupancy`, `reportBreach`, `reportGateThroughput`, or uniformly
  `runReport(db, kind, eventId, { cursor, limit, from, to, section })` → `{ columns, rows, next_cursor }`.
  They read only rollups, registrations and alerts, so they give the same figures after the purge.
  Keep rollups current during an event with `rebuildEventRollups` on a schedule; the purge rebuilds them.
  Live KPIs: `eventSummary`, `dashboardSummary`.
- **Offline allowlist** (`src/allowlist.ts`): `buildAllowlist` (subjects with exact windows + entries) or
  `allowlistEntries(db, eventId, checkpointId)` in the contract's flat shape. The database bumps
  `events.revocation_epoch` itself on revoke, suspend, clear, replace, band lost/retired, tier change,
  cancellation, and any access-rule change.
- **Access rules** (`src/access-rules.ts`): `readAccessRules`, `replaceAccessRules` (version check, snapshot,
  audit), `diffProposedAccessRules`, `diffAccessRuleVersions`, `accessPermits`, `credentialMayEnter`.
- **Carriers** (`src/carriers.ts`): `importBands` / `importCarriers` / `importCarrierIdentifiers`, `bindCarrier`,
  `confirmCarrier`, `rebindCarrier`, `replaceLostBand`, `carrierInventory`, `nfcIdentifierHash`. Credential and
  carrier state machines are enforced by triggers on every update.

## Roles

Migration 0005 creates NOLOGIN group roles; create one LOGIN user per pool and grant it exactly one:

```sql
CREATE ROLE api_login   LOGIN PASSWORD '…' IN ROLE app_api;
CREATE ROLE vault_login LOGIN PASSWORD '…' IN ROLE app_vault;
CREATE ROLE scan_login  LOGIN PASSWORD '…' IN ROLE app_scan;
```

Call `assertRoleSeparation(dbs)` at startup in production. The migrating role owns all objects and
needs `CREATEROLE` and the right to `CREATE EXTENSION btree_gist`; no login used by the application
may be a superuser or have `BYPASSRLS`.

## Commands

Run from the repo root (`pnpm` is invoked through corepack):

| Command | Does |
| --- | --- |
| `corepack pnpm --filter ./packages/db test` | Applies the migrations to an in-process PostgreSQL (PGlite) and runs the test suite |
| `corepack pnpm --filter ./packages/db typecheck` | Type-checks sources and tests |
| `DATABASE_URL=… corepack pnpm --filter ./packages/db db:migrate` | Applies pending migrations |
| `DATABASE_URL=… corepack pnpm --filter ./packages/db db:seed` | Seeds an empty, migrated database (development keys) |
| `corepack pnpm --filter ./packages/db db:generate` | Generates a migration after a schema change in `src/schema` |
| `corepack pnpm --filter ./packages/db db:generate:custom --name=x` | Creates an empty hand-written migration |

Never use `drizzle-kit push`: partitioning, row-level security, roles, triggers and SQL functions
live in hand-written migrations that `push` does not know about.

## Migrations

| File | Kind |
| --- | --- |
| `0000_prelude.sql` | Hand-written: `btree_gist`, `scan_corrected_at()` |
| `0001_schema.sql` | Generated, plus one marked hand edit (`scans … PARTITION BY LIST (event_id)`) |
| `0002_rules.sql` | Hand-written: triggers, exclusion constraint, audit chain, RLS, occupancy, rollups, purge |
| `0003_auth_tables.sql` | Generated: `auth_sessions`, `auth_links`, `ws_tickets`, `venues.city`, `signing_keys.qr_kid` |
| `0004_auth_functions.sql` | Hand-written: rotate, redeem, consume, revoke, cleanup |
| `0005_roles.sql` | Hand-written: `app_api`, `app_scan`, `app_vault`, grants, function hardening |
| `0006_enforcement_prepared.sql` | Hand-written: `enforce_encrypted_secrets()` and `enforce_hash_formats()` |
| `0007_users_email_hash.sql` | Generated: `users.email_hash` (unique) |
| `0008_enforce.sql` | Hand-written: **runs both enforcement functions**; `auth_rotate_session_by_kind`; prepares `enforce_encrypted_user_email()` |
| `0009_enforce_user_email.sql` | Hand-written: **runs `enforce_encrypted_user_email()`** |
| `0010_users_email_hash_required.sql` | Generated: `users.email_hash` NOT NULL, unique on every row; drops `users_email_lower_uq` |
| `0011_reporting_tables.sql` | Generated: `zone_dwell_rollups`, `zone_flow_rollups`, `access_rule_versions`, `gate_rate_rollups.by_result_jsonb` |
| `0012_phase4_core.sql` | Hand-written: rollup rebuild, reports, summaries, allowlist, revocation-epoch triggers, access-rule functions, carrier functions, state machines |

## SQL functions

| Function | TypeScript wrapper |
| --- | --- |
| `room_occupancy(event_id, as_of)` · view `current_room_occupancy` | `roomOccupancy()` |
| `last_counted_room(event_id, ephemeral_id, as_of)` | `lastCountedRoom()` |
| `purge_event_movement_data(event_id, force, actor_id)` | `purgeEventMovementData()` |
| `rebuild_event_rollups(event_id)` | `rebuildEventRollups()` |
| `take_attendance_snapshot(event_id, at)` | `takeAttendanceSnapshot()` |
| `audit_verify()` · `audit_prune()` | `auditVerify()` · `auditPrune()` |
| `pii_vault.erase_attendee(attendee_id, actor_id)` | `eraseAttendee()` (vault connection) |
| `auth_start_session` · `auth_rotate_session` · `auth_revoke_family` · `auth_revoke_holder` | `startSession()` · `rotateSession()` · `revokeFamily()` · `revokeHolderSessions()` |
| `auth_redeem_link` · `ws_consume_ticket` · `auth_cleanup` | `redeemLink()` · `consumeWsTicket()` · `cleanupAuthState()` |
