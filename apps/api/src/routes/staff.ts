/**
 * Slice 6 — staff (01 §3, P-15, 03 §3–§4).
 *
 * - Assignments bind a staff user to a checkpoint for a shift; overlapping shifts for one person are
 *   refused (409), as the database's exclusion constraint does. Optionally tied to one event, which
 *   then scopes the offline allowlist.
 * - Handover: the assignee (or an operator) closes the shift with a summary of admitted, refused and
 *   offline-synced scans. Server time stamps it.
 * - Invite: an admin creates a staff user without a password; a one-time activation link (stored
 *   hashed, 72 h) lets them set one, in the role's own app (the Gate Scanner for security staff, the
 *   Admin Command otherwise), the token in the fragment. An account never activated may be invited
 *   again (the earlier links stop working). Attendees are never users.
 * - MFA enrolment (O-22): a pending TOTP secret is shown once and becomes active when a code from it
 *   is confirmed. Re-enrolling an enrolled account needs a fresh MFA step-up.
 * - Heartbeat (O-22): the scanner's REST heartbeat feeds gate health, for its current checkpoint only.
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { BRAND } from "../brand.js";
import { currentAssignments, deskEventIds, noteScanner } from "../domain/scope.js";
import { mount } from "../http/route.js";
import { hashPassword, newTotpSecret, verifyTotp } from "../lib/crypto.js";
import type { InviteStatus, StaffAssignmentRow, UserRow } from "../repo/types.js";
import type { Config } from "../config.js";
import type { Role } from "@synan/contracts/enums";

const ENROL_TTL_MS = 10 * 60_000;
const STAFF_ROLES = new Set(["security_staff", "speaker", "crew", "desk_clerk"]);
/** The registry entries a role may call, by name (D-23): the console builds its screens from this, never a copy of the matrix. */
export const capabilitiesOf = (role: string): string[] =>
  (Object.entries(endpoints) as [string, { access: readonly string[] }][]).filter(([, e]) => e.access.includes(role)).map(([name]) => name).sort();
const DENIED = new Set(["denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"]);

/**
 * The app a role's account is used in, so where its activation link opens (01 §2–§3): the Gate
 * Scanner for security staff; the Admin Command for every other role (speakers and crew have no
 * console, and the console tells them so after they sign in). The token travels in the fragment,
 * never the path or the query, so it reaches no server log, proxy or Referer header.
 */
export function activationLink(config: Pick<Config, "adminAppUrl" | "scannerAppUrl">, role: Role, token: string): string {
  return `${role === "security_staff" ? config.scannerAppUrl : config.adminAppUrl}/activate#token=${token}`;
}

/** The invitation email for a role: the link, what it is for, and that it works once for 72 hours. */
export function inviteMail(config: Pick<Config, "adminAppUrl" | "scannerAppUrl">, role: Role, token: string) {
  const link = activationLink(config, role, token);
  const then =
    role === "security_staff"
      ? "then sign in to the Gate Scanner on your gate's phone or tablet."
      : role === "speaker" || role === "crew"
        ? "then sign in to see your account. Your role has no console: at the event, your access is your credential."
        : "then sign in to the Admin Command.";
  return {
    subject: `${BRAND.name}: activate your staff account`,
    text: `Set your password with this link (it works once, for 72 hours), ${then}\n\n${link}\n\nIf the link has expired, ask an admin to send you a new invitation. If you did not expect this email, ignore it: nothing happens unless the link is used.`,
  };
}

const activationRefused = (status: InviteStatus | "valid" | "consumed") =>
  status === "expired"
    ? new ContractError("LINK_EXPIRED", "This activation link has expired. Ask an admin to send you a new invitation.")
    : new ContractError("LINK_INVALID", "This activation link is not valid, or was already used. Ask an admin to send you a new invitation.");

export const assignmentDto =(a: StaffAssignmentRow) => ({
  id: a.id, user_id: a.user_id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start.toISOString(), shift_end: a.shift_end.toISOString(),
  event_id: a.event_id ?? null, handed_over_at: a.handed_over_at?.toISOString() ?? null,
});
const staffDto = (u: UserRow) => ({ id: u.id, email: u.email, role: u.role, mfa_enrolled: u.mfa_enrolled_at !== null, display_name: u.display_name || null });
const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const offsetCursor = (c: string | undefined) => {
  if (!c) return 0;
  const n = Number(c);
  if (!Number.isInteger(n) || n < 0) throw invalid("query.cursor", "invalid cursor");
  return n;
};

