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
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import {
  access_rules,
  access_rule_versions,
  deleteDraftEvent,
  duplicateEvent,
  publishVenueLayout,
  type GridShape,
  attendees,
  alertsPrune,
  audit_log,
  auditPrune,
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
  decryptAttendeeRow,
  emailBlindIndex,
  importCarriers,
  noteCarrierHints,
  runReport,
  postEventSummary,
  withWorkbookData,
  eventsDueForPurge,
  applySessionResets,
  expireInvitations,
  data_requests,
  openDataRequest,
  claimDataRequest,
  finishDataRequest,
  listDataRequests,
  collectAttendeeExport,
  processErasureRequest,
  occupancy_rollups,
  rebuildEventRollups,
  purgeEventMovementData,
  requestReport,
  claimReport,
  completeReport,
  failReport,
  listReports,
  type EventReport,
  createDeskCode,
  consumeDeskCode,
  createUserInvite,
  consumeUserInvite,
  startMfaEnrolment,
  readPendingMfaSecret,
  confirmMfaEnrolment,
  searchAttendeesDecrypted,
  enqueueWebhookEvent,
  claimWebhookDeliveries,
  recordWebhookAttempt,
  listWebhookDeliveries,
  devices,
  registerDevice,
  rotateDeviceTokenVersioned,
  authenticateDevice,
  recordHeartbeat,
  gateHealth,
  handOverShift,
  shiftHandoverSummary,
  type HandoverSummary as DbHandoverSummary,
  allowlistEntries,
  bindCarrier,
  rebindCarrier,
  replaceLostBand,
  carrierInventory,
  invitations,
  webhook_endpoints,
  readAttendees,
  updateAttendeeIdentity,
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
  scan_voids,
  createPendingRegistration,
  takePendingRegistration,
  cleanupPendingRegistrations,
  deletePendingRegistrationsOf,
  type AnyDb,
  type AttendeeIdentity,
  type Cipher,
} from "@synan/db";
import { WEBHOOK_MAX_ATTEMPTS } from "./types.js";
import { drizzleExportedFiles, drizzleReportSchedules } from "./drizzle-delivery.js";
import { drizzleEmailOutbox } from "./drizzle-outbox.js";
import { drizzleNotifications } from "./drizzle-notifications.js";
import { toCells } from "./memory-reports.js";
import type { AttendeeTier, CredentialState } from "@synan/contracts/enums";
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
  TxScope,
  RoomRow,
  ScanRow,
  UserRow,
  DeviceRow,
  VenueRow,
  WebhookEndpointRow,
} from "./types.js";

type Json = Record<string, unknown>;
const toHandover = (s: DbHandoverSummary) => ({
  assignment_id: s.assignment_id, checkpoint_id: s.checkpoint_id, user_id: s.user_id, period_start: s.period_start, period_end: s.period_end,
  scans: s.scans, let_through: s.let_through, refused: s.refused, duplicates: s.duplicates, offline: s.offline, late_synced: s.late_synced,
  by_result: s.by_result, first_scan_at: s.first_scan_at, last_scan_at: s.last_scan_at, undone: s.undone,
});
const one =<T>(rows: T[]): T | null => rows[0] ?? null;

