/**
 * Repositories over @synan/db (Drizzle, PostgreSQL). Works with node-postgres or PGlite.
 *
 * - Three connections (role separation, @synan/db migration 0005): `db` (app_api) for operational
 *   tables, `vault` (app_vault) for reading identity, `scan` (app_scan) for the ephemeral-ID mapping.
 *   On PGlite and single-role development all three are the same connection.
 * - Encrypted columns are written and read only through @synan/db's helpers: attendee email, name and
 *   profile; users.mfa_secret_enc; signing_keys.private_key_enc. Attendee lookup by email uses the
 *   keyed blind index, under every configured blind-index key.
 * - Sign-in state (sessions, links, WebSocket tickets) uses @synan/db's atomic SQL functions; only
 *   hashes are stored.
 * - The audit chain is computed by the database trigger; this layer only inserts.
 */
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
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
  auth_sessions,
  cleanupAuthState,
  consumeWsTicket,
  createAttendee,
  decryptUserRow,
  findUserByEmail,
  insertUser,
  createLink,
  encryptMfaSecret,
  findAttendeeByEmail,
  insertSigningKey,
  mintWsTicket,
  readAttendee,
  redeemLink,
  revokeFamily,
  rotateSession,
  setMfaSecret,
  startSession,
  type AnyDb,
  type AttendeeIdentity,
  type Cipher,
} from "@synan/db";
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

