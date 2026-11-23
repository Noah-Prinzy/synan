/**
 * Slice 6 — staff (01 §3, P-15, 03 §3–§4).
 *
 * - Assignments bind a staff user to a checkpoint for a shift; overlapping shifts for one person are
 *   refused (409), as the database's exclusion constraint does. Optionally tied to one event, which
 *   then scopes the offline allowlist.
 * - Handover: the assignee (or an operator) closes the shift with a summary of admitted, refused and
 *   offline-synced scans. Server time stamps it.
 * - Invite: an admin creates a staff user without a password; a one-time activation link (stored
 *   hashed, 72 h) lets them set one. Attendees are never users.
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
import { currentAssignments } from "../domain/scope.js";
import { mount } from "../http/route.js";
import { hashPassword, newTotpSecret, verifyTotp } from "../lib/crypto.js";
import type { StaffAssignmentRow, UserRow } from "../repo/types.js";

const ENROL_TTL_MS = 10 * 60_000;
const STAFF_ROLES = new Set(["security_staff", "speaker", "crew"]);
const DENIED = new Set(["denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"]);

export const assignmentDto = (a: StaffAssignmentRow) => ({
  id: a.id, user_id: a.user_id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start.toISOString(), shift_end: a.shift_end.toISOString(),
  event_id: a.event_id ?? null, handed_over_at: a.handed_over_at?.toISOString() ?? null,
});
const staffDto = (u: UserRow) => ({ id: u.id, email: u.email, role: u.role, mfa_enrolled: u.mfa_enrolled_at !== null });
const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
const offsetCursor = (c: string | undefined) => {
  if (!c) return 0;
  const n = Number(c);
  if (!Number.isInteger(n) || n < 0) throw invalid("query.cursor", "invalid cursor");
  return n;
};

export function staffRoutes(x: Express, app: AppContext) {
  const audit = (actor: string, action: string, target: string, meta: Record<string, unknown> = {}) => app.audit.append({ actorId: actor, action, target, meta });

  mount(x, app, endpoints.listStaff, async ({ query }) => {
    const rows = await app.repos.users.list({ after: query.cursor, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(staffDto), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });

  mount(x, app, endpoints.inviteStaff, async ({ body, ctx }) => {
    if (await app.repos.users.byEmail(body.email)) throw new ContractError("CONFLICT", "A user with this address already exists.");
    const user: UserRow = { id: randomUUID(), email: body.email, password_hash: "", role: body.role, mfa_enrolled_at: null, mfa_secret: null };
    await app.repos.users.insert(user);
    const token = await app.repos.userInvites.create({ userId: user.id, createdBy: ctx!.sub, now: new Date(app.clock.now()) });
    const link = `${app.config.attendeeAppOrigin}/staff/activate#token=${token}`;
    void app.mailer
      .send({ to: body.email, tag: "staff.invite", subject: `${BRAND.name}: activate your staff account`, text: `Set your password with this link (works once, 72 hours):\n\n${link}` })
      .catch((e: unknown) => console.error("[mail] staff invite failed:", e instanceof Error ? e.message : String(e)));
    await audit(ctx!.sub, "staff.invite", `user:${user.id}`, { role: user.role });
    return staffDto(user);
  });

  mount(x, app, endpoints.activateStaff, async ({ body }) => {
    const userId = await app.repos.userInvites.consume(body.token, new Date(app.clock.now()));
    if (!userId) throw new ContractError("LINK_INVALID");
    await app.repos.users.setPassword(userId, await hashPassword(body.password));
    await app.audit.append({ actorId: userId, action: "staff.activate", target: `user:${userId}`, meta: {} });
    return { ok: true as const };
  });

  mount(x, app, endpoints.listAssignments, async ({ query }) => {
    const offset = offsetCursor(query.cursor);
    const rows = await app.repos.staff.list({ checkpointId: query.checkpoint_id, userId: query.user_id, offset, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(assignmentDto), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
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
    const row: StaffAssignmentRow = { id: randomUUID(), user_id: user.id, checkpoint_id: cp.id, shift_start: start, shift_end: end, event_id: body.event_id ?? null, handed_over_at: null };
    if ((await app.repos.staff.insert({ ...row, created_by: ctx!.sub })) === "overlap") {
      throw new ContractError("CONFLICT", "This person already has a shift overlapping that window.");
    }
    await audit(ctx!.sub, "staff_assignment.create", `staff_assignment:${row.id}`, { user_id: user.id, checkpoint_id: cp.id });
    return assignmentDto(row);
  });

  mount(x, app, endpoints.myOperator, async ({ ctx }) => {
    const u = await app.repos.users.byId(ctx!.sub);
    if (!u) throw new ContractError("UNAUTHENTICATED");
    const shift = (await currentAssignments(app, u.id))[0] ?? null;
    const cp = shift ? await app.repos.venues.checkpoint(shift.checkpoint_id) : null;
    return {
      id: u.id, email: u.email, role: u.role, mfa_enrolled: u.mfa_enrolled_at !== null, mfa_fresh: app.auth.isMfaFresh(ctx!),
      current_shift: shift ? { ...assignmentDto(shift), checkpoint_label: cp?.label ?? "" } : null,
    };
  });

  mount(x, app, endpoints.myAssignments, async ({ ctx }) => {
    const now = app.clock.now();
    const mine = (await app.repos.staff.assignmentsFor(ctx!.sub)).filter((a) => a.shift_end.getTime() > now);
    mine.sort((a, b) => a.shift_start.getTime() - b.shift_start.getTime());
    return { items: mine.map(assignmentDto) };
  });

  mount(x, app, endpoints.handover, async ({ params, ctx }) => {
    const a = await app.repos.staff.byId(params.id);
    // Staff hand over only their own shift; another id answers as if it did not exist.
    if (!a || (ctx!.kind !== "operator" && a.user_id !== ctx!.sub)) throw new ContractError("NOT_FOUND");
    const now = new Date(app.clock.now());
    if (now.getTime() < a.shift_start.getTime()) throw new ContractError("CONFLICT", "The shift has not started.");
    if (!a.handed_over_at) await app.repos.staff.markHandedOver(a.id, now);
    const at = a.handed_over_at ?? now;
    const c = await app.repos.scans.shiftCounts({ checkpointId: a.checkpoint_id, staffUserId: a.user_id, from: a.shift_start, to: new Date(Math.min(at.getTime() + 1, a.shift_end.getTime())) });
    const admitted = (c.byResult.admitted ?? 0) + (c.byResult.already_inside ?? 0);
    const refused = Object.entries(c.byResult).filter(([r]) => DENIED.has(r)).reduce((s, [, n]) => s + n, 0);
    if (!a.handed_over_at) await audit(ctx!.sub, "staff_assignment.handover", `staff_assignment:${a.id}`, { admitted, refused, queued: c.offline });
    return {
      assignment_id: a.id, checkpoint_id: a.checkpoint_id, shift_start: a.shift_start.toISOString(), shift_end: a.shift_end.toISOString(),
      handed_over_at: at.toISOString(), admitted, refused, queued: c.offline, by_result: c.byResult,
    };
  });

  mount(x, app, endpoints.gateHeartbeat, async ({ body, ctx }) => {
    const now = app.clock.now();
    const mine = (await currentAssignments(app, ctx!.sub)).some((a) => a.checkpoint_id === body.checkpoint_id);
    if (!mine) throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
    app.scans.gates.set(body.checkpoint_id, {
      checkpointId: body.checkpoint_id, lastSeenAt: now, clockOffsetMs: body.clock_offset_ms, deviceId: body.device_id, queueDepth: body.online ? body.queue_depth : Math.max(1, body.queue_depth),
    });
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
