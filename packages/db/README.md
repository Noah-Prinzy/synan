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
`signing_keys.private_key_enc` (and, through `src/delivery.ts`, `report_schedules.recipients_enc`,
`email_outbox.to_enc` and `.content_enc`) are written and read only through the helpers in `src/secrets.ts`:
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
`revokeFamily`, `revokeHolderSessions` (`rotateSession` takes either `expiresAt` or `ttl: { userSeconds, attendeeSeconds }`,
and optionally `graceSeconds` with `userAgent`/`ip`: a token presented again within the grace by the same client
while its child is unused is re-issued, `reissued: true`, and the unused child is superseded; 0029), `createLink` / `redeemLink` (single use),
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

## Registration, webhooks, jobs, staff and devices

- **Registration** (`src/registration.ts`): `createInvitation`, `rsvpInvitation` (single use, bound to the invited
  address), `registerAttendee`, `registerPublicAttendee` (kiosk, anonymous), `issueCredential`,
  `changeRegistrationTier`, `setRegistrationState`, `expireInvitations`, and the data-request queue
  (`openDataRequest`, `claimDataRequest`, `finishDataRequest`, `listDataRequests`, `collectAttendeeExport`,
  `processErasureRequest`). All run on the general connection; identity is written write-only.
- **Webhooks** (`src/webhooks.ts`): endpoints with an encrypted secret, `enqueueWebhookEvent`,
  `claimWebhookDeliveries` (leased), `recordWebhookAttempt` (backoff, dead after the last attempt),
  `listWebhookDeliveries`, `signWebhookBody`.
- **Jobs** (`src/jobs.ts`): pg-boss in schema `pgboss`. `runMigrations` installs it as the migrating role and hands
  it to `app_jobs`; `createJobs({ connectionString })` for API processes and workers (login in `app_api`), and one
  `createJobs({ …, mode: "maintenance" })` + `scheduleDefaultJobs` (login in `app_jobs` and `app_api`).
  Queue names are `JOB_QUEUES`; `enqueueInTransaction` enqueues inside a Drizzle transaction. Report exports:
  `requestReport`, `claimReport`, `completeReport`, `failReport`, `listReports`.
- **Operations** (`src/operations.ts`): `staffOnDuty`, `currentAssignments`, `shiftHandoverSummary`, `handOverShift`,
  devices (`registerDevice`, `authenticateDevice`, `rotateDeviceToken`, `rotateDeviceTokenVersioned`,
  `deviceTokenVersion`, `setDeviceState`, `recordHeartbeat`, `gateHealth`), events
  (`duplicateEvent`, `eventReadiness`, `applySessionResets`, `eventsDueForPurge`).

## Short codes, invites, MFA enrolment, search

`src/short-codes.ts`: desk codes for attendee self-binding (`createDeskCode`, `consumeDeskCode`, `bindBandWithDeskCode`;
six characters, keyed hash, 10 minutes, failed attempts limited per attendee), staff activation invites
(`createUserInvite`, `consumeUserInvite`), pending MFA enrolment held encrypted on `users`
(`startMfaEnrolment`, `readPendingMfaSecret`, `confirmMfaEnrolment`, `cancelMfaEnrolment`), and attendee search
(`findAttendeeIdsByEmail` by blind index; `searchAttendeesDecrypted` over a bounded candidate set).
`cleanupAuthState` also removes expired codes and invites.

## Post-event summary and workbook (D-21)

`postEventSummary(db, eventId)` returns the one-page summary (headline figures, attendance by tier, the
on-site curve in 5-minute steps, five busiest rooms and gates, purge facts); `provisional` while the event is
not closed. The purge freezes it into `event_summaries`. `withWorkbookData({ db, vault, cipher }, eventId,
{ includeIdentity }, consume)` hands every workbook sheet (typed columns, rows in chunks) to `consume` inside
one read-only snapshot; `collectWorkbookData` reads it all into memory. Without `includeIdentity` the
attendee sheet has no name or email columns.

## Exports, schedules, email, notifications

- **Export formats**: `event_reports.format` is `xlsx` (whole-event workbook; `kind` null; `include_identity`
  allowed), `pdf` (summary; `kind` null) or `csv` (one report; `kind` required). `requestReport` picks
  `csv` when given a kind, else `xlsx`.
- **Report schedules** (`src/delivery.ts`): `createReportSchedule` (recipients encrypted, bound to the row;
  cadence `on_close`, `daily`, `weekly` or `monthly` with `firstRunAt`), `listReportSchedules`,
  `setReportScheduleState` (pause, resume), `deleteReportSchedule`, `claimDueReportSchedules` (leased,
  `SKIP LOCKED`), `finishReportSchedule` (advances past now; three failures → `failed`).
