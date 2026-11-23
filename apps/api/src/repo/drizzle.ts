/**
 * Repositories over @synan/db (Drizzle, PostgreSQL). Works with node-postgres or PGlite.
 *
 * - Identity-vault tables (pii_vault.attendees, pii_vault.ephemeral_ids) are only touched inside
 *   withVaultScope(): `system` for sign-in lookups and fixtures, `scan` for the ephemeral mapping.
 * - The audit chain is computed by the database trigger; this layer only inserts.
 * - Attendee email lookup uses the keyed blind index `email_hash` (HMAC-SHA-256, hex).
 * - Refresh sessions and sign-in links have no tables in the schema yet: AuthRepo stays in-process
 *   (see README "Proposed schema additions").
 */
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  access_rules,
  attendees,
  audit_log,
  auditVerify,
  breach_alerts,
  carriers,
  checkpoints,
  credentials,
  ephemeral_ids,
  event_rooms,
  events,
  gate_rate_rollups,
  occupancy_adjustments,
  organizations,
  registrations,
  rooms,
  scans,
  sessions,
  signing_keys,
  staff_assignments,
  transit_times,
  users,
  venues,
  withVaultScope,
  zones,
  type AnyDb,
} from "@synan/db";
import { createMemoryRepos } from "./memory.js";
import type {
  AttendeeRow,
  AuditRow,
  BreachAlertRow,
  CarrierRow,
  CheckpointRow,
  CredentialRow,
  EventRow,
  GateRateRollupRow,
  Repos,
  RoomRow,
  ScanRow,
  UserRow,
} from "./types.js";

type Json = Record<string, unknown>;
const one = <T>(rows: T[]): T | null => rows[0] ?? null;

/** `72 hours`, `3 days 00:00:00`, `72:00:00` → hours. */
export function intervalHours(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  let h = 0;
  const days = /(-?\d+)\s+days?/.exec(s);
  if (days) h += Number(days[1]) * 24;
  const hours = /(-?\d+)\s+hours?/.exec(s);
  if (hours) h += Number(hours[1]);
  const hms = /(-?\d+):(\d+):(\d+)/.exec(s);
  if (hms) h += Number(hms[1]);
  return h;
}

const toUser = (r: typeof users.$inferSelect): UserRow => ({
  id: r.id,
  email: r.email,
  password_hash: r.password_hash ?? "",
  role: r.role,
  mfa_enrolled_at: r.mfa_enrolled_at,
  mfa_secret: r.mfa_secret_enc,
});
const toAttendee = (r: typeof attendees.$inferSelect): AttendeeRow => ({
  id: r.id,
  user_id: r.user_id,
  email: r.email,
  full_name: r.full_name,
  profile_jsonb: (r.profile_jsonb ?? {}) as Json,
});
const toRoom = (r: typeof rooms.$inferSelect): RoomRow => ({
  id: r.id,
  venue_id: r.venue_id,
  zone_id: r.zone_id,
  name: r.name,
  capacity: r.capacity,
  warn_at_pct: r.warn_at_pct,
  block_at_pct: r.block_at_pct,
  continuous_bool: r.continuous_bool,
  capacity_policy: r.capacity_policy,
  geometry_jsonb: (r.geometry_jsonb ?? null) as Json | null,
});
const toCheckpoint = (r: typeof checkpoints.$inferSelect): CheckpointRow => ({
  id: r.id,
  venue_id: r.venue_id,
  zone_id: r.zone_id,
  room_id: r.room_id,
  direction: r.direction,
  perimeter_bool: r.perimeter_bool,
  hardware_id: r.hardware_id,
  label: r.label,
});
const toEvent = (r: typeof events.$inferSelect): EventRow => ({
  id: r.id,
  org_id: r.org_id,
  venue_id: r.venue_id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  starts_at: r.starts_at,
  ends_at: r.ends_at,
  timezone: r.timezone,
  state: r.state,
  listed_bool: r.listed_bool,
  grace_buffer: intervalHours(r.grace_buffer),
});
const toCredential = (r: typeof credentials.$inferSelect): CredentialRow => ({
  id: r.id,
  registration_id: r.registration_id,
  staff_user_id: r.staff_user_id,
  token_hash: r.token_hash,
  state: r.state,
  zone_state: r.zone_state,
  issued_at: r.issued_at,
  revoked_at: r.revoked_at,
});
const toCarrier = (r: typeof carriers.$inferSelect): CarrierRow => ({
  id: r.id,
  credential_id: r.credential_id,
  kind: r.kind,
  identifier: r.identifier,
  chip_profile: r.chip_profile,
  state: r.state,
  bound_at: r.bound_at,
  redeemed_at: r.redeemed_at,
});
const toScan = (r: typeof scans.$inferSelect): ScanRow => ({
  id: r.id,
  event_id: r.event_id,
  checkpoint_id: r.checkpoint_id,
  ephemeral_id: r.ephemeral_id,
  carrier_kind: r.carrier_kind,
  result: r.result,
  occurred_at: r.occurred_at,
  received_at: r.received_at,
  clock_offset_ms: r.clock_offset_ms,
  idem_key: r.idem_key,
  offline_bool: r.offline_bool,
  direction: r.direction ?? "in",
  local_result: r.local_result,
  device_id: r.device_id,
  staff_user_id: r.staff_user_id,
});
const toAlert = (r: typeof breach_alerts.$inferSelect): BreachAlertRow => ({
  id: r.id,
  event_id: r.event_id,
  severity: r.severity,
  kind: r.kind,
  checkpoint_id: r.checkpoint_id,
  room_id: r.room_id,
  credential_id: r.credential_id,
  occurred_at: r.occurred_at,
  state: r.state,
  acked_by: r.acked_by,
  acked_at: r.acked_at,
  resolved_by: r.resolved_by,
  resolved_at: r.resolved_at,
  resolution_note: r.resolution_note,
  scan_ids: r.scan_ids,
  detail: r.detail,
});
const toAudit = (r: typeof audit_log.$inferSelect): AuditRow => ({
  id: String(r.id),
  actor_id: r.actor_id,
  action: r.action,
  target: r.target,
  meta_jsonb: (r.meta_jsonb ?? {}) as Json,
  at: r.at,
  prev_hash: r.prev_hash,
  hash: r.hash,
});

