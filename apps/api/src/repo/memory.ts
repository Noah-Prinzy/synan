/**
 * In-memory repository implementation. Single-process only; state is lost on
 * restart. Used for dev and tests until the Drizzle implementation lands.
 */
import { randomUUID } from "node:crypto";
import { entryHash, GENESIS_HASH, verifyChain } from "../domain/audit.js";
import type {
  FixtureWriter,
  AccessRuleRow,
  AttendeeRow,
  AuditRow,
  AuthLinkRow,
  AuthSessionRow,
  BreachAlertRow,
  CarrierRow,
  CheckpointRow,
  CredentialRow,
  EventRoomRow,
  EventRow,
  GateRateRollupRow,
  OccupancyAdjustmentRow,
  RegistrationRow,
  Repos,
  RoomRow,
  ScanRow,
  SessionRow,
  SigningKeyRow,
  StaffAssignmentRow,
  TransitTimeRow,
  UserRow,
  VenueRow,
  ZoneRow,
} from "./types.js";

export class MemoryTables {
  users = new Map<string, UserRow>();
  attendees = new Map<string, AttendeeRow>();
  venues = new Map<string, VenueRow>();
  zones = new Map<string, ZoneRow>();
  rooms = new Map<string, RoomRow>();
  checkpoints = new Map<string, CheckpointRow>();
  transitTimes: TransitTimeRow[] = [];
  events = new Map<string, EventRow>();
  eventRooms: EventRoomRow[] = [];
  sessions = new Map<string, SessionRow>();
  registrations = new Map<string, RegistrationRow>();
  accessRules = new Map<string, AccessRuleRow>();
  staffAssignments = new Map<string, StaffAssignmentRow>();
  credentials = new Map<string, CredentialRow>();
  carriers = new Map<string, CarrierRow>();
  signingKeys = new Map<string, SigningKeyRow>();
  ephemeralIds = new Map<string, string>(); // `${event}:${credential}` → ephemeral id
  scans = new Map<string, ScanRow>();
  scansByIdem = new Map<string, string>(); // `${event}:${idem}` → scan id
  adjustments: OccupancyAdjustmentRow[] = [];
  alerts = new Map<string, BreachAlertRow>();
  audit: AuditRow[] = [];
  gateRates = new Map<string, GateRateRollupRow>();
  authSessions = new Map<string, AuthSessionRow>();
  authLinks = new Map<string, AuthLinkRow>();
}

const clone = <T>(v: T): T => structuredClone(v);

function memoryFixtures(t: MemoryTables): FixtureWriter {
  return {
    async organization() {},
    async venue(r) { t.venues.set(r.id, clone(r)); },
    async zone(r) { t.zones.set(r.id, clone(r)); },
    async room(r) { t.rooms.set(r.id, clone(r)); },
    async checkpoint(r) { t.checkpoints.set(r.id, clone(r)); },
    async transitTime(r) { t.transitTimes.push(clone(r)); },
    async event(r) { t.events.set(r.id, clone(r)); },
    async eventRoom(r) { t.eventRooms.push(clone(r)); },
    async session(r) { t.sessions.set(r.id, clone(r)); },
    async registration(r) { t.registrations.set(r.id, clone(r)); },
    async accessRule(r) { t.accessRules.set(r.id, clone(r)); },
    async staffAssignment(r) {
      // Overlapping assignments for one person are rejected (01 §3), as the DB's exclusion constraint does.
      for (const a of t.staffAssignments.values()) {
        if (a.user_id === r.user_id && a.shift_start < r.shift_end && r.shift_start < a.shift_end) {
          throw new Error("staff_assignments_no_overlap: overlapping assignment for this user");
        }
      }
      t.staffAssignments.set(r.id, clone(r));
    },
  };
}
const correctedMs = (s: ScanRow) => s.occurred_at.getTime() + s.clock_offset_ms;

