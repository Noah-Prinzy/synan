/**
 * In-memory repository implementation. Single-process only; state is lost on restart.
 *
 * DOES NOT ENCRYPT. Attendee identity, MFA secrets and signing private keys are held in the clear
 * in process memory (there is no storage to protect). Observable behaviour matches the SQL
 * repository, including sign-in state semantics; use the SQL repository (`pglite` / `postgres`)
 * for anything where data at rest matters.
 */
import { createHash, randomUUID } from "node:crypto";
import { entryHash, GENESIS_HASH, verifyChain } from "../domain/audit.js";
import type {
  FixtureWriter,
  AccessRuleRow,
  AttendeeRow,
  AuditRow,
  BreachAlertRow,
  WsChannelPath,
  CarrierRow,
  CheckpointRow,
  CredentialRow,
  EventRoomRow,
  EventRow,
  GateRateRollupRow,
  InvitationRow,
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
  organizations = new Map<string, { id: string; name: string; timezone: string; support_email: string }>();
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
  /** registration id → the invitation it redeemed. */
  registrationInvitation = new Map<string, string>();
  invitations = new Map<string, InvitationRow>();
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
  /** token hash → session (mirrors public.auth_sessions). */
  authSessions = new Map<string, MemSession>();
  /** token hash → link (mirrors public.auth_links). */
  authLinks = new Map<string, { attendee_id: string; created_at: Date; expires_at: Date; redeemed_at: Date | null }>();
  /** ticket hash → ticket (mirrors public.ws_tickets). */
  wsTickets = new Map<string, MemTicket>();
}

interface MemSession {
  family_id: string;
  user_id: string | null;
  attendee_id: string | null;
  mfa_at: Date | null;
  created_at: Date;
  rotated_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
}
interface MemTicket {
  user_id: string | null;
  attendee_id: string | null;
  session_family_id: string | null;
  channel: WsChannelPath;
  event_id: string | null;
  checkpoint_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
}

const clone = <T>(v: T): T => structuredClone(v);

/* State machines (01 §5.2), mirroring @synan/db migration 0012's guard triggers. */
const CREDENTIAL_MOVES = new Set([
  "issued>active", "issued>suspended_review", "issued>revoked", "issued>replaced",
  "active>suspended_review", "active>revoked", "active>replaced",
  "suspended_review>active", "suspended_review>revoked", "suspended_review>replaced",
]);
const CARRIER_MOVES = new Set([
  "stock>assigned", "stock>retired", "assigned>stock", "assigned>bound", "assigned>lost", "assigned>retired",
  "bound>active", "bound>lost", "bound>retired", "active>lost", "active>retired",
]);
const LIVE_CARRIER = new Set(["assigned", "bound", "active"]);

/** Blind index stand-in for the in-memory store (it does not encrypt; SQL uses the keyed HMAC). */
const memEmailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