/** The event a shift works: its own, else the venue's published or live event overlapping it (live first, then earliest). */
export async function shiftEvent(app: AppContext, a: StaffAssignmentRow, venueId: string) {
  if (a.event_id) return app.repos.events.byId(a.event_id);
  const candidates = (await app.repos.events.listAll({ limit: 1000 })).filter(
    (e) => e.venue_id === venueId && (e.state === "published" || e.state === "live") && e.starts_at && e.ends_at
      && e.starts_at.getTime() < a.shift_end.getTime() && a.shift_start.getTime() < e.ends_at.getTime(),
  );
  candidates.sort((p, q) => (p.state === "live" ? 0 : 1) - (q.state === "live" ? 0 : 1) || p.starts_at!.getTime() - q.starts_at!.getTime());
  return candidates[0] ?? null;
}

export function staffRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Record<string, unknown> = {}) => app.audit.append({ actorId: actor, action, target, meta });

  mount(x, app, endpoints.listStaff, async ({ query }) => {
    const rows = await app.repos.users.list({ after: query.cursor, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(staffDto), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });

  mount(x, app, endpoints.inviteStaff, async ({ body, ctx }) => {
    const existing = await app.repos.users.byEmail(body.email);
    // An account that was invited but never activated may be invited again (the earlier links stop
    // working); an activated one may not: this is no way to reset someone's password.
    if (existing && existing.password_hash !== "") throw new ContractError("CONFLICT", "A user with this address already exists.");
    const user: UserRow = existing
      ? { ...existing, role: body.role }
      : { id: randomUUID(), email: body.email, password_hash: "", role: body.role, mfa_enrolled_at: null, mfa_secret: null, display_name: body.display_name?.trim() || null };
    // The account, its activation token and the email are one unit of work.
    await app.repos.transaction(async (s) => {
      if (!existing) await s.repos.users.insert(user);
      else if (existing.role !== user.role) await s.repos.users.setRole(user.id, user.role);
      const token = await s.repos.userInvites.create({ userId: user.id, createdBy: ctx!.sub, now: new Date(app.clock.now()) });
      await app.mail.send({ to: body.email, tag: "staff.invite", ...inviteMail(app.config, user.role, token) }, s);
    });
    await audit(ctx!.sub, "staff.invite", `user:${user.id}`, {
      role: user.role,
      ...(existing ? { reinvite: true, ...(existing.role !== user.role ? { from_role: existing.role } : {}) } : {}),
    });
    return staffDto(user);
  });

  // Public, behind the `auth` rate limit (per address, failures only, like sign-in). The token is the
  // only input: neither call takes or answers an email address, so neither says whether an account exists.
  mount(x, app, endpoints.checkActivation, async ({ body, ip }) => {
    const r = await app.repos.userInvites.peek(body.token, new Date(app.clock.now()));
    if (r.status !== "valid") {
      // A link that cannot be used answers 200 with its state, but counts as a failed attempt, so the
      // check is no unlimited oracle for guessed tokens (the same bucket the route checks before calling).
      app.rateLimiter.hit(`ip:${ip}:${endpoints.checkActivation.path}`, app.config.rateLimits.authPerMin, 60_000);
      return { state: r.status === "expired" ? ("expired" as const) : r.status === "already_used" ? ("used" as const) : ("invalid" as const) };
    }
    const u = r.userId ? await app.repos.users.byId(r.userId) : null;
    if (!u || !r.expiresAt) return { state: "invalid" as const };
    return { state: "valid" as const, role: u.role, expires_at: r.expiresAt.toISOString() };
  });

  mount(x, app, endpoints.activateStaff, async ({ body }) => {
    // Refuse a dead link before the (deliberately slow) password hash, then spend the link and set the
    // password in one unit of work: a failure leaves the link usable, and a link works exactly once.
    const peek = await app.repos.userInvites.peek(body.token, new Date(app.clock.now()));
    if (peek.status !== "valid") throw activationRefused(peek.status);
    const hash = await hashPassword(body.password);
    const userId = await app.repos.transaction(async (s) => {
      const r = await s.repos.userInvites.consume(body.token, new Date(app.clock.now()));
      if (r.status !== "consumed" || !r.userId) throw activationRefused(r.status);
      await s.repos.users.setPassword(r.userId, hash);
      return r.userId;
    });
    await app.audit.append({ actorId: userId, action: "staff.activate", target: `user:${userId}`, meta: {} });
    return { ok: true as const };
  });

  /** An assignment with the gate's label and the person's name (operator lists, 06 D6.6). */
  const labelled = async (rows: StaffAssignmentRow[]) => {
    const labels = new Map<string, string>();
    const names = new Map<string, string>();
    for (const a of rows) {
      if (!labels.has(a.checkpoint_id)) labels.set(a.checkpoint_id, (await app.repos.venues.checkpoint(a.checkpoint_id))?.label ?? "");
      if (!names.has(a.user_id)) {
        const u = await app.repos.users.byId(a.user_id);
        names.set(a.user_id, u ? u.display_name || u.email : "");
      }
    }
    return rows.map((a) => ({ ...assignmentDto(a), checkpoint_label: labels.get(a.checkpoint_id)!, staff_name: names.get(a.user_id)! }));
  };

  mount(x, app, endpoints.listAssignments, async ({ query, ctx }) => {
    const offset = offsetCursor(query.cursor);
    if (ctx!.role === "supervisor") {
      // Who is on (or coming on) shift at a gate or for an event: gate, times and display name only.
      if (!query.checkpoint_id && !query.event_id) throw invalid("query.checkpoint_id", "name a checkpoint or an event");
      if (query.user_id) throw invalid("query.user_id", "not available to supervisors");
      const now = app.clock.now();
      const rows = (await app.repos.staff.list({ checkpointId: query.checkpoint_id, eventId: query.checkpoint_id ? undefined : query.event_id, offset: 0, limit: 5000 }))
        .filter((a) => a.shift_end.getTime() > now && !a.handed_over_at)
        // At a gate for an event: shifts tied to it, and the gate's shifts tied to none (they work whatever runs).
        .filter((a) => !query.checkpoint_id || !query.event_id || !a.event_id || a.event_id === query.event_id)
        .sort((a, b) => a.shift_start.getTime() - b.shift_start.getTime() || a.id.localeCompare(b.id));
      const page = rows.slice(offset, offset + query.limit);
      const labels = new Map<string, string>();
      const items = [];
      for (const a of page) {
        if (!labels.has(a.checkpoint_id)) labels.set(a.checkpoint_id, (await app.repos.venues.checkpoint(a.checkpoint_id))?.label ?? "");
        const name = (await app.repos.users.byId(a.user_id))?.display_name?.trim();
        items.push({
          id: a.id, user_id: a.user_id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start.toISOString(), shift_end: a.shift_end.toISOString(),
          event_id: a.event_id ?? null, checkpoint_label: labels.get(a.checkpoint_id)!, ...(name ? { staff_name: name } : {}),
        });
      }
      return { items, next_cursor: rows.length > offset + query.limit ? String(offset + query.limit) : null };
    }
    const rows = await app.repos.staff.list({ checkpointId: query.checkpoint_id, userId: query.user_id, eventId: query.event_id, offset, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: await labelled(page), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });

  mount(x, app, endpoints.createAssignment, async ({ body, ctx }) => {
    const user = await app.repos.users.byId(body.user_id);
    if (!user || !STAFF_ROLES.has(user.role)) throw invalid("body.user_id", "not a staff member");
    const cp = await app.repos.venues.checkpoint(body.checkpoint_id);
    if (!cp) throw invalid("body.checkpoint_id", "checkpoint not found");
    const start = new Date(body.shift_start);
    const end = new Date(body.shift_end);
    if (end.getTime() <= start.getTime()) throw invalid("body.shift_end", "shift_end must be after shift_start");
    if (body.event_id) {
      const e = await app.repos.events.byId(body.event_id);
      if (!e || e.venue_id !== cp.venue_id) throw invalid("body.event_id", "event is not at this checkpoint's venue");
    }
    // A desk clerk works one event's registration desk (D-23): a perimeter desk, tied to the event.
    if (user.role === "desk_clerk") {
      if (!body.event_id) throw invalid("body.event_id", "a desk clerk's shift names the event");
      if (!cp.perimeter_bool) throw invalid("body.checkpoint_id", "a desk is a perimeter checkpoint");
    }
    const row: StaffAssignmentRow = { id: randomUUID(), user_id: user.id, checkpoint_id: cp.id, shift_start: start, shift_end: end, event_id: body.event_id ?? null, handed_over_at: null };
    if ((await app.repos.staff.insert({ ...row, created_by: ctx!.sub })) === "overlap") {
      throw new ContractError("CONFLICT", "This person already has a shift overlapping that window.");
    }
    await audit(ctx!.sub, "staff_assignment.create", `staff_assignment:${row.id}`, { user_id: user.id, checkpoint_id: cp.id });
    return (await labelled([row]))[0]!;
  });

  mount(x, app, endpoints.myOperator, async ({ ctx }) => {
    const u = await app.repos.users.byId(ctx!.sub);
    if (!u) throw new ContractError("UNAUTHENTICATED");
    const shift = (await currentAssignments(app, u.id))[0] ?? null;
    const cp = shift ? await app.repos.venues.checkpoint(shift.checkpoint_id) : null;
    const shiftEv = shift && cp ? await shiftEvent(app, shift, cp.venue_id) : null;
    const shiftLabel = shift ? [cp?.label, shiftEv?.title].filter((s): s is string => !!s).join(" · ") || null : null;
    return {
      id: u.id, email: u.email, role: u.role, mfa_enrolled: u.mfa_enrolled_at !== null, mfa_fresh: app.auth.isMfaFresh(ctx!),
      display_name: u.display_name || null, shift_label: shiftLabel,
      current_shift: shift ? { ...assignmentDto(shift), checkpoint_label: cp?.label ?? "" } : null,
      // The token's role decides access; report that one (a role change applies at the next refresh).
      capabilities: capabilitiesOf(ctx!.role ?? u.role),
      ...(u.role === "desk_clerk" ? { desk_event_ids: await deskEventIds(app, u.id) } : {}),
    };
  });

  mount(x, app, endpoints.changeStaffRole, async ({ params, body, ctx }) => {
    const u = await app.repos.users.byId(params.id);
    if (!u) throw new ContractError("NOT_FOUND");
    if (u.id === ctx!.sub) throw new ContractError("CONFLICT", "You cannot change your own role.");
    if (u.role === body.role) return staffDto(u);
    await app.repos.users.setRole(u.id, body.role);
    await audit(ctx!.sub, "staff.role_change", `user:${u.id}`, { from: u.role, to: body.role, reason: body.reason });
    return staffDto({ ...u, role: body.role });
  });

  // The scanner's gate picker (06 S1): shifts not yet over and not handed over, each with its gate and
  // event, so pairing needs no other call. A shift without an event works the venue's event that is
  // published or live and overlaps the shift (the live one first, then the earliest).
  mount(x, app, endpoints.myAssignments, async ({ ctx }) => {
    const now = app.clock.now();
    const mine = (await app.repos.staff.assignmentsFor(ctx!.sub)).filter((a) => a.shift_end.getTime() > now && !a.handed_over_at);
    mine.sort((a, b) => a.shift_start.getTime() - b.shift_start.getTime());
    const items = [];
    // The event's rooms by name (the scanner's "rooms this pass opens" chips), once per event; names
    // only — no capacity or occupancy — so an unlisted event needs no public event read.
    const roomNames = new Map<string, { room_id: string; name: string }[]>();
    const roomsOf = async (eventId: string) => {
      let r = roomNames.get(eventId);
      if (!r) {
        const ids = (await app.repos.events.rooms(eventId)).map((x) => x.room_id);
        r = (await app.repos.venues.roomsByIds(ids)).map((x) => ({ room_id: x.id, name: x.name })).sort((p, q) => p.name.localeCompare(q.name) || (p.room_id < q.room_id ? -1 : 1));
        roomNames.set(eventId, r);
      }
      return r;
    };
    for (const a of mine) {
      const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
      if (!cp) continue;
      const zone = await app.repos.venues.zone(cp.zone_id);
      const room = cp.room_id ? await app.repos.venues.room(cp.room_id) : null;
      const event = await shiftEvent(app, a, cp.venue_id);
      items.push({
        ...assignmentDto(a),
        event_id: event?.id ?? null,
        checkpoint: {
          id: cp.id, label: cp.label, perimeter: cp.perimeter_bool, direction: cp.direction,
          zone_id: cp.zone_id, zone_name: zone?.name ?? "", room_id: cp.room_id, room_name: room?.name ?? null,
        },
        event: event ? { id: event.id, title: event.title, slug: event.slug, rooms: await roomsOf(event.id) } : null,
      });
    }
    return { items };
  });

  mount(x, app, endpoints.handover, async ({ params, ctx }) => {
    const a = await app.repos.staff.byId(params.id);
    // Staff hand over only their own shift; another id answers as if it did not exist.
    if (!a || (ctx!.kind !== "operator" && a.user_id !== ctx!.sub)) throw new ContractError("NOT_FOUND");
    const now = new Date(app.clock.now());
    if (now.getTime() < a.shift_start.getTime()) throw new ContractError("CONFLICT", "The shift has not started.");
    // Stamped and audited (`staff.handover`, counts only) once, in one step; asking again re-reads the summary.
    const done = await app.repos.staff.handOver(a.id, { actorId: ctx!.sub, now });
    const s = done && done !== "already_handed_over" ? done : await app.repos.staff.handoverSummary(a.id);
    if (!s) throw new ContractError("NOT_FOUND");
    const at = done && done !== "already_handed_over" ? now : ((await app.repos.staff.byId(a.id))!.handed_over_at ?? now);
    return {
      assignment_id: a.id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start.toISOString(), shift_end: a.shift_end.toISOString(),
      handed_over_at: at.toISOString(),
      // Contract names (01 §3) ← @synan/db summary: admitted ← let_through, queued ← offline. Undone
      // admissions are in neither let_through nor by_result; they are counted on their own (0034).
      admitted: s.let_through, refused: s.refused, queued: s.offline, by_result: s.by_result, undone: s.undone,
      scans: s.scans, let_through: s.let_through, duplicates: s.duplicates, offline: s.offline, late_synced: s.late_synced,
      period_end: s.period_end.toISOString(), first_scan_at: s.first_scan_at?.toISOString() ?? null, last_scan_at: s.last_scan_at?.toISOString() ?? null,
    };
  });

  mount(x, app, endpoints.gateHeartbeat, async ({ body, ctx, ip }) => {
    const now = app.clock.now();
    const channel = `${endpoints.gateHeartbeat.method} ${endpoints.gateHeartbeat.path}`;
    const shift = (await currentAssignments(app, ctx!.sub)).find((a) => a.checkpoint_id === body.checkpoint_id);
    if (!shift) {
      // A scanner heartbeating for a gate its user is not staffing now (03 §8.2, assignment check).
      await app.scannerTrust.refused({ reason: "not_assigned", channel, ip, userId: ctx!.sub, checkpointId: body.checkpoint_id });
      throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
    }
    const cp = (await app.repos.venues.checkpoint(body.checkpoint_id))!;
    // The phone is a device too: heartbeat, queue depth and clock offset land on the devices table.
    const r = await app.gates.phoneHeartbeat({
      userId: ctx!.sub, venueId: cp.venue_id, checkpointId: cp.id, clientDeviceId: body.device_id,
      clockOffsetMs: body.clock_offset_ms, queueDepth: body.queue_depth, online: body.online,
      allowlistIssuedAt: body.allowlist_issued_at ? new Date(body.allowlist_issued_at) : null,
    });
    if (r !== "ok") {
      await app.scannerTrust.refused({ reason: "scanner_retired", channel, ip, userId: ctx!.sub, checkpointId: cp.id });
      throw new ContractError("FORBIDDEN", "This scanner has been retired.");
    }
    // The scanner install worked this shift: a queued scan of the shift may later sync from it (A1).
    await noteScanner(app.repos, shift, body.device_id);
    const event = await shiftEvent(app, shift, cp.venue_id);
    await app.gates.allowlistReported({ eventId: event?.id ?? null, checkpointId: cp.id, roomId: cp.room_id, issuedAt: body.allowlist_issued_at ? new Date(body.allowlist_issued_at) : null });
    return { server_time: new Date(now).toISOString() };
  });

  mount(x, app, endpoints.mfaEnrol, async ({ ctx }) => {
    const user = await app.repos.users.byId(ctx!.sub);
    if (!user) throw new ContractError("UNAUTHENTICATED");
    if (user.mfa_enrolled_at && !app.auth.isMfaFresh(ctx!)) throw new ContractError("MFA_REQUIRED");
    const secret = newTotpSecret();
    const expiresAt = app.clock.now() + ENROL_TTL_MS;
    // Held encrypted on the user until confirmed (never in process memory between requests).
    await app.repos.users.startMfaEnrolment(user.id, secret, new Date(app.clock.now()));
    const label = encodeURIComponent(`${BRAND.name}:${user.email}`);
    return { secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(BRAND.name)}`, expires_at: new Date(expiresAt).toISOString() };
  });

  mount(x, app, endpoints.mfaEnrolConfirm, async ({ body, ctx }) => {
    const now = app.clock.now();
    const secret = await app.repos.users.readPendingMfaSecret(ctx!.sub, new Date(now));
    if (!secret) throw new ContractError("CONFLICT", "Start enrolment first.");
    const key = `mfa-fail:${ctx!.sub}`;
    if (app.rateLimiter.blocked(key, 5, 15 * 60_000) !== null) throw new ContractError("RATE_LIMITED");
    if (verifyTotp(secret, body.code, now) === null) {
      app.rateLimiter.hit(key, 5, 15 * 60_000);
      throw new ContractError("INVALID_MFA_CODE");
    }
    if (!(await app.repos.users.confirmMfaEnrolment(ctx!.sub, new Date(now)))) throw new ContractError("CONFLICT", "The enrolment changed; start again.");
    await audit(ctx!.sub, "user.mfa_enrol", `user:${ctx!.sub}`, {});
    return { ok: true as const };
  });
}