/** The SQLSTATE of a driver error (node-postgres and PGlite; drizzle may wrap it in `cause`). */
export function pgCode(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}
const toDevice = (d: typeof devices.$inferSelect): DeviceRow => ({
  id: d.id, venue_id: d.venue_id, kind: d.kind, label: d.label, hardware_id: d.hardware_id, checkpoint_id: d.checkpoint_id, state: d.state,
  last_heartbeat_at: d.last_heartbeat_at, last_clock_offset_ms: d.last_clock_offset_ms, last_queue_depth: d.last_queue_depth, created_at: d.created_at,
  token_version: d.token_version,
});
const toReport = (r: EventReport) => ({
  id: r.id, event_id: r.event_id, kind: r.kind, format: r.format, include_identity: r.include_identity, state: r.state, object_key: r.object_key, requested_by: r.requested_by,
  params: (r.params_jsonb ?? {}) as Record<string, unknown>, error: r.error, created_at: r.created_at, completed_at: r.completed_at,
});
const toDataRequest = (r: typeof data_requests.$inferSelect) => ({
  id: r.id, attendee_id: r.attendee_id, kind: r.kind, state: r.state, requested_at: r.requested_at, completed_at: r.completed_at,
  handled_by: r.handled_by, object_key: r.object_key, note: r.note,
});
const toAssignment = (a: typeof staff_assignments.$inferSelect) => ({
  id: a.id, user_id: a.user_id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start, shift_end: a.shift_end,
  event_id: a.event_id, handed_over_at: a.handed_over_at, scanner_device_hashes: a.scanner_device_hashes ?? [],
});

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
  phone: a.phone,
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
  geometry_jsonb: r.geometry_jsonb ?? null,
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
  position_jsonb: r.position_jsonb ?? null,
});
const toVenue = (v: typeof venues.$inferSelect): VenueRow => ({
  id: v.id, org_id: v.org_id, name: v.name, address: v.address, timezone: v.timezone, city: v.city,
  floors: v.floors, capacity_default: v.capacity_default, layout_version: v.layout_version, layout_published_at: v.layout_published_at,
});
const toEvent = (r: typeof events.$inferSelect): EventRow => ({
  wizard_step: r.wizard_step,
  published_at: r.published_at,
  updated_by: r.updated_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
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
  contact_name: r.contact_name,
  contact_email: r.contact_email,
});
const toZone =(z: typeof zones.$inferSelect) => ({
  id: z.id, venue_id: z.venue_id, name: z.name, floor: z.floor, geometry_jsonb: z.geometry_jsonb ?? null, sort_order: z.sort_order,
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
  identifier_hint: r.identifier_hint,
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

export function createDrizzleRepos(conn: DrizzleConnections, opts: DrizzleReposOptions, outer?: TxScope): DrizzleRepos {
  const { db, vault, scan } = conn;
  const { cipher } = opts;
  /**
   * One transaction on the operational connection. Inside it every repository writes through the
   * transaction (on PGlite the vault and scan roles are the same connection, so they join it too);
   * nested calls join the outer unit; afterCommit hooks run once it has committed.
   */
  const transaction = async <T>(fn: (scope: TxScope) => Promise<T>): Promise<T> => {
    if (outer) return fn(outer);
    const hooks: (() => void)[] = [];
    const out = await db.transaction(async (raw) => {
      const tx = raw as unknown as AnyDb;
      const scope: TxScope = { repos: null as unknown as Repos, handle: tx, afterCommit: (f) => void hooks.push(f) };
      scope.repos = createDrizzleRepos({ db: tx, vault: vault === db ? tx : vault, scan: scan === db ? tx : scan }, { cipher }, scope);
      return fn(scope);
    });
    for (const f of hooks) f();
    return out as T;
  };
  /** A users row whose `email` is already decrypted (decryptUserRow / findUserByEmail). Decrypts the MFA secret. */
  const fromDecrypted = (r: typeof users.$inferSelect): UserRow => ({
    id: r.id,
    email: r.email,
    password_hash: r.password_hash ?? "",
    role: r.role,
    mfa_enrolled_at: r.mfa_enrolled_at,
    mfa_secret: r.mfa_secret_enc == null ? null : cipher.decrypt(r.mfa_secret_enc, { table: "users", column: "mfa_secret_enc", rowId: r.id }),
    display_name: r.display_name ? r.display_name : null,
  });
  /** A raw users row: decrypts the address once (legacy plaintext tolerated until enforcement). */
  const toUser = (raw: typeof users.$inferSelect): UserRow => fromDecrypted(decryptUserRow(cipher, raw));
  /** Webhook HMAC secrets are encrypted at the application layer, bound to their row (schema comment on webhook_endpoints.secret). */
  const webhookCtx = (id: string) => ({ table: "webhook_endpoints", column: "secret", rowId: id });
  const encWebhookSecret = (id: string, secret: string) => cipher.encrypt(secret, webhookCtx(id));
  const toWebhook = (w: typeof webhook_endpoints.$inferSelect): WebhookEndpointRow => ({
    id: w.id, org_id: w.org_id, url: w.url, secret: cipher.decrypt(w.secret, webhookCtx(w.id)), events: w.events, active: w.active, created_at: w.created_at,
  });

  return {
    kind: "drizzle",
    deskCodes: {
      async create(i) {
        return createDeskCode(db, cipher, { carrierIdentifier: i.bandIdentifier, createdBy: i.createdBy, ttlMinutes: 10, now: i.now });
      },
      async consume(i) {
        return consumeDeskCode(db, cipher, { code: i.code, attendeeId: i.attendeeId, now: i.now });
      },
    },
    userInvites: {
      async create(i) {
        const r = await createUserInvite(db, { userId: i.userId, createdBy: i.createdBy, ttlHours: 72, now: i.now });
        if (r.status !== "created" || !r.token) throw new Error(`user invite: ${r.status}`);
        return r.token;
      },
      async consume(token, now) {
        const r = await consumeUserInvite(db, token, now);
        return r.status === "consumed" ? r.user_id : null;
      },
    },
    webhookDeliveries: {
      async enqueue(i) {
        return enqueueWebhookEvent(db, { orgId: i.orgId, event: i.event, payload: i.payload, alertId: i.alertId, now: i.now });
      },
      async claim(now, limit) {
        return claimWebhookDeliveries(db, cipher, { limit, now });
      },
      async record(i) {
        const r = await recordWebhookAttempt(db, { deliveryId: i.deliveryId, ok: i.ok, responseCode: i.responseCode, error: i.error, maxAttempts: WEBHOOK_MAX_ATTEMPTS, now: i.now });
        return { state: r.state };
      },
      async forEndpoint(endpointId, { offset, limit }) {
        const p = await listWebhookDeliveries(db, { endpointId, offset, limit });
        return p.items.map((d) => ({
          id: d.id, endpoint_id: d.endpoint_id, event: d.event, state: d.state, attempt: d.attempt, response_code: d.response_code,
          last_error: d.last_error, next_attempt_at: d.next_attempt_at, created_at: d.created_at, delivered_at: d.delivered_at,
        }));
      },
    },
    maintenance: {
      async eventsDueForPurge(now) {
        return (await eventsDueForPurge(db, { now })).map((e) => e.event_id);
      },
      async applySessionResets(eventId, now) {
        return (await applySessionResets(db, eventId, now)).length;
      },
      async expireInvitations(now) {
        return expireInvitations(db, now);
      },
    },
    reportSchedules: drizzleReportSchedules(db, cipher),
    emailOutbox: drizzleEmailOutbox(db, cipher),
    notifications: drizzleNotifications(db),
    exportedFiles: drizzleExportedFiles(db),
    transaction,
    // pii_vault.pending_registrations (0028–0029): vault connection, system scope, answers encrypted.
    pendingRegistrations: {
      async create(r) {
        await createPendingRegistration(vault, cipher, {
          id: r.id, linkTokenHash: r.link_token_hash, attendeeId: r.attendee_id, eventId: r.event_id,
          zonePresenceConsent: r.zone_presence_consent, answers: r.answers, expiresAt: r.expires_at, now: r.created_at,
        });
      },
      async take(linkTokenHash, now) {
        const p = await takePendingRegistration(vault, cipher, linkTokenHash, now);
        return p ? { ...p, link_token_hash: linkTokenHash } : null;
      },
      async cleanup(now) {
        return cleanupPendingRegistrations(vault, now);
      },
      async deleteFor(attendeeId) {
        return deletePendingRegistrationsOf(vault, attendeeId);
      },
    },
    dataRequests: {
      async open(attendeeId, kind, now) {
        return openDataRequest(db, attendeeId, kind, now);
      },
      async claimExport(now) {
        const r = await claimDataRequest(db, { kind: "export", now });
        return r ? toDataRequest(r) : null;
      },
      async byId(id) {
        return one((await db.select().from(data_requests).where(eq(data_requests.id, id)).limit(1)).map(toDataRequest));
      },
      async finish(id, i) {
        return finishDataRequest(db, id, { state: i.state, objectKey: i.objectKey ?? null, note: i.note ?? null, actorId: i.actorId, now: i.now });
      },
      async list({ state, kind, offset, limit }) {
        return (await listDataRequests(db, { state, kind, offset, limit })).items.map(toDataRequest);
      },
      async forAttendee(attendeeId) {
        return (await db.select().from(data_requests).where(eq(data_requests.attendee_id, attendeeId)).orderBy(desc(data_requests.requested_at))).map(toDataRequest);
      },
      async collectExport(attendeeId) {
        const x = await collectAttendeeExport({ db, vault, cipher }, attendeeId);
        return JSON.parse(JSON.stringify(x)) as Record<string, unknown>;
      },
      async erase(request, actorId, now) {
        await processErasureRequest({ db, vault }, { ...request, started_at: null } as never, actorId);
        void now;
      },
    },
    reports: {
      async run(kind, eventId, { section, cursor, limit }) {
        let p;
        try {
          p = await runReport(db, kind, eventId, { section: section as never, cursor, limit });
        } catch (e) {
          const m = e instanceof Error ? e.message : "";
          if (m.includes("cursor")) throw new Error("invalid report cursor");
          if (m.includes("section")) throw new Error("invalid report section");
          throw e;
        }
        return { section: p.section, columns: p.columns.map((c) => c.key), rows: toCells(p.columns, p.rows), next_cursor: p.next_cursor, total: p.total };
      },
      async rebuildRollups(eventId) {
        await rebuildEventRollups(db as never, eventId);
      },
      async purge(eventId, actorId) {
        await purgeEventMovementData(db as never, eventId, { force: true, actorId });
        await db.delete(scan_voids).where(eq(scan_voids.event_id, eventId)); // correction records go with the scans
      },
      async request(i) {
        return requestReport(db, { eventId: i.eventId, kind: i.kind, format: i.format, includeIdentity: i.includeIdentity, requestedBy: i.requestedBy, params: i.params });
      },
      async claim(now) {
        const r = await claimReport(db, now);
        return r ? toReport(r) : null;
      },
      async complete(id, objectKey, now) {
        return completeReport(db, id, { objectKey, now });
      },
      async fail(id, error, now) {
        return failReport(db, id, error, now);
      },
      async list({ eventId, offset, limit }) {
        return (await listReports(db, { eventId, offset, limit })).items.map(toReport);
      },
      async occupancyCurve(eventId) {
        const rs = await db
          .select({ at: occupancy_rollups.bucket_start, n: sql<number>`sum(${occupancy_rollups.peak})::int` })
          .from(occupancy_rollups).where(eq(occupancy_rollups.event_id, eventId))
          .groupBy(occupancy_rollups.bucket_start).orderBy(asc(occupancy_rollups.bucket_start));
        return rs.map((r) => ({ at: r.at, on_site: Number(r.n) }));
      },
      async postEventSummary(eventId, now) {
        return postEventSummary(db, eventId, now);
      },
      async workbook(eventId, opts, consume) {
        return withWorkbookData({ db, vault, cipher }, eventId, { includeIdentity: opts.includeIdentity, now: opts.now }, consume);
      },
      async purgedAt(eventId) {
        return (await db.select({ p: events.purged_at }).from(events).where(eq(events.id, eventId)).limit(1))[0]?.p ?? null;
      },
    },
    devices: {
      async register(i) {
        try {
          return await registerDevice(db, { venueId: i.venueId, kind: i.kind, label: i.label, hardwareId: i.hardwareId, checkpointId: i.checkpointId });
        } catch (e) {
          if (pgCode(e) === "23505") return "duplicate";
          throw e;
        }
      },
      async byId(id) {
        return one((await db.select().from(devices).where(eq(devices.id, id)).limit(1)).map(toDevice));
      },
      async list(venueId) {
        return (await db.select().from(devices).where(venueId ? eq(devices.venue_id, venueId) : undefined).orderBy(asc(devices.created_at))).map(toDevice);
      },
      async rotateToken(id) {
        const r = await rotateDeviceTokenVersioned(db, id);
        if (!r) throw new Error(`device ${id} not found`);
        return r.token;
      },
      async retire(id, at) {
        await db.update(devices).set({ state: "retired", retired_at: at }).where(eq(devices.id, id));
      },
      async authenticate(token) {
        const d = await authenticateDevice(db, token);
        return d ? toDevice(d) : null;
      },
      async heartbeat(i) {
        return recordHeartbeat(db, { deviceId: i.deviceId, checkpointId: i.checkpointId ?? null, clockOffsetMs: i.clockOffsetMs, queueDepth: i.queueDepth, appVersion: i.appVersion, allowlistIssuedAt: i.allowlistIssuedAt ?? null, now: i.now });
      },
      async ensureScanner(i) {
        const find = async () =>
          one(await db.select({ id: devices.id, checkpoint_id: devices.checkpoint_id, last_user_id: devices.last_user_id }).from(devices).where(eq(devices.hardware_id, i.hardwareId)).limit(1));
        let d = await find();
        if (!d) {
          try {
            const r = await registerDevice(db, { venueId: i.venueId, kind: "scanner", label: i.label, hardwareId: i.hardwareId, checkpointId: i.checkpointId, issueToken: false });
            await db.update(devices).set({ last_user_id: i.userId }).where(eq(devices.id, r.id));
            return { id: r.id, previousUserId: null };
          } catch (e) {
            if (pgCode(e) !== "23505") throw e;
            d = await find(); // registered concurrently
          }
        }
        const moved = d!.checkpoint_id !== i.checkpointId;
        const handedOver = d!.last_user_id !== i.userId;
        if (moved || handedOver) {
          // Another gate's or another person's allowlist age no longer describes this install.
          await db.update(devices).set({ checkpoint_id: i.checkpointId, last_user_id: i.userId, allowlist_issued_at: null }).where(eq(devices.id, d!.id));
        }
        return { id: d!.id, previousUserId: handedOver ? d!.last_user_id : null };
      },
      async gateHealth(venueId, { eventId, now }) {
        return (await gateHealth(db, venueId, { eventId, now })).map((g) => ({
          checkpoint_id: g.checkpoint_id, label: g.label, perimeter: g.perimeter, link_state: g.link_state, last_heartbeat_at: g.last_heartbeat_at,
          heartbeat_age_s: g.heartbeat_age_s, clock_offset_ms: g.clock_offset_ms, clock_fault: g.clock_fault, queue_depth: g.queue_depth,
          last_scan_at: g.last_scan_at, scans_last_15m: g.scans_last_15m, staff_on_duty: g.staff_on_duty, position: g.position ?? null,
          allowlist_issued_at: g.allowlist_issued_at, allowlist_stale: g.allowlist_stale,
        }));
      },
    },
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
          id: r.id, email: r.email, password_hash: r.password_hash, role: r.role, display_name: r.display_name ?? "",
          mfa_enrolled_at: r.mfa_enrolled_at, mfa_secret_enc: r.mfa_secret ? encryptMfaSecret(cipher, r.id, r.mfa_secret) : null,
        });
      },
      async setMfa(id, secret, at) {
        await setMfaSecret(db, cipher, id, secret, at);
      },
      async list({ after, limit }) {
        return (await db.select().from(users).where(after ? gt(users.id, after) : undefined).orderBy(asc(users.id)).limit(limit)).map(toUser);
      },
      async setPassword(id, hash) {
        await db.update(users).set({ password_hash: hash, updated_at: sql`now()` }).where(eq(users.id, id));
      },
      async setRole(id, role) {
        await db.update(users).set({ role }).where(eq(users.id, id));
      },
      async startMfaEnrolment(id, secret, now) {
        await startMfaEnrolment(db, cipher, id, secret, { ttlMinutes: 10, now });
      },
      async readPendingMfaSecret(id, now) {
        return readPendingMfaSecret(db, cipher, id, now);
      },
      async confirmMfaEnrolment(id, now) {
        return confirmMfaEnrolment(db, cipher, id, now);
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
        await createAttendee(db, cipher, { id: r.id, user_id: r.user_id, email: r.email, full_name: r.full_name, profile: r.profile_jsonb, phone: r.phone ?? null });
      },
      async update(id, p) {
        return updateAttendeeIdentity(vault, cipher, id, {
          ...(p.full_name !== undefined ? { full_name: p.full_name } : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
          ...(p.profile_jsonb !== undefined ? { profile: p.profile_jsonb } : {}),
          ...(p.phone !== undefined ? { phone: p.phone } : {}),
        }, "operator");
      },
      async byIds(ids) {
        return (await readAttendees(vault, cipher, ids)).map(toAttendee);
      },
      async list({ after, limit }) {
        const raw = await withVaultScope(vault, "operator", (tx) =>
          tx.select().from(attendees).where(after ? gt(attendees.id, after) : undefined).orderBy(asc(attendees.id)).limit(limit),
        );
        return raw.map((r) => toAttendee(decryptAttendeeRow(cipher, r)));
      },
      async search(q, { attendeeIds, limit }) {
        return (await searchAttendeesDecrypted(vault, cipher, { q, attendeeIds, limit })).map(toAttendee);
      },
    },

    webhooks: {
      async list() {
        return (await db.select().from(webhook_endpoints).orderBy(asc(webhook_endpoints.created_at))).map(toWebhook);
      },
      async byId(id) {
        return one((await db.select().from(webhook_endpoints).where(eq(webhook_endpoints.id, id)).limit(1)).map(toWebhook));
      },
      async insert(r) {
        await db.insert(webhook_endpoints).values({ ...r, secret: encWebhookSecret(r.id, r.secret) });
      },
      async update(id, p) {
        const { secret, ...rest } = p;
        const [w] = await db.update(webhook_endpoints).set({ ...rest, ...(secret !== undefined ? { secret: encWebhookSecret(id, secret) } : {}) }).where(eq(webhook_endpoints.id, id)).returning();
        if (!w) throw new Error(`webhook ${id} not found`);
        return toWebhook(w);
      },
      async delete(id) {
        await db.delete(webhook_endpoints).where(eq(webhook_endpoints.id, id));
      },
    },

    invitations: {
      hashEmail: (email) => emailBlindIndex(cipher, email),
      hashCandidates: (email) => cipher.blindIndexCandidates(email),
      async insert(r) {
        const rows = await db.insert(invitations).values(r).onConflictDoNothing().returning({ id: invitations.id });
        return rows.length === 1 ? "ok" : "duplicate";
      },
      async byTokenHash(h) {
        return one(await db.select().from(invitations).where(eq(invitations.token_hash, h)).limit(1));
      },
      async consume(id, outcome, now) {
        const rows = await db
          .update(invitations)
          .set(outcome === "redeemed" ? { state: "redeemed", redeemed_at: now } : { state: "revoked" })
          .where(and(eq(invitations.id, id), eq(invitations.state, "sent"), gt(invitations.expires_at, now)))
          .returning({ id: invitations.id });
        return rows.length === 1;
      },
      async forEvent(eventId) {
        return db.select().from(invitations).where(eq(invitations.event_id, eventId)).orderBy(asc(invitations.created_at));
      },
    },

    venues: {
      async zonesOfVenue(venueId) {
        return (await db.select().from(zones).where(eq(zones.venue_id, venueId))).map(toZone);
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
        return one((await db.select().from(venues).where(eq(venues.id, id)).limit(1)).map(toVenue));
      },
      async transitTimes(venueId) {
        return db.select().from(transit_times).where(eq(transit_times.venue_id, venueId));
      },
      async organizations() {
        return (await db.select().from(organizations)).map((o) => ({ id: o.id, name: o.name, timezone: o.timezone, support_email: o.support_email }));
      },
      async listVenues({ after, limit }) {
        return (await db.select().from(venues).where(after ? gt(venues.id, after) : undefined).orderBy(asc(venues.id)).limit(limit)).map(toVenue);
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
        return toVenue(v);
      },
      async publishLayout(i) {
        return publishVenueLayout(db, {
          venueId: i.venueId, expectedVersion: i.expectedVersion, floors: i.floors, now: i.now,
          zones: i.zones.map((z) => ({ ...z, geometry: z.geometry as GridShape | null })),
          rooms: i.rooms.map((r) => ({ ...r, geometry: r.geometry as GridShape | null })),
        });
      },
      async updateZone(id, p) {
        const [z] = await db.update(zones).set(p as Partial<typeof zones.$inferInsert>).where(eq(zones.id, id)).returning();
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
      async listAll({ state, states, q, after, limit }) {
        const conds = [];
        if (state) conds.push(eq(events.state, state));
        if (states) conds.push(states.length ? inArray(events.state, [...states]) : sql`false`);
        if (q) conds.push(ilike(events.title, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
        if (after) conds.push(or(gt(events.starts_at, after.starts_at), and(eq(events.starts_at, after.starts_at), gt(events.id, after.id)))!);
        return (await db.select().from(events).where(conds.length ? and(...conds) : undefined).orderBy(asc(events.starts_at), asc(events.id)).limit(limit)).map(toEvent);
      },
      async listAdmin({ state, q, venueId, after, limit }) {
        const conds = [];
        if (state) conds.push(eq(events.state, state));
        if (venueId) conds.push(eq(events.venue_id, venueId));
        if (q) conds.push(ilike(events.title, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
        if (after) conds.push(or(lt(events.updated_at, after.updated_at), and(eq(events.updated_at, after.updated_at), lt(events.id, after.id)))!);
        return (await db.select().from(events).where(conds.length ? and(...conds) : undefined).orderBy(desc(events.updated_at), desc(events.id)).limit(limit)).map(toEvent);
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
      async setVenue(eventId, venueId) {
        return transaction(async (s) => {
          const tx = s.handle as AnyDb;
          await tx.delete(event_rooms).where(eq(event_rooms.event_id, eventId)); // sessions and rules cascade
          const [e] = await tx.update(events).set({ venue_id: venueId }).where(eq(events.id, eventId)).returning();
          if (!e) throw new Error(`event ${eventId} not found`);
          return toEvent(e);
        });
      },
      async accessRuleVersion(eventId, version) {
        const r = one(
          await db.select({ at: access_rule_versions.published_at, by: access_rule_versions.published_by }).from(access_rule_versions)
            .where(and(eq(access_rule_versions.event_id, eventId), eq(access_rule_versions.version, version))).limit(1),
        );
        return r ? { published_at: r.at, published_by: r.by } : null;
      },
      async duplicate(i) {
        return duplicateEvent(db, { eventId: i.eventId, slug: i.slug, title: i.title, startsAt: i.startsAt, actorId: i.actorId });
      },
      async deleteDraft(eventId) {
        return deleteDraftEvent(db, eventId);
      },
      async insertSession(r) {
        await db.insert(sessions).values(r);
      },
      async updateSession(id, patch) {
        const [s] = await db.update(sessions).set(patch).where(eq(sessions.id, id)).returning();
        if (!s) throw new Error(`session ${id} not found`);
        return { id: s.id, event_id: s.event_id, room_id: s.room_id, title: s.title, starts_at: s.starts_at, ends_at: s.ends_at };
      },
      async deleteSession(id) {
        return (await db.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id })).length === 1;
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
      async replaceAccessRules(eventId, expectedVersion, rules, by) {
        return db.transaction(async (tx) => {
          const [e] = await tx
            .update(events)
            .set({ access_rules_version: expectedVersion + 1 })
            .where(and(eq(events.id, eventId), eq(events.access_rules_version, expectedVersion)))
            .returning({ v: events.access_rules_version });
          if (!e) return null;
          await tx.delete(access_rules).where(eq(access_rules.event_id, eventId));
          if (rules.length) await tx.insert(access_rules).values(rules);
          // The published version, as access_rules_replace() records it (snapshot, who, when).
          await tx.insert(access_rule_versions).values({
            event_id: eventId, version: e.v, published_by: by?.actorId ?? null, published_at: by?.now ?? new Date(),
            rules_jsonb: sql`public.access_rules_snapshot(${eventId}::uuid)`,
          }).onConflictDoNothing();
          return e.v;
        });
      },
      async allowlist(eventId, { from, to, checkpointId }) {
        const a = await allowlistEntries(db, eventId, checkpointId, { from, to });
        return {
          revocation_epoch: a.revocation_epoch,
          access_rules_version: a.access_rules_version,
          entries: a.entries.map((x) => ({ ...x, tier: x.tier as AttendeeTier | null, state: x.state as CredentialState })),
        };
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
      async clearCheckedIn(id, at) {
        await db.update(registrations).set({ checked_in_at: null }).where(and(eq(registrations.id, id), eq(registrations.checked_in_at, at)));
      },
      async forAttendee(attendeeId) {
        return (await db.select().from(registrations).where(eq(registrations.attendee_id, attendeeId))).map(toRegistration);
      },
      async forEvent(eventId) {
        return (await db.select().from(registrations).where(eq(registrations.event_id, eventId))).map(toRegistration);
      },
      async insert(r) {
        const rows = await db.insert(registrations).values({ ...r, invitation_id: r.invitation_id ?? null }).onConflictDoNothing().returning({ id: registrations.id });
        return rows.length === 1 ? "ok" : "duplicate";
      },
      async update(id, patch) {
        const [r] = await db.update(registrations).set({ ...patch, updated_at: sql`now()` }).where(eq(registrations.id, id)).returning();
        if (!r) throw new Error(`registration ${id} not found`);
        return toRegistration(r);
      },
      async countByAttendee(ids) {
        if (ids.length === 0) return new Map();
        const rows = await db
          .select({ a: registrations.attendee_id, n: sql<number>`count(*)::int` })
          .from(registrations)
          .where(and(inArray(registrations.attendee_id, [...ids]), ne(registrations.state, "cancelled")))
          .groupBy(registrations.attendee_id);
        return new Map(rows.map((r) => [r.a, Number(r.n)]));
      },
      async countByEvent(ids) {
        const out = new Map<string, { registered: number; checked_in: number }>(ids.map((id) => [id, { registered: 0, checked_in: 0 }]));
        if (ids.length === 0) return out;
        const rs = await db
          .select({ e: registrations.event_id, n: sql<number>`count(*)::int`, c: sql<number>`count(${registrations.checked_in_at})::int` })
          .from(registrations)
          .where(and(inArray(registrations.event_id, [...ids]), ne(registrations.state, "cancelled")))
          .groupBy(registrations.event_id);
        for (const r of rs) out.set(r.e, { registered: Number(r.n), checked_in: Number(r.c) });
        return out;
      },
    },

    staff: {
      async assignmentsFor(userId) {
        return (await db.select().from(staff_assignments).where(eq(staff_assignments.user_id, userId))).map(toAssignment);
      },
      async byId(id) {
        return one((await db.select().from(staff_assignments).where(eq(staff_assignments.id, id)).limit(1)).map(toAssignment));
      },
      async list({ checkpointId, userId, eventId, offset, limit }) {
        const conds = [];
        if (checkpointId) conds.push(eq(staff_assignments.checkpoint_id, checkpointId));
        if (userId) conds.push(eq(staff_assignments.user_id, userId));
        if (eventId) conds.push(eq(staff_assignments.event_id, eventId));
        return (
          await db.select().from(staff_assignments).where(conds.length ? and(...conds) : undefined)
            .orderBy(asc(staff_assignments.shift_start), asc(staff_assignments.id)).offset(offset).limit(limit)
        ).map(toAssignment);
      },
      async insert(r) {
        try {
          await db.insert(staff_assignments).values({ ...r, event_id: r.event_id ?? null, handed_over_at: r.handed_over_at ?? null });
          return "ok";
        } catch (e) {
          // 23P01 exclusion_violation: staff_assignments_no_overlap.
          if (pgCode(e) === "23P01") return "overlap";
          throw e;
        }
      },
      async markHandedOver(id, at) {
        await db.update(staff_assignments).set({ handed_over_at: at }).where(and(eq(staff_assignments.id, id), isNull(staff_assignments.handed_over_at)));
      },
      async handOver(id, { actorId, now }) {
        const a = one(await db.select({ h: staff_assignments.handed_over_at }).from(staff_assignments).where(eq(staff_assignments.id, id)).limit(1));
        if (!a) return null;
        if (a.h) return "already_handed_over";
        try {
          return toHandover(await handOverShift(db, id, { actorId, now }));
        } catch (e) {
          if (pgCode(e) === "P0002") return "already_handed_over"; // handed over concurrently
          throw e;
        }
      },
      async handoverSummary(id) {
        const s = await shiftHandoverSummary(db, id);
        return s ? toHandover(s) : null;
      },
      async noteDevice(id, deviceHash) {
        // Append once, at most 8 (the CHECK staff_assignments_device_hashes).
        await db.update(staff_assignments)
          .set({ scanner_device_hashes: sql`array_append(${staff_assignments.scanner_device_hashes}, ${deviceHash}::text)` })
          .where(and(eq(staff_assignments.id, id), sql`NOT (${deviceHash}::text = ANY(${staff_assignments.scanner_device_hashes}))`, sql`cardinality(${staff_assignments.scanner_device_hashes}) < 8`));
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
      async page({ registrationIds, state, after, limit }) {
        if (registrationIds && registrationIds.length === 0) return [];
        const conds = [];
        if (registrationIds) conds.push(inArray(credentials.registration_id, [...registrationIds]));
        if (state) conds.push(eq(credentials.state, state));
        if (after) conds.push(gt(credentials.id, after));
        return (await db.select().from(credentials).where(conds.length ? and(...conds) : undefined).orderBy(asc(credentials.id)).limit(limit)).map(toCredential);
      },
      async forRegistrations(ids) {
        if (ids.length === 0) return [];
        return (await db.select().from(credentials).where(inArray(credentials.registration_id, [...ids]))).map(toCredential);
      },
      async update(id, patch) {
        const rows = await db.update(credentials).set(patch).where(eq(credentials.id, id)).returning();
        if (!rows[0]) throw new Error(`credential ${id} not found`);
        return toCredential(rows[0]);
      },
      // The state-machine trigger (0012) refuses a move the lifecycle does not allow.
      async setState(id, patch) {
        const rows = await db.update(credentials).set(patch).where(eq(credentials.id, id)).returning();
        if (!rows[0]) throw new Error(`credential ${id} not found`);
        return toCredential(rows[0]);
      },
    },

    carriers: {
      async byId(id) {
        return one((await db.select().from(carriers).where(eq(carriers.id, id)).limit(1)).map(toCarrier));
      },
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
      async forCredentials(ids) {
        if (ids.length === 0) return [];
        return (await db.select().from(carriers).where(inArray(carriers.credential_id, [...ids])).orderBy(asc(carriers.created_at))).map(toCarrier);
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
      async importStock(hashes, chipProfile) {
        const r = await importCarriers(db, hashes.map((h) => ({ identifier_hash: h, chip_profile: chipProfile })));
        return { inserted: r.imported, duplicates: [...new Set(r.duplicates)].sort() };
      },
      async noteHints(uids) {
        for (let i = 0; i < uids.length; i += 5000) await noteCarrierHints(db, uids.slice(i, i + 5000));
      },
      async bind(i) {
        const r = await bindCarrier(db, { identifier: i.identifier, credentialId: i.credentialId, actorId: i.actorId, confirm: true, kind: "nfc", now: i.now });
        return { status: r.status, carrier_id: r.carrier_id };
      },
      // The desk has the new band in hand: it is verified at once (assigned → bound, 01 §5.3), as the
      // in-memory store does. carrier_rebind / carrier_replace_lost leave it `assigned`, which opens no door.
      async rebind(i) {
        return transaction(async (s) => {
          const tx = s.handle as AnyDb;
          const r = await rebindCarrier(tx, { credentialId: i.credentialId, newIdentifier: i.newIdentifier, disposition: i.disposition, actorId: i.actorId, now: i.now });
          if (r.status === "rebound" && r.new_carrier_id) await tx.update(carriers).set({ state: "bound", bound_at: i.now }).where(and(eq(carriers.id, r.new_carrier_id), eq(carriers.state, "assigned")));
          return { status: r.status, old_carrier_id: r.old_carrier_id, new_carrier_id: r.new_carrier_id };
        });
      },
      async replaceLost(i) {
        return transaction(async (s) => {
          const tx = s.handle as AnyDb;
          const r = await replaceLostBand(tx, i);
          if (r.status === "replaced" && r.new_carrier_id) await tx.update(carriers).set({ state: "bound", bound_at: i.now }).where(and(eq(carriers.id, r.new_carrier_id), eq(carriers.state, "assigned")));
          return { status: r.status, old_carrier_id: r.old_carrier_id, new_carrier_id: r.new_carrier_id, old_credential_id: r.old_credential_id, new_credential_id: r.new_credential_id };
        });
      },
      async inventory(credentialIds) {
        if (credentialIds && credentialIds.length === 0) {
          return { by_state: { stock: 0, assigned: 0, bound: 0, active: 0, retired: 0, lost: 0 }, by_chip_profile: {} };
        }
        let by_state: Record<string, number>;
        const scope = credentialIds ? [eq(carriers.kind, "nfc"), inArray(carriers.credential_id, [...credentialIds])] : [eq(carriers.kind, "nfc")];
        if (!credentialIds) by_state = await carrierInventory(db, "nfc");
        else {
          by_state = { stock: 0, assigned: 0, bound: 0, active: 0, retired: 0, lost: 0 };
          const rs = await db.select({ s: carriers.state, n: sql<number>`count(*)::int` }).from(carriers).where(and(...scope)).groupBy(carriers.state);
          for (const r of rs) by_state[r.s] = Number(r.n);
        }
        const ps = await db.select({ p: carriers.chip_profile, n: sql<number>`count(*)::int` }).from(carriers).where(and(...scope)).groupBy(carriers.chip_profile);
        return { by_state, by_chip_profile: Object.fromEntries(ps.map((r) => [r.p ?? "unknown", Number(r.n)])) };
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
      async credentialFor(eventId, ephemeralId) {
        return withVaultScope(scan, "scan", async (tx) => {
          const rows = await tx.select({ c: ephemeral_ids.credential_id }).from(ephemeral_ids)
            .where(and(eq(ephemeral_ids.event_id, eventId), eq(ephemeral_ids.ephemeral_id, ephemeralId))).limit(1);
          return rows[0]?.c ?? null;
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
      async shiftCounts({ checkpointId, staffUserId, from, to }) {
        const rs = await db
          .select({ result: scans.result, offline: scans.offline_bool, n: sql<number>`count(*)::int` })
          .from(scans)
          .where(and(eq(scans.checkpoint_id, checkpointId), eq(scans.staff_user_id, staffUserId), gte(scans.corrected_at, from), lt(scans.corrected_at, to)))
          .groupBy(scans.result, scans.offline_bool);
        const byResult: Record<string, number> = {};
        let offline = 0;
        for (const r of rs) {
          byResult[r.result] = (byResult[r.result] ?? 0) + Number(r.n);
          if (r.offline) offline += Number(r.n);
        }
        return { byResult, offline };
      },
      async page(eventId, { checkpointId, result, ephemeralId, limit, before, checkpointIds, ephemeralIds }) {
        const conds = [eq(scans.event_id, eventId)];
        if (checkpointId) conds.push(eq(scans.checkpoint_id, checkpointId));
        if (result) conds.push(eq(scans.result, result));
        if (ephemeralId) conds.push(eq(scans.ephemeral_id, ephemeralId));
        if (checkpointIds) conds.push(checkpointIds.length ? inArray(scans.checkpoint_id, [...checkpointIds]) : sql`false`);
        if (ephemeralIds) conds.push(ephemeralIds.length ? inArray(scans.ephemeral_id, [...ephemeralIds]) : sql`false`);
        if (before) {
          const b = one(await db.select({ at: scans.received_at }).from(scans).where(and(eq(scans.event_id, eventId), eq(scans.id, before))).limit(1));
          if (b) conds.push(or(lt(scans.received_at, b.at), and(eq(scans.received_at, b.at), lt(scans.id, before)))!);
        }
        return (await db.select().from(scans).where(and(...conds)).orderBy(desc(scans.received_at), desc(scans.id)).limit(limit)).map(toScan);
      },
      async logStats(eventId, { checkpointIds, result, ephemeralIds, cap }) {
        const conds = [eq(scans.event_id, eventId)];
        if (checkpointIds) conds.push(checkpointIds.length ? inArray(scans.checkpoint_id, [...checkpointIds]) : sql`false`);
        if (result) conds.push(eq(scans.result, result));
        if (ephemeralIds) conds.push(ephemeralIds.length ? inArray(scans.ephemeral_id, [...ephemeralIds]) : sql`false`);
        // Counting stops one past the cap, so a long log costs at most `cap` rows.
        const capped = db.select({ one: sql`1` }).from(scans).where(and(...conds)).limit(cap + 1).as("capped");
        const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(capped);
        const [o] = await db.select({ at: sql<Date | string | null>`min(${scans.corrected_at})` }).from(scans).where(eq(scans.event_id, eventId));
        const n = Number(c?.n ?? 0);
        const at = o?.at ?? null;
        return { total: Math.min(n, cap), exact: n <= cap, oldest_at: at === null ? null : new Date(at) };
      },
      async byId(eventId, scanId) {
        return one((await db.select().from(scans).where(and(eq(scans.event_id, eventId), eq(scans.id, scanId))).limit(1)).map(toScan));
      },
      async insertVoid(r) {
        const rows = await db.insert(scan_voids).values(r).onConflictDoNothing().returning({ id: scan_voids.id });
        return rows.length === 1 ? "ok" : "duplicate";
      },
      async voids(eventId) {
        return db.select().from(scan_voids).where(eq(scan_voids.event_id, eventId)).orderBy(asc(scan_voids.voided_at));
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
      async prune({ olderThanMonths, now }) {
        // public.alerts_prune (0022): refuses under 12 months, skips alerts with webhook deliveries
        // still pending, deletes their finished deliveries, writes `retention.alerts_pruned`.
        return alertsPrune(db, { olderThanMonths, now });
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
      async find({ actions, targets, actorId, since, limit }) {
        if (actions.length === 0 || (targets && targets.length === 0)) return [];
        const conds = [inArray(audit_log.action, [...actions])];
        if (targets) conds.push(inArray(audit_log.target, [...targets]));
        if (actorId) conds.push(eq(audit_log.actor_id, actorId));
        if (since) conds.push(gte(audit_log.at, since));
        // Narrowed to targets (a desk's bands, one alert): read them through audit_log_target_idx and sort
        // what matched. Ordering by the bare id lets the planner walk the primary key backwards and filter,
        // which reads the whole log when the targets have few or only old entries (measured: 300k entries,
        // 3000 bands without recent actions: ~180 ms walking the key vs ~17–70 ms by target).
        const order = targets ? desc(sql`${audit_log.id} + 0`) : desc(audit_log.id);
        return (await db.select().from(audit_log).where(and(...conds)).orderBy(order).limit(limit)).map(toAudit);
      },
      async verify() {
        const problems = await auditVerify(db);
        if (problems.length === 0) return -1;
        const ids = (await db.select({ id: audit_log.id }).from(audit_log).orderBy(asc(audit_log.id))).map((r) => r.id);
        const first = problems.find((p) => p.entry_id !== null);
        return first ? Math.max(0, ids.indexOf(first.entry_id!)) : 0;
      },
      async prune() {
        // public.audit_prune(): entries carry database time, so the database's clock decides what is 12 months old.
        return auditPrune(db);
      },
    },

    rollups: {
      async incrementGateRate(key, inc) {
        await db
          .insert(gate_rate_rollups)
          .values({ ...key, scans: 1, admitted: inc.admitted, denied: inc.denied, by_tier_jsonb: { [inc.tier]: 1 }, by_result_jsonb: { [inc.result]: 1 } })
          .onConflictDoUpdate({
            target: [gate_rate_rollups.event_id, gate_rate_rollups.checkpoint_id, gate_rate_rollups.minute_start],
            set: {
              scans: sql`${gate_rate_rollups.scans} + 1`,
              admitted: sql`${gate_rate_rollups.admitted} + ${inc.admitted}`,
              denied: sql`${gate_rate_rollups.denied} + ${inc.denied}`,
              by_tier_jsonb: sql`jsonb_set(${gate_rate_rollups.by_tier_jsonb}, ARRAY[${inc.tier}]::text[],
                to_jsonb(coalesce((${gate_rate_rollups.by_tier_jsonb} ->> ${inc.tier})::int, 0) + 1))`,
              by_result_jsonb: sql`jsonb_set(${gate_rate_rollups.by_result_jsonb}, ARRAY[${inc.result}]::text[],
                to_jsonb(coalesce((${gate_rate_rollups.by_result_jsonb} ->> ${inc.result})::int, 0) + 1))`,
            },
          });
      },
      async gateRates(eventId) {
        return (await db.select().from(gate_rate_rollups).where(eq(gate_rate_rollups.event_id, eventId))).map(
          (r): GateRateRollupRow => ({
            event_id: r.event_id, checkpoint_id: r.checkpoint_id, minute_start: r.minute_start, scans: r.scans, admitted: r.admitted, denied: r.denied,
            by_tier_jsonb: (r.by_tier_jsonb ?? {}) as GateRateRollupRow["by_tier_jsonb"],
            by_result_jsonb: (r.by_result_jsonb ?? {}) as Record<string, number>,
          }),
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
        const r = await rotateSession(db, {
          tokenHash: i.tokenHash, newTokenHash: i.newTokenHash, ttl: i.ttl, now: i.now,
          userAgent: i.userAgent ?? null, ip: i.ip ?? null, graceSeconds: i.graceSeconds ?? 0,
        });
        return { status: r.status, family_id: r.family_id, user_id: r.user_id, attendee_id: r.attendee_id, mfa_at: r.mfa_at, expires_at: r.expires_at, reissued: r.reissued };
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
  // A fresh in-memory database starts from @synan/db's cached migrated snapshot (~0.4 s instead of ~3.5 s).
  const client = opts.dataDir
    ? new PGlite({ dataDir: opts.dataDir, extensions: { btree_gist } })
    : await (await import("@synan/db/testing")).createMigratedPglite();
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