function memoryFixtures(t: MemoryTables): FixtureWriter {
  return {
    async organization(r) { t.organizations.set(r.id, clone(r)); },
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
  // Revocation epoch, mirroring @synan/db 0012's triggers: bumped whenever access shrinks.
  const bumpEvent = (eventId: string) => {
    const e = t.events.get(eventId);
    if (e) e.revocation_epoch += 1;
  };
  const bumpForCredential = (c: CredentialRow) => {
    if (c.registration_id) {
      const r = t.registrations.get(c.registration_id);
      if (r) bumpEvent(r.event_id);
    } else {
      for (const e of t.events.values()) if (e.state === "published" || e.state === "live") e.revocation_epoch += 1;
    }
  };
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
      async update(id, patch) {
        const a = t.attendees.get(id);
        if (!a) return false;
        Object.assign(a, clone(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))));
        return true;
      },
      async byIds(ids) {
        return ids.flatMap((id) => (t.attendees.has(id) ? [clone(t.attendees.get(id)!)] : []));
      },
      async list({ after, limit }) {
        return [...t.attendees.values()].sort((a, b) => a.id.localeCompare(b.id)).filter((a) => !after || a.id > after).slice(0, limit).map(clone);
      },
    },
    invitations: {
      hashEmail: memEmailHash,
      hashCandidates: (email) => [memEmailHash(email)],
      async insert(row) {
        for (const i of t.invitations.values()) {
          if (i.event_id === row.event_id && i.email_hash === row.email_hash && i.state === "sent") return "duplicate";
        }
        t.invitations.set(row.id, clone(row));
        return "ok";
      },
      async byTokenHash(h) {
        for (const i of t.invitations.values()) if (i.token_hash === h) return clone(i);
        return null;
      },
      async consume(id, outcome, now) {
        const i = t.invitations.get(id);
        if (!i || i.state !== "sent" || i.expires_at.getTime() <= now.getTime()) return false;
        i.state = outcome;
        if (outcome === "redeemed") i.redeemed_at = now;
        return true;
      },
      async forEvent(eventId) {
        return [...t.invitations.values()].filter((i) => i.event_id === eventId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map(clone);
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
      async organizations() {
        return [...t.organizations.values()].map(clone);
      },
      async listVenues({ after, limit }) {
        return [...t.venues.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter((v) => !after || v.id > after)
          .slice(0, limit)
          .map(clone);
      },
      async zone(id) {
        const z = t.zones.get(id);
        return z ? clone(z) : null;
      },
      async roomsOfVenue(venueId) {
        return [...t.rooms.values()].filter((r) => r.venue_id === venueId).map(clone);
      },
      async updateVenue(id, p) {
        const v = t.venues.get(id);
        if (!v) throw new Error(`venue ${id} not found`);
        Object.assign(v, clone(p));
        return clone(v);
      },
      async updateZone(id, p) {
        const z = t.zones.get(id);
        if (!z) throw new Error(`zone ${id} not found`);
        Object.assign(z, clone(p));
        return clone(z);
      },
      async updateRoom(id, p) {
        const r = t.rooms.get(id);
        if (!r) throw new Error(`room ${id} not found`);
        Object.assign(r, clone(p));
        return clone(r);
      },
      async updateCheckpoint(id, p) {
        const c = t.checkpoints.get(id);
        if (!c) throw new Error(`checkpoint ${id} not found`);
        Object.assign(c, clone(p));
        return clone(c);
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
      async listAll({ state, q, after, limit }) {
        const needle = q?.toLowerCase();
        return [...t.events.values()]
          .filter((e) => (!state || e.state === state) && (!needle || e.title.toLowerCase().includes(needle)))
          .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime() || a.id.localeCompare(b.id))
          .filter((e) => !after || e.starts_at.getTime() > after.starts_at.getTime() || (e.starts_at.getTime() === after.starts_at.getTime() && e.id > after.id))
          .slice(0, limit)
          .map(clone);
      },
      async update(id, p) {
        const e = t.events.get(id);
        if (!e) throw new Error(`event ${id} not found`);
        // Mirrors the database trigger: closing stamps closed_at (starts the retention clock).
        if (p.state === "closed" && e.state !== "closed" && !e.closed_at) e.closed_at = new Date(Date.now());
        Object.assign(e, clone(p));
        return clone(e);
      },
      async setRooms(eventId, rooms) {
        t.eventRooms = t.eventRooms.filter((r) => r.event_id !== eventId).concat(rooms.map(clone));
      },
      async replaceAccessRules(eventId, expectedVersion, rules) {
        const e = t.events.get(eventId);
        if (!e || e.access_rules_version !== expectedVersion) return null;
        for (const [id, r] of t.accessRules) if (r.event_id === eventId) t.accessRules.delete(id);
        for (const r of rules) t.accessRules.set(r.id, clone(r));
        e.access_rules_version = expectedVersion + 1;
        e.revocation_epoch += 1; // a republish can shrink access (access_rules_bump_epoch)
        return e.access_rules_version;
      },
    },
    registrations: {
      async forEvent(eventId) {
        return [...t.registrations.values()].filter((r) => r.event_id === eventId).map(clone);
      },
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
      async insert(row) {
        const { invitation_id, ...reg } = row;
        for (const r of t.registrations.values()) if (r.event_id === reg.event_id && r.attendee_id === reg.attendee_id) return "duplicate";
        if (invitation_id && [...t.registrationInvitation.values()].includes(invitation_id)) return "duplicate";
        t.registrations.set(reg.id, clone(reg));
        if (invitation_id) t.registrationInvitation.set(reg.id, invitation_id);
        return "ok";
      },
      async update(id, patch) {
        const r = t.registrations.get(id);
        if (!r) throw new Error(`registration ${id} not found`);
        const bump = (patch.tier !== undefined && patch.tier !== r.tier) || (r.state === "confirmed" && patch.state !== undefined && patch.state !== "confirmed");
        Object.assign(r, clone(patch));
        if (bump) bumpEvent(r.event_id);
        return clone(r);
      },
      async countByAttendee(ids) {
        const want = new Set(ids);
        const out = new Map<string, number>();
        for (const r of t.registrations.values()) {
          if (want.has(r.attendee_id) && r.state !== "cancelled") out.set(r.attendee_id, (out.get(r.attendee_id) ?? 0) + 1);
        }
        return out;
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
        const from = c.state;
        if (patch.state !== undefined && patch.state !== from && !CREDENTIAL_MOVES.has(`${from}>${patch.state}`)) {
          throw new Error(`check_violation: credential ${id} cannot move from ${from} to ${patch.state}`);
        }
        Object.assign(c, patch);
        const to = c.state;
        if (from !== to && (to === "revoked" || to === "suspended_review" || to === "replaced" || (from === "suspended_review" && to === "active"))) {
          bumpForCredential(c);
        }
        return clone(c);
      },
    },
    carriers: {
      async byIdentifier(kind, identifier) {
        // Newest first, retired last: a retired emailed code must still resolve (it reads as spent).
        const all = [...t.carriers.values()].filter((c) => c.kind === kind && c.identifier === identifier);
        all.sort((a, b) => Number(a.state === "retired") - Number(b.state === "retired"));
        return all[0] ? clone(all[0]) : null;
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
        const from = c.state;
        if (patch.state !== undefined && patch.state !== from && !CARRIER_MOVES.has(`${from}>${patch.state}`)) {
          throw new Error(`check_violation: carrier ${id} cannot move from ${from} to ${patch.state}`);
        }
        Object.assign(c, patch);
        if (c.credential_id && LIVE_CARRIER.has(from) && (c.state === "lost" || c.state === "retired")) {
          const cred = t.credentials.get(c.credential_id);
          if (cred) bumpForCredential(cred);
        }
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
      async find(eventId, credentialId) {
        return t.ephemeralIds.get(`${eventId}:${credentialId}`) ?? null;
      },
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
      async page(eventId, { checkpointId, result, ephemeralId, limit, before }) {
        const all = [...t.scans.values()]
          .filter((s) => s.event_id === eventId && (!checkpointId || s.checkpoint_id === checkpointId) && (!result || s.result === result) && (!ephemeralId || s.ephemeral_id === ephemeralId))
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
      async list({ eventId, state, severity, checkpointIds, limit }) {
        const scope = checkpointIds ? new Set(checkpointIds) : null;
        return [...t.alerts.values()]
          .filter((a) => (!eventId || a.event_id === eventId) && (!state || a.state === state) && (!severity || a.severity === severity))
          .filter((a) => !scope || (a.checkpoint_id !== null && scope.has(a.checkpoint_id)))
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
    // Same semantics as @synan/db migration 0004 (auth_rotate_session, auth_redeem_link,
    // ws_consume_ticket, auth_cleanup). Each method is synchronous between read and write, so it is
    // atomic in-process the way the SQL functions are atomic under row locks.
    auth: {
      async startSession(i) {
        t.authSessions.set(i.tokenHash, {
          family_id: i.familyId, user_id: i.holder.userId ?? null, attendee_id: i.holder.attendeeId ?? null,
          mfa_at: i.mfaAt, created_at: i.now, rotated_at: null, expires_at: i.expiresAt, revoked_at: null,
        });
      },
      async rotateSession({ tokenHash, newTokenHash, ttl, now }) {
        const s = t.authSessions.get(tokenHash);
        if (!s) return { status: "invalid", family_id: null, user_id: null, attendee_id: null, mfa_at: null, expires_at: null };
        const out = { family_id: s.family_id, user_id: s.user_id, attendee_id: s.attendee_id, mfa_at: s.mfa_at, expires_at: s.expires_at };
        if (s.revoked_at) return { status: "revoked", ...out };
        if (s.rotated_at) {
          for (const x of t.authSessions.values()) if (x.family_id === s.family_id && !x.revoked_at) x.revoked_at = now;
          return { status: "reuse_detected", ...out };
        }
        if (s.expires_at.getTime() <= now.getTime()) return { status: "expired", ...out };
        s.rotated_at = now;
        // Lifetime by holder kind, chosen in the same step (as auth_rotate_session_by_kind does).
        const expiresAt = new Date(now.getTime() + (s.user_id ? ttl.userSeconds : ttl.attendeeSeconds) * 1000);
        t.authSessions.set(newTokenHash, { ...s, created_at: now, rotated_at: null, expires_at: expiresAt, revoked_at: null });
        return { status: "rotated", ...out, expires_at: expiresAt };
      },
      async revokeFamily(familyId, _reason, now) {
        let n = 0;
        for (const s of t.authSessions.values()) {
          if (s.family_id === familyId && !s.revoked_at) {
            s.revoked_at = now;
            n++;
          }
        }
        return n;
      },
      async createLink({ tokenHash, attendeeId, expiresAt, now }) {
        t.authLinks.set(tokenHash, { attendee_id: attendeeId, created_at: now, expires_at: expiresAt, redeemed_at: null });
      },
      async redeemLink(tokenHash, now) {
        const l = t.authLinks.get(tokenHash);
        if (!l) return { status: "invalid", attendee_id: null };
        if (l.redeemed_at) return { status: "already_redeemed", attendee_id: l.attendee_id };
        if (l.expires_at.getTime() <= now.getTime()) return { status: "expired", attendee_id: l.attendee_id };
        l.redeemed_at = now;
        return { status: "redeemed", attendee_id: l.attendee_id };
      },
      async mintTicket(i) {
        t.wsTickets.set(i.ticketHash, {
          user_id: i.holder.userId ?? null, attendee_id: i.holder.attendeeId ?? null, session_family_id: i.sessionFamilyId,
          channel: i.channel, event_id: i.eventId, checkpoint_id: i.checkpointId, expires_at: i.expiresAt, consumed_at: null,
        });
      },
      async consumeTicket(ticketHash, now) {
        const r = t.wsTickets.get(ticketHash);
        const none = { user_id: null, attendee_id: null, session_family_id: null, channel: null, event_id: null, checkpoint_id: null };
        if (!r) return { status: "invalid", ...none };
        if (r.consumed_at) return { status: "already_consumed", ...none };
        r.consumed_at = now;
        const out = {
          user_id: r.user_id, attendee_id: r.attendee_id, session_family_id: r.session_family_id,
          channel: r.channel, event_id: r.event_id, checkpoint_id: r.checkpoint_id,
        };
        if (r.expires_at.getTime() <= now.getTime()) return { status: "expired", ...out };
        if (r.session_family_id) {
          const live = [...t.authSessions.values()].some(
            (s) => s.family_id === r.session_family_id && !s.revoked_at && s.expires_at.getTime() > now.getTime(),
          );
          if (!live) return { status: "revoked", ...out };
        }
        return { status: "valid", ...out };
      },
      async cleanup(now) {
        const keep = 30 * 86400_000;
        const n = { sessions: 0, links: 0, tickets: 0 };
        for (const [k, s] of t.authSessions) {
          if (s.expires_at.getTime() < now.getTime() - keep || (s.revoked_at && s.revoked_at.getTime() < now.getTime() - keep)) {
            t.authSessions.delete(k);
            n.sessions++;
          }
        }
        for (const [k, l] of t.authLinks) {
          if (l.expires_at.getTime() < now.getTime() - keep || (l.redeemed_at && l.redeemed_at.getTime() < now.getTime() - keep)) {
            t.authLinks.delete(k);
            n.links++;
          }
        }
        for (const [k, r] of t.wsTickets) {
          if (r.expires_at.getTime() < now.getTime() - 10 * 60_000) {
            t.wsTickets.delete(k);
            n.tickets++;
          }
        }
        return n;
      },
    },
  };
}