- **Exported files**: `recordExportedFile` (owner is a report or a data request; retention default 7 days;
  audited when the file holds identity), `exportedFilesDue`, then delete the objects, then
  `markExportedFilesDeleted` (audited per file), `listExportedFiles`.
- **File encryption** (`src/crypto/files.ts`): `encryptFileStream(cipher, { objectKey })` /
  `decryptFileStream` (Node Transform streams), `encryptFileBuffer` / `decryptFileBuffer` for small files.
  Each file gets its own key, wrapped by the active data key and bound to the object key; content is
  AES-256-GCM in 64 KiB chunks. Store the stream's `keyId` in `exported_files.key_id`. Keep a retired data
  key for at least the retention period (7 days) after rotation.
- **Email outbox**: `enqueueEmail` (recipient and content encrypted) → enqueue `JOB_QUEUES.email` with
  `{ outbox_id }` in the same transaction → worker `claimEmail` (null if already sent, in flight, or out of
  attempts) → `finishEmail`. A claim is a lease (`claimed_at`; `EMAIL_CLAIM_LEASE_SECONDS` = 120 s, or
  `leaseSeconds`): a row left `sending` by a crashed worker is claimed again once its lease has run out, and the
  lost try counts as an attempt. Keep the mail provider timeout well below the lease. `emailsDue` lists claimable
  ids (oldest first, stale `sending` included; no address or content) for a sweep.
- **Notifications**: `notifyAttendee`, `broadcastNotification` (an event's confirmed registrations, optionally
  one tier), `listNotifications` (contract shape, with read state), `markNotificationsRead`.
  Erasure deletes an attendee's notifications and read receipts.
- **Cleanup**: `cleanupDelivery` (sent/failed email after 7 days, email abandoned in `sending` for a day marked
  failed first, expired notifications, finished schedules after 30 days) on `JOB_QUEUES.deliveryCleanup`.
- **Retention (D-03)**: `auditPrune` (audit entries older than 12 months; the hash of the last pruned entry is kept
  as the chain anchor, so `auditVerify` still passes) and `alertsPrune({ olderThanMonths, now })` (breach alerts
  older than 12 months, minimum 12, with their finished webhook deliveries; one audit entry per run). Both run
  from a job worker (`app_api`), daily.
- **Venue layouts and drafts** (`src/layout.ts`, 0023–0025): zone and room `geometry_jsonb` is the contracts
  `GridShape` (typed `GridShape`; a CHECK enforces it). Every zone or room write raises `venues.layout_version` and
  stamps `layout_published_at` (trigger); a zone with a new floor label appends it to `venues.floors`.
  `publishVenueLayout` replaces floors, zones (list order → `sort_order`) and rooms in one step if the version is
  current (`ok | version_conflict | foreign_id | blocked`, with what blocks: a room used past draft or with history,
  gates or doors on what would go, doors left in another zone); a draft lets go of a removed room. A draft event may
  lack venue and dates; `deleteDraftEvent` deletes a draft with nothing recorded under it; `duplicateEvent` with
  `startsAt: null` copies without dates, sessions or windowed rules.
- **Gate positions**: `checkpoints.position_jsonb` is the contracts `GridPoint` (`{ x, y, side }`, integers
  0–10 000, side n/e/s/w; a CHECK enforces the shape), typed `CheckpointPosition`; `gateHealth` returns it as
  `position`. The venue grid extent is derived, not stored.
- **Devices**: `token_version` goes up on every token change and whenever a device leaves `active` (a trigger,
  whoever writes). Check it per request with `deviceTokenVersion`; `rotateDeviceTokenVersioned` returns it.

## Testing

