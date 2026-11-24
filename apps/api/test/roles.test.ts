/**
 * D-23 · the supervisor and desk-clerk roles. The whole contract registry is walked for both roles:
 * every endpoint outside the role's set answers 403 FORBIDDEN before anything else happens, and every
 * endpoint inside it gets past the role check. Then the handler-level rules: supervisor step-up for
 * revoke and clear-review, the desk clerk's event scope and reduced fields, no live channels for a
 * clerk, capabilities on /me/operator, role changes audited.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endpoints, type EndpointDef, type TokenPair } from "@synan/contracts/rest";
import type { Role } from "@synan/contracts/enums";
import { hashPassword, newTotpSecret, totp } from "../src/lib/crypto.js";
import { authoriseChannel } from "../src/realtime/ws-server.js";
import { addAttendee, devEmail, errCode, mfaCode, startHarness, type Harness } from "./helpers.js";

let h: Harness;
const users: Record<"supervisor" | "desk_clerk", { id: string; email: string; secret: string; token: string }> = {} as never;

async function makeUser(role: Role) {
  const id = randomUUID();
  const email = devEmail(`${role}-${id.slice(0, 6)}`);
  const secret = newTotpSecret();
  await h.app.ctx.repos.users.insert({ id, email, password_hash: await hashPassword(h.seed.password, 12), role, mfa_enrolled_at: new Date(h.clock.now()), mfa_secret: secret, display_name: null });
  return { id, email, secret, token: (await h.login(email)).access_token };
}
const stepUp = async (u: { token: string; secret: string }) =>
  (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: u.token, body: { code: totp(u.secret, h.clock.now()) } })).body.access_token;

beforeAll(async () => {
  h = await startHarness();
  users.supervisor = await makeUser("supervisor");
  users.desk_clerk = await makeUser("desk_clerk");
  // The clerk works the Main Entrance desk for the live event, now.
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  const t = h.clock.now();
  const a = await h.call("POST", "/staff-assignments", { token: admin, body: {
    user_id: users.desk_clerk.id, checkpoint_id: h.seed.checkpoints.mainIn, event_id: h.seed.eventId,
    shift_start: new Date(t - 3_600_000).toISOString(), shift_end: new Date(t + 6 * 3_600_000).toISOString(),
  } });
  expect(a.status).toBe(201);
});
afterAll(async () => h.close());

const fill = (path: string) =>
  path.replace(/:slug/g, "no-such-event").replace(/:token/g, "t".repeat(24)).replace(/:kind/g, "attendance").replace(/:\w+/g, () => randomUUID());

describe("D-23 · the whole registry, per role", () => {
  for (const role of ["supervisor", "desk_clerk"] as const) {
    it(`${role}: denied outside its set, past the role check inside it`, async () => {
      const token = users[role].token;
      const outcomes: string[] = [];
      for (const [name, def] of Object.entries(endpoints) as [string, EndpointDef][]) {
        if (def.access.includes("public") || name === "logout") continue;
        const r = await h.call<{ error?: { code: string } }>(def.method, fill(def.path), { token, ...(def.method === "GET" || def.method === "DELETE" ? {} : { body: {} }) });
        const code = r.body?.error?.code ?? `HTTP ${r.status}`;
        if (def.access.includes(role)) {
          if (code === "FORBIDDEN") outcomes.push(`${name} refused but allowed`);
        } else if (r.status !== 403 || code !== "FORBIDDEN") outcomes.push(`${name} answered ${r.status} ${code} but is not allowed`);
      }
      expect(outcomes).toEqual([]);
    });
  }
});

describe("D-23 · supervisor", () => {
  it("runs the live screens; clearing or revoking a pass needs a fresh second factor", async () => {
    const s = users.supervisor.token;
    expect((await h.call("GET", "/dashboard", { token: s })).status).toBe(200);
    expect((await h.call("GET", `/events/${h.seed.eventId}/summary`, { token: s })).status).toBe(200);
    expect((await h.call("GET", `/gates/health?event_id=${h.seed.eventId}`, { token: s })).status).toBe(200);
    expect((await h.call("GET", `/scans?event_id=${h.seed.eventId}`, { token: s })).status).toBe(200);
    const a = await addAttendee(h, "ORDINARY");
    expect(errCode((await h.call("POST", `/credentials/${a.credentialId}/revoke`, { token: s, body: { reason: "fraud" } })).body)).toBe("MFA_REQUIRED");
    const stepped = await stepUp(users.supervisor);
    const revoked = await h.call<{ state: string }>("POST", `/credentials/${a.credentialId}/revoke`, { token: stepped, body: { reason: "fraud" } });
    expect(revoked.body.state).toBe("revoked");
    const me = await h.call<{ role: string; capabilities: string[] }>("GET", "/me/operator", { token: s });
    expect(me.body.role).toBe("supervisor");
    expect(me.body.capabilities).toEqual(expect.arrayContaining(["dashboard", "ackAlert", "revoke", "recountRoom"]));
    expect(me.body.capabilities).not.toContain("createEvent");
    const ctx = await h.app.ctx.auth.verifyAccess(s);
    expect((await authoriseChannel(h.app.ctx, ctx, "/stream/telemetry", h.seed.eventId, null)).scope).toBe("full");
    expect((await authoriseChannel(h.app.ctx, ctx, "/stream/alerts", h.seed.eventId, null)).scope).toBe("full");
  });
});

describe("D-23 · desk clerk", () => {
  it("looks up attendees of the event at their desk only, without check-in times", async () => {
    const d = users.desk_clerk.token;
    const r = await h.call<{ items: Record<string, unknown>[] }>("GET", `/events/${h.seed.eventId}/registrations?q=vera`, { token: d });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ tier: "VIP", attendee: { full_name: "Vera Ip" } });
    expect(r.body.items[0]!.credential_state).toBeDefined();
    expect("checked_in_at" in r.body.items[0]!).toBe(false);
    expect((await h.call("GET", `/events/${h.seed.publishedEventId}/registrations`, { token: d })).status).toBe(404);
    expect((await h.call("GET", `/credentials/inventory?event_id=${h.seed.publishedEventId}`, { token: d })).status).toBe(404);
    expect((await h.call("GET", `/credentials/inventory?event_id=${h.seed.eventId}`, { token: d })).status).toBe(200);
    expect((await h.call("GET", "/credentials/inventory", { token: d })).status).toBe(200);
    const me = await h.call<{ capabilities: string[]; desk_event_ids: string[] }>("GET", "/me/operator", { token: d });
    expect(me.body.desk_event_ids).toEqual([h.seed.eventId]);
    expect(me.body.capabilities).toEqual(expect.arrayContaining(["bindCarrier", "rebindCarrier", "resend", "eventRegistrations"]));
  });

  it("binds a band and resends a pass for that event (resend with a fresh second factor); no live channel", async () => {
    const d = users.desk_clerk.token;
    const id = randomUUID();
    const registrationId = randomUUID();
    await h.app.ctx.repos.attendees.insert({ id, user_id: null, email: devEmail(`desk-${id}`), full_name: "Desk Person", profile_jsonb: {} });
    await h.app.ctx.repos.fixtures.registration({ id: registrationId, event_id: h.seed.eventId, attendee_id: id, tier: "ORDINARY", state: "confirmed", zone_presence_consent_at: null, checked_in_at: null, created_at: new Date(h.clock.now()) });
    const cred = await h.app.ctx.credentials.issueForRegistration(registrationId);
    const bound = await h.call<{ state: string }>("POST", "/carriers/bind", { token: d, body: { registration_id: registrationId, identifier: h.seed.stockUid } });
    expect(bound.status).toBe(200);
    expect(errCode((await h.call("POST", `/credentials/${cred.id}/resend`, { token: d })).body)).toBe("MFA_REQUIRED");
    const stepped = await stepUp(users.desk_clerk);
    expect((await h.call("POST", `/credentials/${cred.id}/resend`, { token: stepped })).status).toBe(200);
    // Another event's pass: answered like a missing one.
    const other = randomUUID();
    await h.app.ctx.repos.fixtures.registration({ id: other, event_id: h.seed.privateEventId, attendee_id: id, tier: "ORDINARY", state: "confirmed", zone_presence_consent_at: null, checked_in_at: null, created_at: new Date(h.clock.now()) });
    const otherCred = await h.app.ctx.credentials.issueForRegistration(other);
    expect((await h.call("POST", `/credentials/${otherCred.id}/resend`, { token: stepped })).status).toBe(404);
    const ctx = await h.app.ctx.auth.verifyAccess(d);
    await expect(authoriseChannel(h.app.ctx, ctx, "/stream/telemetry", h.seed.eventId, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a desk clerk's shift names its event and is at a perimeter desk", async () => {
    const admin = (await h.login(h.seed.emails.admin)).access_token;
    const clerk = await makeUser("desk_clerk");
    const t = h.clock.now();
    const shift = { user_id: clerk.id, shift_start: new Date(t + 30 * 3_600_000).toISOString(), shift_end: new Date(t + 32 * 3_600_000).toISOString() };
    expect(errCode((await h.call("POST", "/staff-assignments", { token: admin, body: { ...shift, checkpoint_id: h.seed.checkpoints.mainIn } })).body)).toBe("VALIDATION_FAILED");
    expect(errCode((await h.call("POST", "/staff-assignments", { token: admin, body: { ...shift, checkpoint_id: h.seed.checkpoints.vip, event_id: h.seed.eventId } })).body)).toBe("VALIDATION_FAILED");
  });
});

describe("D-23 · roles are given and changed by an admin, audited", () => {
  it("invites a supervisor; changes a role with a second factor; never one's own", async () => {
    const admin = (await h.login(h.seed.emails.admin)).access_token;
    const inv = await h.call<{ id: string; role: string }>("POST", "/staff", { token: admin, body: { email: devEmail(`sup-${randomUUID().slice(0, 6)}`), role: "supervisor" } });
    expect(inv.body.role).toBe("supervisor");
    const body = { role: "desk_clerk", reason: "covers the desk today" };
    expect(errCode((await h.call("PATCH", `/staff/${inv.body.id}`, { token: admin, body })).body)).toBe("MFA_REQUIRED");
    const stepped = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
    expect((await h.call<{ role: string }>("PATCH", `/staff/${inv.body.id}`, { token: stepped, body })).body.role).toBe("desk_clerk");
    expect((await h.app.ctx.repos.users.byId(inv.body.id))!.role).toBe("desk_clerk");
    const entry = (await h.app.ctx.repos.audit.all()).filter((a) => a.action === "staff.role_change").at(-1)!;
    expect(entry.meta_jsonb).toMatchObject({ from: "supervisor", to: "desk_clerk" });
    expect(errCode((await h.call("PATCH", `/staff/${h.seed.users.admin}`, { token: stepped, body })).body)).toBe("CONFLICT");
    expect((await h.call("PATCH", `/staff/${inv.body.id}`, { token: users.supervisor.token, body })).status).toBe(403);
  });
});