const toAttendee = (a: AttendeeIdentity): AttendeeRow => ({
  id: a.id,
  user_id: a.user_id,
  email: a.email,
  full_name: a.full_name,
  profile_jsonb: a.profile,
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
  pass_template_jsonb: (r.pass_template_jsonb ?? null) as Json | null,
  profile_schema_jsonb: (r.profile_schema_jsonb ?? []) as unknown[],
  access_rules_version: r.access_rules_version,
  revocation_epoch: r.revocation_epoch,
  closed_at: r.closed_at,
});
const toZone = (z: typeof zones.$inferSelect) => ({
  id: z.id, venue_id: z.venue_id, name: z.name, floor: z.floor, geometry_jsonb: (z.geometry_jsonb ?? null) as Json | null,
});
const toRegistration = (r: typeof registrations.$inferSelect) => ({
  id: r.id, event_id: r.event_id, attendee_id: r.attendee_id, tier: r.tier, state: r.state,
  zone_presence_consent_at: r.zone_presence_consent_at, checked_in_at: r.checked_in_at, created_at: r.created_at,
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

/** The three connections of the role split. On PGlite / single-role development they are one. */
export interface DrizzleConnections {
  /** app_api: every operational query. May insert attendees, never read them. */
  db: AnyDb;
  /** app_vault: identity reads and erasure. */
  vault: AnyDb;
  /** app_scan: the ephemeral-ID mapping on the scan path. */
  scan: AnyDb;
}

export interface DrizzleReposOptions {
  /** @synan/db field cipher (data keys + blind-index keys). */
  cipher: Cipher;
  close?: () => Promise<void>;
}

export type DrizzleRepos = Repos & { conn: DrizzleConnections; cipher: Cipher };

export function createDrizzleRepos(conn: DrizzleConnections, opts: DrizzleReposOptions): DrizzleRepos {
  const { db, vault, scan } = conn;
  const { cipher } = opts;
  /** A users row whose `email` is already decrypted (decryptUserRow / findUserByEmail). Decrypts the MFA secret. */
  const fromDecrypted = (r: typeof users.$inferSelect): UserRow => ({
    id: r.id,
    email: r.email,
    password_hash: r.password_hash ?? "",
    role: r.role,
    mfa_enrolled_at: r.mfa_enrolled_at,
    mfa_secret: r.mfa_secret_enc == null ? null : cipher.decrypt(r.mfa_secret_enc, { table: "users", column: "mfa_secret_enc", rowId: r.id }),
  });
  /** A raw users row: decrypts the address once (legacy plaintext tolerated until enforcement). */
  const toUser = (raw: typeof users.$inferSelect): UserRow => fromDecrypted(decryptUserRow(cipher, raw));

  return {
    kind: "drizzle",
    close: opts.close,
    conn,
    cipher,

    users: {
      async byEmail(email) {
        // Blind index under the "user" domain (every configured key), falling back to unmigrated plaintext rows.
        const found = await findUserByEmail(db, cipher, email); // returns the address already decrypted
        return found ? fromDecrypted(found) : null;
      },
      async byId(id) {
        return one((await db.select().from(users).where(eq(users.id, id)).limit(1)).map(toUser));
      },
      async insert(r) {
        await insertUser(db, cipher, {
          id: r.id, email: r.email, password_hash: r.password_hash, role: r.role,
          mfa_enrolled_at: r.mfa_enrolled_at, mfa_secret_enc: r.mfa_secret ? encryptMfaSecret(cipher, r.id, r.mfa_secret) : null,
        });
      },
      async setMfa(id, secret, at) {
        await setMfaSecret(db, cipher, id, secret, at);
      },
    },

    attendees: {
      async byEmail(email) {
        const a = await findAttendeeByEmail(vault, cipher, email);
        return a ? toAttendee(a) : null;
      },
      async byId(id) {
        const a = await readAttendee(vault, cipher, id, "system");
        return a ? toAttendee(a) : null;
      },
      async insert(r) {
        // Write-only on the general connection: encrypted identity plus the email blind index.
        await createAttendee(db, cipher, { id: r.id, user_id: r.user_id, email: r.email, full_name: r.full_name, profile: r.profile_jsonb });
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
            id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: v.city,
          })),
        );
      },
      async transitTimes(venueId) {
        return db.select().from(transit_times).where(eq(transit_times.venue_id, venueId));
      },
      async organizations() {
        return (await db.select().from(organizations)).map((o) => ({ id: o.id, name: o.name, timezone: o.timezone, support_email: o.support_email }));
      },
      async listVenues({ after, limit }) {
        return (await db.select().from(venues).where(after ? gt(venues.id, after) : undefined).orderBy(asc(venues.id)).limit(limit)).map((v) => ({
          id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: v.city,
        }));
      },
      async zone(id) {
        return one((await db.select().from(zones).where(eq(zones.id, id)).limit(1)).map(toZone));
      },
      async roomsOfVenue(venueId) {
        return (await db.select().from(rooms).where(eq(rooms.venue_id, venueId))).map(toRoom);
      },
      async updateVenue(id, p) {
        const [v] = await db.update(venues).set(p).where(eq(venues.id, id)).returning();
        if (!v) throw new Error(`venue ${id} not found`);
        return { id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: v.city };
      },
      async updateZone(id, p) {
        const [z] = await db.update(zones).set(p).where(eq(zones.id, id)).returning();
        if (!z) throw new Error(`zone ${id} not found`);
        return toZone(z);
      },
      async updateRoom(id, p) {
        const [r] = await db.update(rooms).set(p).where(eq(rooms.id, id)).returning();
        if (!r) throw new Error(`room ${id} not found`);
        return toRoom(r);
      },
      async updateCheckpoint(id, p) {
        const [c] = await db.update(checkpoints).set(p).where(eq(checkpoints.id, id)).returning();
        if (!c) throw new Error(`checkpoint ${id} not found`);
        return toCheckpoint(c);
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
      async listAll({ state, q, after, limit }) {
        const conds = [];
        if (state) conds.push(eq(events.state, state));
        if (q) conds.push(ilike(events.title, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
        if (after) conds.push(or(gt(events.starts_at, after.starts_at), and(eq(events.starts_at, after.starts_at), gt(events.id, after.id)))!);
        return (await db.select().from(events).where(conds.length ? and(...conds) : undefined).orderBy(asc(events.starts_at), asc(events.id)).limit(limit)).map(toEvent);
      },
      async update(id, p) {
        const { grace_buffer, ...rest } = p;
        const [e] = await db
          .update(events)
          .set({ ...rest, ...(grace_buffer !== undefined ? { grace_buffer: `${grace_buffer} hours` } : {}) })
          .where(eq(events.id, id))
          .returning();
        if (!e) throw new Error(`event ${id} not found`);
        return toEvent(e);
      },
      async setRooms(eventId, list) {
        await db.transaction(async (tx) => {
          const keep = list.map((r) => r.room_id);
          await tx.delete(event_rooms).where(keep.length ? and(eq(event_rooms.event_id, eventId), notInArray(event_rooms.room_id, keep)) : eq(event_rooms.event_id, eventId));
          for (const r of list) {
            await tx.insert(event_rooms).values(r).onConflictDoUpdate({ target: [event_rooms.event_id, event_rooms.room_id], set: { capacity_override: r.capacity_override } });
          }
        });
      },
      async replaceAccessRules(eventId, expectedVersion, rules) {
        return db.transaction(async (tx) => {
          const [e] = await tx
            .update(events)
            .set({ access_rules_version: expectedVersion + 1 })
            .where(and(eq(events.id, eventId), eq(events.access_rules_version, expectedVersion)))
            .returning({ v: events.access_rules_version });
          if (!e) return null;
          await tx.delete(access_rules).where(eq(access_rules.event_id, eventId));
          if (rules.length) await tx.insert(access_rules).values(rules);
          return e.v;
        });
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
        return (await db.select().from(registrations).where(eq(registrations.attendee_id, attendeeId))).map(toRegistration);
      },
      async forEvent(eventId) {
        return (await db.select().from(registrations).where(eq(registrations.event_id, eventId))).map(toRegistration);
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
          id: k.id,
          purpose: k.purpose,
          qr_kid: k.qr_kid ?? "",
          public_key: k.public_key,
          private_key: cipher.decrypt(k.private_key_enc, { table: "signing_keys", column: "private_key_enc", rowId: k.id }),
          active_from: k.active_from,
          retired_at: k.retired_at,
        }));
      },
      async insert(r) {
        await insertSigningKey(db, cipher, {
          id: r.id, purpose: r.purpose, qr_kid: r.qr_kid, public_key: r.public_key, private_key: r.private_key,
          active_from: r.active_from, retired_at: r.retired_at,
        });
      },
      async retire(id, at) {
        await db.update(signing_keys).set({ retired_at: at }).where(and(eq(signing_keys.id, id), isNull(signing_keys.retired_at)));
      },
    },

    ephemeralIds: {
      async find(eventId, credentialId) {
        return withVaultScope(scan, "scan", async (tx) => {
          const rows = await tx.select({ e: ephemeral_ids.ephemeral_id }).from(ephemeral_ids)
            .where(and(eq(ephemeral_ids.event_id, eventId), eq(ephemeral_ids.credential_id, credentialId))).limit(1);
          return rows[0]?.e ?? null;
        });
      },
      async getOrCreate(eventId, credentialId) {
        return withVaultScope(scan, "scan", async (tx) => {
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
      async page(eventId, { checkpointId, result, ephemeralId, limit, before }) {
        const conds = [eq(scans.event_id, eventId)];
        if (checkpointId) conds.push(eq(scans.checkpoint_id, checkpointId));
        if (result) conds.push(eq(scans.result, result));
        if (ephemeralId) conds.push(eq(scans.ephemeral_id, ephemeralId));
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
      async list({ eventId, state, severity, checkpointIds, limit }) {
        if (checkpointIds && checkpointIds.length === 0) return [];
        const conds = [];
        if (eventId) conds.push(eq(breach_alerts.event_id, eventId));
        if (state) conds.push(eq(breach_alerts.state, state));
        if (severity) conds.push(eq(breach_alerts.severity, severity));
        if (checkpointIds) conds.push(inArray(breach_alerts.checkpoint_id, [...checkpointIds]));
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

    auth: {
      async startSession(i) {
        await startSession(db, {
          holder: i.holder, familyId: i.familyId, tokenHash: i.tokenHash, expiresAt: i.expiresAt,
          mfaAt: i.mfaAt, userAgent: i.userAgent ?? null, ip: i.ip ?? null, now: i.now,
        });
      },
      async rotateSession(i) {
        // The lifetime is picked by the token's holder kind inside the locked step (auth_rotate_session_by_kind).
        const r = await rotateSession(db, { tokenHash: i.tokenHash, newTokenHash: i.newTokenHash, ttl: i.ttl, now: i.now });
        return { status: r.status, family_id: r.family_id, user_id: r.user_id, attendee_id: r.attendee_id, mfa_at: r.mfa_at, expires_at: r.expires_at };
      },
      async revokeFamily(familyId, reason, now) {
        return revokeFamily(db, familyId, reason, now);
      },
      async createLink(i) {
        await createLink(db, { tokenHash: i.tokenHash, attendeeId: i.attendeeId, expiresAt: i.expiresAt, now: i.now });
      },
      async redeemLink(tokenHash, now) {
        const r = await redeemLink(db, tokenHash, now);
        return { status: r.status, attendee_id: r.attendee_id };
      },
      async mintTicket(i) {
        await mintWsTicket(db, {
          ticketHash: i.ticketHash, holder: i.holder, sessionFamilyId: i.sessionFamilyId, channel: i.channel,
          eventId: i.eventId, checkpointId: i.checkpointId, expiresAt: i.expiresAt, now: i.now,
        });
      },
      async consumeTicket(ticketHash, now) {
        const r = await consumeWsTicket(db, ticketHash, now);
        return {
          status: r.status, user_id: r.user_id, attendee_id: r.attendee_id, session_family_id: r.session_family_id,
          channel: r.channel, event_id: r.event_id, checkpoint_id: r.checkpoint_id,
        };
      },
      async cleanup(now) {
        return cleanupAuthState(db, { now });
      },
    },

    fixtures: {
      async organization(r) { await db.insert(organizations).values(r); },
      async venue(r) { await db.insert(venues).values(r); },
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
export async function createPgliteRepos(opts: { cipher: Cipher; dataDir?: string }): Promise<DrizzleRepos> {
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
  const one = db as unknown as AnyDb; // PGlite: a single connection plays all three roles
  return createDrizzleRepos({ db: one, vault: one, scan: one }, {
    cipher: opts.cipher,
    close: async () => {
      await client.close();
    },
  });
}

/**
 * node-postgres with the role split (Step D): one pool per role. In production the roles must be
 * separated and verified (@synan/db assertRoleSeparation), or startup fails.
 */
export async function createPostgresRepos(opts: {
  cipher: Cipher;
  url: string;
  vaultUrl?: string;
  scanUrl?: string;
  requireSeparateRoles: boolean;
}): Promise<DrizzleRepos> {
  const dbPkg = await import("@synan/db");
  const dbs = dbPkg.createDatabases({
    url: opts.url,
    vaultUrl: opts.vaultUrl,
    scanUrl: opts.scanUrl,
    requireSeparateRoles: opts.requireSeparateRoles,
  });
  try {
    if (opts.requireSeparateRoles) await dbPkg.assertRoleSeparation(dbs);
  } catch (e) {
    await dbs.end();
    throw e;
  }
  const as = (d: unknown) => d as AnyDb;
  return createDrizzleRepos({ db: as(dbs.db), vault: as(dbs.vault), scan: as(dbs.scan) }, { cipher: opts.cipher, close: () => dbs.end() });
}