`import { createMigratedPglite } from "@synan/db/testing"` gives a PGlite with every migration applied,
loaded from an on-disk snapshot (≈0.3–0.5 s instead of ≈3 s per instance). `test/real-postgres.test.ts`
holds the checks that need a real server; it runs only when `REAL_PG_ADMIN_URL` is set.

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
| `0013_phase4_tables.sql` | Generated: `data_requests`, `webhook_deliveries`, `devices`, report-job columns, room-door zone rule, indexes (one marked hand edit: constraint order) |
| `0015_short_codes.sql` | Generated: `carrier_desk_codes`, `carrier_desk_code_failures`, `user_invites`, `users.mfa_pending_*` |
| `0016_short_code_functions.sql` | Hand-written: desk-code, invite and cleanup functions; pending-MFA encryption check; exact-email id lookup |
| `0017_event_summary_tables.sql` | Generated: `onsite_rollups`, `event_summaries`, `events.rollups_rebuilt_at` |
| `0018_event_summary.sql` | Hand-written: rollup rebuild with the on-site series, the summary, the purge freezing it, workbook queries |
| `0014_phase4_flows.sql` | Hand-written: registration, data requests, webhooks (secret enforced encrypted), report claim, session resets, purge due, staff, devices, gate health, event duplication and readiness, `app_jobs` role and job-schema grants |
| `0019_delivery_tables.sql` | Generated: `report_schedules`, `exported_files`, `email_outbox`, `notifications`, `notification_reads`, `event_reports.format` / `include_identity`, `devices.token_version` |
| `0020_delivery_functions.sql` | Hand-written: schedule claim and finish, exported-file record / due / mark deleted, email claim and finish, notifications for an attendee, delivery cleanup, device token-version trigger, erasure removing notifications |
| `0021_email_lease_checkpoint_position.sql` | Generated: `email_outbox.claimed_at`, `checkpoints.position_jsonb` with the `GridPoint` check |
| `0022_email_lease_retention.sql` | Hand-written: email claim lease and `email_due`, cleanup of abandoned sends, `gate_health` with position, `alerts_prune` |
| `0023_grid_shape_check.sql` | Hand-written: `grid_unit_valid()`, `grid_shape_valid()` (needed by 0024's checks) |
| `0024_layout_drafts.sql` | Generated: `venues.floors` / `capacity_default` / `layout_version` / `layout_published_at`, `zones.sort_order`, GridShape checks on zone and room geometry, `events.venue_id` / `starts_at` / `ends_at` nullable for drafts (`events_scheduled_unless_draft`), `events.wizard_step` / `published_at` / `updated_by` |
| `0025_layout_publish_drafts.sql` | Hand-written: backfill, layout-version trigger on zones and rooms, `venue_layout_publish`, `event_delete_draft`, `event_duplicate` without dates |
| `0026_roles_supervisor_desk_clerk.sql` | Generated: `user_role` gains `supervisor` and `desk_clerk` (D-23); the access-rule role check accepts them |
| `0027_allowlist_live_codes.sql` | Hand-written: `allowlist_credentials` leaves out `assigned` bands and adds `qr_email_hashes` (emailed codes still usable) |
| `0028_scanner_attendee_gaps.sql` | Generated: `scan_voids` (scanner undo correction records), `staff_assignments.scanner_device_hashes` (≤ 8), `devices.allowlist_issued_at`, `occupancy_adjustment_reason` gains `scan_undo`, `pii_vault.pending_registrations` (answers encrypted) |
| `0029_scanner_attendee_functions.sql` | Hand-written: `auth_rotate_session(_by_kind)` with a reuse grace (`p_grace`, `reissued`); `device_heartbeat` records the allowlist held; `gate_health` adds `allowlist_issued_at` / `allowlist_stale`; forced RLS and app_vault grants on `pending_registrations`; `scan_voids` append-only |
| `0030_attendee_phone.sql` | Generated: `pii_vault.attendees.phone` (optional, AES-256-GCM envelope like `email`, `attendees_phone_encrypted`); written and read through `src/secrets.ts`, re-encrypted by `reencryptSecrets` |
| `0031_attendee_phone_erasure.sql` | Hand-written: `erase_attendee` also nulls `phone` and deletes the attendee's `pending_registrations` |

## SQL functions

| Function | TypeScript wrapper |
| --- | --- |
| `room_occupancy(event_id, as_of)` · view `current_room_occupancy` | `roomOccupancy()` |
| `last_counted_room(event_id, ephemeral_id, as_of)` | `lastCountedRoom()` |
| `purge_event_movement_data(event_id, force, actor_id)` | `purgeEventMovementData()` |
| `rebuild_event_rollups(event_id)` | `rebuildEventRollups()` |
| `take_attendance_snapshot(event_id, at)` | `takeAttendanceSnapshot()` |
| `audit_verify()` · `audit_prune()` · `alerts_prune(months, now)` | `auditVerify()` · `auditPrune()` · `alertsPrune()` |
| `email_claim(id, max_attempts, now, lease)` · `email_due(max_attempts, limit, lease, now)` | `claimEmail()` · `emailsDue()` |
| `pii_vault.erase_attendee(attendee_id, actor_id)` | `eraseAttendee()` (vault connection) |
| `auth_start_session` · `auth_rotate_session` · `auth_revoke_family` · `auth_revoke_holder` | `startSession()` · `rotateSession()` · `revokeFamily()` · `revokeHolderSessions()` |
| `auth_redeem_link` · `ws_consume_ticket` · `auth_cleanup` | `redeemLink()` · `consumeWsTicket()` · `cleanupAuthState()` |