export interface DrizzleReposOptions {
  /** Key for the attendee email blind index. Must be stable across restarts. */
  emailIndexKey: string;
  close?: () => Promise<void>;
}

export function createDrizzleRepos(db: AnyDb, opts: DrizzleReposOptions): Repos {
  const emailHash = (email: string) => createHmac("sha256", opts.emailIndexKey).update(email.trim().toLowerCase()).digest("hex");
  // No tables for refresh sessions / sign-in links yet; keep them in-process.
  const inProcessAuth = createMemoryRepos().auth;

  return {
    kind: "drizzle",
    close: opts.close,

    users: {
      async byEmail(email) {
        return one((await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1)).map(toUser));
      },
      async byId(id) {
        return one((await db.select().from(users).where(eq(users.id, id)).limit(1)).map(toUser));
      },
      async insert(r) {
        await db.insert(users).values({
          id: r.id, email: r.email, password_hash: r.password_hash, role: r.role,
          mfa_enrolled_at: r.mfa_enrolled_at, mfa_secret_enc: r.mfa_secret,
        });
      },
      async setMfa(id, secret, at) {
        await db.update(users).set({ mfa_secret_enc: secret, mfa_enrolled_at: at }).where(eq(users.id, id));
      },
    },

    attendees: {
      async byEmail(email) {
        return withVaultScope(db, "system", async (tx) =>
          one((await tx.select().from(attendees).where(eq(attendees.email_hash, emailHash(email))).limit(1)).map(toAttendee)),
        );
      },
      async byId(id) {
        return withVaultScope(db, "system", async (tx) => one((await tx.select().from(attendees).where(eq(attendees.id, id)).limit(1)).map(toAttendee)));
      },
      async insert(r) {
        await withVaultScope(db, "system", async (tx) => {
          await tx.insert(attendees).values({
            id: r.id, user_id: r.user_id, email: r.email, email_hash: r.email ? emailHash(r.email) : null,
            full_name: r.full_name, profile_jsonb: r.profile_jsonb,
          });
        });
      },
    },

    venues: {
      async zonesOfVenue(venueId) {
        return (await db.select().from(zones).where(eq(zones.venue_id, venueId))).map((z) => ({
          id: z.id, venue_id: z.venue_id, name: z.name, floor: z.floor, geometry_jsonb: (z.geometry_jsonb ?? null) as Json | null,
        }));
      },
      async room(id) {
        return one((await db.select().from(rooms).where(eq(rooms.id, id)).limit(1)).map(toRoom));
      },
      async roomsByIds(ids) {
        if (ids.length === 0) return [];
        return (await db.select().from(rooms).where(inArray(rooms.id, [...ids]))).map(toRoom);
      },
      async checkpoint(id) {
        return one((await db.select().from(checkpoints).where(eq(checkpoints.id, id)).limit(1)).map(toCheckpoint));
      },
      async checkpointsOfVenue(venueId) {
        return (await db.select().from(checkpoints).where(eq(checkpoints.venue_id, venueId))).map(toCheckpoint);
      },
      async venue(id) {
        return one(
          (await db.select().from(venues).where(eq(venues.id, id)).limit(1)).map((v) => ({
            id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: null,
          })),
        );
      },
      async transitTimes(venueId) {
        return db.select().from(transit_times).where(eq(transit_times.venue_id, venueId));
      },
    },

    events: {
      async listPublic({ state, q, after, limit }) {
        const conds = [
          eq(events.listed_bool, true),
          state ? eq(events.state, state) : inArray(events.state, ["published", "live"]),
        ];
        if (q) conds.push(ilike(events.title, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
        if (after) {
          conds.push(or(gt(events.starts_at, after.starts_at), and(eq(events.starts_at, after.starts_at), gt(events.id, after.id)))!);
        }
        return (await db.select().from(events).where(and(...conds)).orderBy(asc(events.starts_at), asc(events.id)).limit(limit)).map(toEvent);
      },
      async bySlug(slug) {
        return one((await db.select().from(events).where(eq(events.slug, slug)).limit(1)).map(toEvent));
      },
      async byId(id) {
        return one((await db.select().from(events).where(eq(events.id, id)).limit(1)).map(toEvent));
      },
      async rooms(eventId) {
        return db.select().from(event_rooms).where(eq(event_rooms.event_id, eventId));
      },
      async sessions(eventId) {
        return (await db.select().from(sessions).where(eq(sessions.event_id, eventId)).orderBy(asc(sessions.starts_at))).map((s) => ({
          id: s.id, event_id: s.event_id, room_id: s.room_id, title: s.title, starts_at: s.starts_at, ends_at: s.ends_at,
        }));
      },
      async accessRules(eventId) {
        return db.select().from(access_rules).where(eq(access_rules.event_id, eventId));
      },
    },

    registrations: {
      async byId(id) {
        return one(
          (await db.select().from(registrations).where(eq(registrations.id, id)).limit(1)).map((r) => ({
            id: r.id, event_id: r.event_id, attendee_id: r.attendee_id, tier: r.tier, state: r.state,
            zone_presence_consent_at: r.zone_presence_consent_at, checked_in_at: r.checked_in_at, created_at: r.created_at,
          })),
        );
      },
      async markCheckedIn(id, at) {
        await db.update(registrations).set({ checked_in_at: at }).where(and(eq(registrations.id, id), isNull(registrations.checked_in_at)));
      },
      async forAttendee(attendeeId) {
        return (await db.select().from(registrations).where(eq(registrations.attendee_id, attendeeId))).map((r) => ({
          id: r.id, event_id: r.event_id, attendee_id: r.attendee_id, tier: r.tier, state: r.state,
          zone_presence_consent_at: r.zone_presence_consent_at, checked_in_at: r.checked_in_at, created_at: r.created_at,
        }));
      },
    },

    staff: {
      async assignmentsFor(userId) {
        return (await db.select().from(staff_assignments).where(eq(staff_assignments.user_id, userId))).map((a) => ({
          id: a.id, user_id: a.user_id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start, shift_end: a.shift_end,
        }));
      },
    },

    credentials: {
      async byId(id) {
        return one((await db.select().from(credentials).where(eq(credentials.id, id)).limit(1)).map(toCredential));
      },
      async byTokenHash(hash) {
        return one((await db.select().from(credentials).where(eq(credentials.token_hash, hash)).limit(1)).map(toCredential));
      },
      async forRegistration(registrationId) {
        return one(
          (
            await db.select().from(credentials)
              .where(and(eq(credentials.registration_id, registrationId), ne(credentials.state, "replaced")))
              .orderBy(desc(credentials.issued_at)).limit(1)
          ).map(toCredential),
        );
      },
      async insert(r) {
        await db.insert(credentials).values(r);
      },
      async update(id, patch) {
        const rows = await db.update(credentials).set(patch).where(eq(credentials.id, id)).returning();
        if (!rows[0]) throw new Error(`credential ${id} not found`);
        return toCredential(rows[0]);
      },
    },

    carriers: {
      async byIdentifier(kind, identifier) {
        // Newest first, retired included: a retired emailed code must still resolve (it reads as spent).
        return one(
          (
            await db.select().from(carriers)
              .where(and(eq(carriers.kind, kind), eq(carriers.identifier, identifier)))
              .orderBy(sql`${carriers.state} = 'retired'`, desc(carriers.created_at)).limit(1)
          ).map(toCarrier),
        );
      },
      async forCredential(credentialId) {
        return (await db.select().from(carriers).where(eq(carriers.credential_id, credentialId)).orderBy(asc(carriers.created_at))).map(toCarrier);
      },
      async insert(r) {
        await db.insert(carriers).values(r);
      },
      async update(id, patch) {
        const rows = await db.update(carriers).set(patch).where(eq(carriers.id, id)).returning();
        if (!rows[0]) throw new Error(`carrier ${id} not found`);
        return toCarrier(rows[0]);
      },
      async redeemOnce(id, at) {
        const rows = await db.update(carriers).set({ redeemed_at: at }).where(and(eq(carriers.id, id), isNull(carriers.redeemed_at))).returning({ id: carriers.id });
        return rows.length === 1;
      },
    },

    signingKeys: {
      async all() {
        return (await db.select().from(signing_keys).orderBy(asc(signing_keys.active_from))).map((k) => ({
          id: k.id, purpose: k.purpose, public_key: k.public_key, private_key_enc: k.private_key_enc, active_from: k.active_from, retired_at: k.retired_at,
        }));
      },
      async insert(r) {
        await db.insert(signing_keys).values(r);
      },
      async retire(id, at) {
        await db.update(signing_keys).set({ retired_at: at }).where(and(eq(signing_keys.id, id), isNull(signing_keys.retired_at)));
      },
    },

    ephemeralIds: {
      async getOrCreate(eventId, credentialId) {
        return withVaultScope(db, "scan", async (tx) => {
          const where = and(eq(ephemeral_ids.event_id, eventId), eq(ephemeral_ids.credential_id, credentialId));
          const found = await tx.select({ e: ephemeral_ids.ephemeral_id }).from(ephemeral_ids).where(where).limit(1);
          if (found[0]) return found[0].e;
          await tx.insert(ephemeral_ids).values({ event_id: eventId, credential_id: credentialId }).onConflictDoNothing();
          const after = await tx.select({ e: ephemeral_ids.ephemeral_id }).from(ephemeral_ids).where(where).limit(1);
          return after[0]!.e;
        });
      },
    },

    scans: {
      async byIdemKey(eventId, idemKey) {
        return one((await db.select().from(scans).where(and(eq(scans.event_id, eventId), eq(scans.idem_key, idemKey))).limit(1)).map(toScan));
      },
      async insert(r) {
        await db.insert(scans).values({
          id: r.id, event_id: r.event_id, checkpoint_id: r.checkpoint_id, ephemeral_id: r.ephemeral_id,
          carrier_kind: r.carrier_kind, result: r.result, direction: r.direction, occurred_at: r.occurred_at,
          received_at: r.received_at, clock_offset_ms: r.clock_offset_ms, idem_key: r.idem_key, offline_bool: r.offline_bool,
          local_result: r.local_result, device_id: r.device_id, staff_user_id: r.staff_user_id,
        });
      },
      async forEvent(eventId) {
        return (await db.select().from(scans).where(eq(scans.event_id, eventId)).orderBy(asc(scans.corrected_at), asc(scans.received_at))).map(toScan);
      },
      async page(eventId, { checkpointId, result, limit, before }) {
        const conds = [eq(scans.event_id, eventId)];
        if (checkpointId) conds.push(eq(scans.checkpoint_id, checkpointId));
        if (result) conds.push(eq(scans.result, result));
        if (before) {
          const b = one(await db.select({ at: scans.received_at }).from(scans).where(and(eq(scans.event_id, eventId), eq(scans.id, before))).limit(1));
          if (b) conds.push(or(lt(scans.received_at, b.at), and(eq(scans.received_at, b.at), lt(scans.id, before)))!);
        }
        return (await db.select().from(scans).where(and(...conds)).orderBy(desc(scans.received_at), desc(scans.id)).limit(limit)).map(toScan);
      },
    },

    occupancy: {
      async insertAdjustment(r) {
        await db.insert(occupancy_adjustments).values(r);
      },
      async adjustments(eventId) {
        return (await db.select().from(occupancy_adjustments).where(eq(occupancy_adjustments.event_id, eventId)).orderBy(asc(occupancy_adjustments.at))).map((a) => ({
          id: a.id, event_id: a.event_id, room_id: a.room_id, delta: a.delta, set_to: a.set_to, reason: a.reason, actor_id: a.actor_id, note: a.note, at: a.at,
        }));
      },
    },

    alerts: {
      async insert(r) {
        await db.insert(breach_alerts).values(r);
      },
      async byId(id) {
        return one((await db.select().from(breach_alerts).where(eq(breach_alerts.id, id)).limit(1)).map(toAlert));
      },
      async update(id, patch) {
        const { id: _id, ...rest } = patch;
        const rows = await db.update(breach_alerts).set(rest).where(eq(breach_alerts.id, id)).returning();
        if (!rows[0]) throw new Error(`alert ${id} not found`);
        return toAlert(rows[0]);
      },
      async list({ eventId, state, severity, limit }) {
        const conds = [];
        if (eventId) conds.push(eq(breach_alerts.event_id, eventId));
        if (state) conds.push(eq(breach_alerts.state, state));
        if (severity) conds.push(eq(breach_alerts.severity, severity));
        return (
          await db.select().from(breach_alerts).where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(breach_alerts.occurred_at), desc(breach_alerts.created_at)).limit(limit)
        ).map(toAlert);
      },
    },

    audit: {
      async append(e) {
        const rows = await db.insert(audit_log).values({ actor_id: e.actor_id, action: e.action, target: e.target, meta_jsonb: e.meta_jsonb, at: e.at }).returning();
        return toAudit(rows[0]!);
      },
      async all() {
        return (await db.select().from(audit_log).orderBy(asc(audit_log.id))).map(toAudit);
      },
      async verify() {
        const problems = await auditVerify(db);
        if (problems.length === 0) return -1;
        const ids = (await db.select({ id: audit_log.id }).from(audit_log).orderBy(asc(audit_log.id))).map((r) => r.id);
        const first = problems.find((p) => p.entry_id !== null);
        return first ? Math.max(0, ids.indexOf(first.entry_id!)) : 0;
      },
    },

    rollups: {
      async incrementGateRate(key, inc) {
        await db
          .insert(gate_rate_rollups)
          .values({ ...key, scans: 1, admitted: inc.admitted, denied: inc.denied, by_tier_jsonb: { [inc.tier]: 1 } })
          .onConflictDoUpdate({
            target: [gate_rate_rollups.event_id, gate_rate_rollups.checkpoint_id, gate_rate_rollups.minute_start],
            set: {
              scans: sql`${gate_rate_rollups.scans} + 1`,
              admitted: sql`${gate_rate_rollups.admitted} + ${inc.admitted}`,
              denied: sql`${gate_rate_rollups.denied} + ${inc.denied}`,
              by_tier_jsonb: sql`jsonb_set(${gate_rate_rollups.by_tier_jsonb}, ARRAY[${inc.tier}]::text[],
                to_jsonb(coalesce((${gate_rate_rollups.by_tier_jsonb} ->> ${inc.tier})::int, 0) + 1))`,
            },
          });
      },
      async gateRates(eventId) {
        return (await db.select().from(gate_rate_rollups).where(eq(gate_rate_rollups.event_id, eventId))).map(
          (r): GateRateRollupRow => ({ ...r, by_tier_jsonb: (r.by_tier_jsonb ?? {}) as GateRateRollupRow["by_tier_jsonb"] }),
        );
      },
    },

    auth: inProcessAuth,

    fixtures: {
      async organization(r) { await db.insert(organizations).values(r); },
      async venue({ city: _city, ...r }) { await db.insert(venues).values(r); }, // no venues.city column yet
      async zone(r) { await db.insert(zones).values(r); },
      async room(r) { await db.insert(rooms).values(r); },
      async checkpoint(r) { await db.insert(checkpoints).values(r); },
      async transitTime(r) { await db.insert(transit_times).values(r); },
      async event(r) {
        const { grace_buffer, ...rest } = r;
        await db.insert(events).values({ ...rest, grace_buffer: `${grace_buffer} hours` });
      },
      async eventRoom(r) { await db.insert(event_rooms).values(r); },
      async session(r) { await db.insert(sessions).values(r); },
      async registration(r) { await db.insert(registrations).values(r); },
      async accessRule(r) { await db.insert(access_rules).values(r); },
      async staffAssignment(r) { await db.insert(staff_assignments).values(r); },
    },
  };
}

/** An in-process PostgreSQL (PGlite) with every @synan/db migration applied. Dev and tests only. */
export async function createPgliteRepos(opts: { emailIndexKey: string; dataDir?: string }): Promise<Repos> {
  const [{ PGlite }, { btree_gist }, { drizzle }, { migrate }, dbPkg] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/btree_gist"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@synan/db"),
  ]);
  const client = new PGlite({ ...(opts.dataDir ? { dataDir: opts.dataDir } : {}), extensions: { btree_gist } });
  const db = drizzle(client, { schema: dbPkg.schema });
  await migrate(db, { migrationsFolder: dbPkg.MIGRATIONS_FOLDER });
  return createDrizzleRepos(db as unknown as AnyDb, {
    emailIndexKey: opts.emailIndexKey,
    close: async () => {
      await client.close();
    },
  });
}