export function createMemoryRepos(t: MemoryTables = new MemoryTables()): Repos & { tables: MemoryTables } {
  return {
    kind: "memory",
    tables: t,
    fixtures: memoryFixtures(t),
    users: {
      async byEmail(email) {
        const e = email.toLowerCase();
        for (const u of t.users.values()) if (u.email.toLowerCase() === e) return clone(u);
        return null;
      },
      async byId(id) {
        const u = t.users.get(id);
        return u ? clone(u) : null;
      },
      async insert(row) {
        t.users.set(row.id, clone(row));
      },
      async setMfa(id, secret, at) {
        const u = t.users.get(id);
        if (u) Object.assign(u, { mfa_secret: secret, mfa_enrolled_at: at });
      },
    },
    attendees: {
      async byEmail(email) {
        const e = email.toLowerCase();
        for (const a of t.attendees.values()) if (a.email?.toLowerCase() === e) return clone(a);
        return null;
      },
      async byId(id) {
        const a = t.attendees.get(id);
        return a ? clone(a) : null;
      },
      async insert(row) {
        t.attendees.set(row.id, clone(row));
      },
    },
    venues: {
      async zonesOfVenue(venueId) {
        return [...t.zones.values()].filter((z) => z.venue_id === venueId).map(clone);
      },
      async room(id) {
        const r = t.rooms.get(id);
        return r ? clone(r) : null;
      },
      async roomsByIds(ids) {
        return ids.flatMap((id) => (t.rooms.has(id) ? [clone(t.rooms.get(id)!)] : []));
      },
      async checkpoint(id) {
        const c = t.checkpoints.get(id);
        return c ? clone(c) : null;
      },
      async checkpointsOfVenue(venueId) {
        return [...t.checkpoints.values()].filter((c) => c.venue_id === venueId).map(clone);
      },
      async venue(id) {
        const v = t.venues.get(id);
        return v ? clone(v) : null;
      },
      async transitTimes(venueId) {
        return t.transitTimes.filter((x) => x.venue_id === venueId).map(clone);
      },
    },
    events: {
      async listPublic({ state, q, after, limit }) {
        const needle = q?.toLowerCase();
        return [...t.events.values()]
          .filter((e) => e.listed_bool && (e.state === "published" || e.state === "live"))
          .filter((e) => !state || e.state === state)
          .filter((e) => !needle || e.title.toLowerCase().includes(needle))
          .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime() || a.id.localeCompare(b.id))
          .filter(
            (e) =>
              !after ||
              e.starts_at.getTime() > after.starts_at.getTime() ||
              (e.starts_at.getTime() === after.starts_at.getTime() && e.id > after.id),
          )
          .slice(0, limit)
          .map(clone);
      },
      async bySlug(slug) {
        for (const e of t.events.values()) if (e.slug === slug) return clone(e);
        return null;
      },
      async byId(id) {
        const e = t.events.get(id);
        return e ? clone(e) : null;
      },
      async rooms(eventId) {
        return t.eventRooms.filter((r) => r.event_id === eventId).map(clone);
      },
      async sessions(eventId) {
        return [...t.sessions.values()].filter((s) => s.event_id === eventId).map(clone);
      },
      async accessRules(eventId) {
        return [...t.accessRules.values()].filter((r) => r.event_id === eventId).map(clone);
      },
    },
    registrations: {
      async byId(id) {
        const r = t.registrations.get(id);
        return r ? clone(r) : null;
      },
      async markCheckedIn(id, at) {
        const r = t.registrations.get(id);
        if (r && !r.checked_in_at) r.checked_in_at = at;
      },
      async forAttendee(attendeeId) {
        return [...t.registrations.values()].filter((r) => r.attendee_id === attendeeId).map(clone);
      },
    },
    staff: {
      async assignmentsFor(userId) {
        return [...t.staffAssignments.values()].filter((a) => a.user_id === userId).map(clone);
      },
    },
    credentials: {
      async byId(id) {
        const c = t.credentials.get(id);
        return c ? clone(c) : null;
      },
      async byTokenHash(hash) {
        for (const c of t.credentials.values()) if (c.token_hash === hash) return clone(c);
        return null;
      },
      async forRegistration(registrationId) {
        // The live credential: the newest that is not replaced.
        const all = [...t.credentials.values()].filter((c) => c.registration_id === registrationId);
        const live = all.filter((c) => c.state !== "replaced").sort((a, b) => b.issued_at.getTime() - a.issued_at.getTime());
        return live[0] ? clone(live[0]) : null;
      },
      async insert(row) {
        t.credentials.set(row.id, clone(row));
      },
      async update(id, patch) {
        const c = t.credentials.get(id);
        if (!c) throw new Error(`credential ${id} not found`);
        Object.assign(c, patch);
        return clone(c);
      },
    },
    carriers: {
      async byIdentifier(kind, identifier) {
        for (const c of t.carriers.values()) if (c.kind === kind && c.identifier === identifier) return clone(c);
        return null;
      },
      async forCredential(credentialId) {
        return [...t.carriers.values()].filter((c) => c.credential_id === credentialId).map(clone);
      },
      async insert(row) {
        t.carriers.set(row.id, clone(row));
      },
      async update(id, patch) {
        const c = t.carriers.get(id);
        if (!c) throw new Error(`carrier ${id} not found`);
        Object.assign(c, patch);
        return clone(c);
      },
      async redeemOnce(id, at) {
        const c = t.carriers.get(id);
        if (!c || c.redeemed_at) return false;
        c.redeemed_at = at;
        return true;
      },
    },
    signingKeys: {
      async all() {
        return [...t.signingKeys.values()].map(clone);
      },
      async insert(row) {
        t.signingKeys.set(row.id, clone(row));
      },
      async retire(id, at) {
        const k = t.signingKeys.get(id);
        if (k && !k.retired_at) k.retired_at = at;
      },
    },
    ephemeralIds: {
      async getOrCreate(eventId, credentialId) {
        const k = `${eventId}:${credentialId}`;
        let v = t.ephemeralIds.get(k);
        if (!v) {
          v = randomUUID();
          t.ephemeralIds.set(k, v);
        }
        return v;
      },
    },
    scans: {
      async byIdemKey(eventId, idemKey) {
        const id = t.scansByIdem.get(`${eventId}:${idemKey}`);
        return id ? clone(t.scans.get(id)!) : null;
      },
      async insert(row) {
        const k = `${row.event_id}:${row.idem_key}`;
        if (t.scansByIdem.has(k)) throw new Error("unique violation: scans(event_id, idem_key)");
        t.scans.set(row.id, clone(row));
        t.scansByIdem.set(k, row.id);
      },
      async forEvent(eventId) {
        return [...t.scans.values()].filter((s) => s.event_id === eventId).sort((a, b) => correctedMs(a) - correctedMs(b)).map(clone);
      },
      async page(eventId, { checkpointId, result, limit, before }) {
        const all = [...t.scans.values()]
          .filter((s) => s.event_id === eventId && (!checkpointId || s.checkpoint_id === checkpointId) && (!result || s.result === result))
          .sort((a, b) => b.received_at.getTime() - a.received_at.getTime() || b.id.localeCompare(a.id));
        const start = before ? all.findIndex((s) => s.id === before) + 1 : 0;
        return all.slice(start, start + limit).map(clone);
      },
    },
    occupancy: {
      async insertAdjustment(row) {
        t.adjustments.push(clone(row));
      },
      async adjustments(eventId) {
        return t.adjustments.filter((a) => a.event_id === eventId).map(clone);
      },
    },
    alerts: {
      async insert(row) {
        t.alerts.set(row.id, clone(row));
      },
      async byId(id) {
        const a = t.alerts.get(id);
        return a ? clone(a) : null;
      },
      async update(id, patch) {
        const a = t.alerts.get(id);
        if (!a) throw new Error(`alert ${id} not found`);
        Object.assign(a, patch);
        return clone(a);
      },
      async list({ eventId, state, severity, limit }) {
        return [...t.alerts.values()]
          .filter((a) => (!eventId || a.event_id === eventId) && (!state || a.state === state) && (!severity || a.severity === severity))
          .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())
          .slice(0, limit)
          .map(clone);
      },
    },
    audit: {
      // Synchronous between read of the head and push, so the chain cannot fork in-process.
      async append(entry) {
        const prev = t.audit[t.audit.length - 1]?.hash ?? GENESIS_HASH;
        const row: AuditRow = { id: String(t.audit.length + 1), ...clone(entry), prev_hash: prev, hash: "" };
        row.hash = entryHash(prev, row);
        t.audit.push(row);
        return clone(row);
      },
      async all() {
        return t.audit.map(clone);
      },
      async verify() {
        return verifyChain(t.audit);
      },
    },
    rollups: {
      async incrementGateRate(key, inc) {
        const k = `${key.event_id}:${key.checkpoint_id}:${key.minute_start.toISOString()}`;
        let row = t.gateRates.get(k);
        if (!row) {
          row = { ...key, scans: 0, admitted: 0, denied: 0, by_tier_jsonb: {} };
          t.gateRates.set(k, row);
        }
        row.scans += 1;
        row.admitted += inc.admitted;
        row.denied += inc.denied;
        const tiers = row.by_tier_jsonb as Record<string, number>;
        tiers[inc.tier] = (tiers[inc.tier] ?? 0) + 1;
      },
      async gateRates(eventId) {
        return [...t.gateRates.values()].filter((r) => r.event_id === eventId).map(clone);
      },
    },
    auth: {
      async insertSession(row) {
        t.authSessions.set(row.id, clone(row));
      },
      async sessionByRefreshHash(hash) {
        for (const s of t.authSessions.values()) if (s.refresh_hash === hash) return clone(s);
        return null;
      },
      async markSessionUsed(id, at) {
        const s = t.authSessions.get(id);
        if (!s || s.used_at) return false;
        s.used_at = at;
        return true;
      },
      async revokeFamily(familyId, at) {
        for (const s of t.authSessions.values()) if (s.family_id === familyId && !s.revoked_at) s.revoked_at = at;
      },
      async insertLink(row) {
        t.authLinks.set(row.token_hash, clone(row));
      },
      async consumeLink(tokenHash, at) {
        const l = t.authLinks.get(tokenHash);
        if (!l || l.used_at || l.expires_at.getTime() <= at.getTime()) return null;
        l.used_at = at;
        return clone(l);
      },
    },
  };
}
