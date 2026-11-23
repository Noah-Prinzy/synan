import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupAuthState,
  consumeWsTicket,
  createLink,
  hashToken,
  mintWsTicket,
  newToken,
  redeemLink,
  revokeFamily,
  revokeHolderSessions,
  rotateSession,
  startSession,
} from "../src/auth";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { attendeeWithCredential, devCipher, miniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let userId: string;
let otherUserId: string;
let attendeeId: string;
let eventId: string;
const T0 = new Date("2026-12-01T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

beforeAll(async () => {
  db = await createTestDb();
  const v = await miniVenue(db);
  eventId = v.eventId;
  userId = await insertUser(db, devCipher, { email: "op@example.test", role: "organiser" });
  otherUserId = await insertUser(db, devCipher, { email: "op2@example.test", role: "admin" });
  attendeeId = (await attendeeWithCredential(db, v.eventId)).attendeeId;
  // Run everything as the general application role, as the API will.
  await q(db, "set role app_api");
});
afterAll(async () => {
  await q(db, "reset role");
});

async function login(holder: { userId: string } | { attendeeId: string }, extra: { mfaAt?: Date; ip?: string; userAgent?: string } = {}) {
  const token = newToken();
  const familyId = randomUUID();
  const row = await startSession(db, { holder, familyId, tokenHash: hashToken(token), expiresAt: at(60 * 24), now: T0, ...extra });
  return { token, familyId, id: row.id };
}

describe("auth_sessions", () => {
  it("stores only a 43-char hash, a truncated IP and a bounded user agent", async () => {
    const { token, id } = await login({ userId }, { ip: "203.0.113.77", userAgent: "x".repeat(500) });
    const [row] = await db.select().from(s.auth_sessions).where(eq(s.auth_sessions.id, id));
    expect(row!.token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row!.token_hash).not.toContain(token);
    expect(row!.ip_prefix).toBe("203.0.113.0/24");
    expect(row!.user_agent).toHaveLength(200);
    const v6 = await login({ userId }, { ip: "2001:db8:abcd:12:34::1" });
    const [r6] = await db.select().from(s.auth_sessions).where(eq(s.auth_sessions.id, v6.id));
    expect(r6!.ip_prefix).toBe("2001:db8:abcd::/48");
  });

  it("rotates within the family, records lineage and carries the MFA time", async () => {
    const mfaAt = at(-1);
    const a = await login({ userId }, { mfaAt });
    const b = newToken();
    const r = await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(b), expiresAt: at(120), now: at(5) });
    expect(r.status).toBe("rotated");
    expect(r.family_id).toBe(a.familyId);
    expect(r.user_id).toBe(userId);
    expect(r.mfa_at?.toISOString()).toBe(mfaAt.toISOString());
    const rows = await db.select().from(s.auth_sessions).where(eq(s.auth_sessions.family_id, a.familyId));
    const parent = rows.find((x) => x.id === a.id)!;
    const child = rows.find((x) => x.id === r.session_id)!;
    expect(parent.rotated_at?.toISOString()).toBe(at(5).toISOString());
    expect(child.parent_id).toBe(a.id);
    expect(child.rotated_at).toBeNull();
  });

  it("picks the new lifetime by holder kind when given a ttl (12 h operators, 30 days attendees)", async () => {
    const ttl = { userSeconds: 12 * 3600, attendeeSeconds: 30 * 86400 };
    const op = await login({ userId });
    const att = await login({ attendeeId });
    const r1 = await rotateSession(db, { tokenHash: hashToken(op.token), newTokenHash: hashToken(newToken()), ttl, now: at(1) });
    const r2 = await rotateSession(db, { tokenHash: hashToken(att.token), newTokenHash: hashToken(newToken()), ttl, now: at(1) });
    expect(r1.status).toBe("rotated");
    expect(r1.expires_at!.getTime() - at(1).getTime()).toBe(12 * 3600 * 1000);
    expect(r2.expires_at!.getTime() - at(1).getTime()).toBe(30 * 86400 * 1000);
    // Same statuses as the fixed-expiry form.
    expect((await rotateSession(db, { tokenHash: hashToken(op.token), newTokenHash: hashToken(newToken()), ttl, now: at(2) })).status).toBe("reuse_detected");
    expect((await rotateSession(db, { tokenHash: hashToken("unknown"), newTokenHash: hashToken(newToken()), ttl, now: at(2) })).status).toBe("invalid");
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const a = await login({ attendeeId });
    const b = newToken();
    const c = newToken();
    expect((await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(b), expiresAt: at(120), now: at(1) })).status).toBe("rotated");
    expect((await rotateSession(db, { tokenHash: hashToken(b), newTokenHash: hashToken(c), expiresAt: at(120), now: at(2) })).status).toBe("rotated");
    // The stolen first token is replayed.
    const replay = await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(newToken()), expiresAt: at(120), now: at(3) });
    expect(replay.status).toBe("reuse_detected");
    expect(replay.attendee_id).toBe(attendeeId);
    const rows = await db.select().from(s.auth_sessions).where(eq(s.auth_sessions.family_id, a.familyId));
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.revoked_at !== null && x.revoke_reason === "reuse_detected")).toBe(true);
    // The legitimate newest token is now dead too.
    expect((await rotateSession(db, { tokenHash: hashToken(c), newTokenHash: hashToken(newToken()), expiresAt: at(120), now: at(4) })).status).toBe("revoked");
  });

  it("treats two exchanges of the same token as reuse (the second of a concurrent pair)", async () => {
    const a = await login({ userId });
    const first = await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(newToken()), expiresAt: at(120), now: at(1) });
    const second = await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(newToken()), expiresAt: at(120), now: at(1) });
    expect([first.status, second.status]).toEqual(["rotated", "reuse_detected"]);
  });

  it("refuses expired and unknown tokens without touching the family", async () => {
    const a = await login({ userId });
    const r = await rotateSession(db, { tokenHash: hashToken(a.token), newTokenHash: hashToken(newToken()), expiresAt: at(60 * 48), now: at(60 * 25) });
    expect(r.status).toBe("expired");
    const rows = await db.select().from(s.auth_sessions).where(eq(s.auth_sessions.family_id, a.familyId));
    expect(rows.every((x) => x.revoked_at === null)).toBe(true);
    expect((await rotateSession(db, { tokenHash: hashToken("nope"), newTokenHash: hashToken(newToken()), expiresAt: at(60), now: at(1) })).status).toBe("invalid");
  });

  it("revokes a family (MFA step-up, logout) and all sessions of one holder", async () => {
    const a = await login({ userId: otherUserId });
    const b = await login({ userId: otherUserId });
    const other = await login({ userId });
    expect(await revokeFamily(db, a.familyId, "mfa_step_up", at(1))).toBe(1);
    expect(await revokeFamily(db, a.familyId, "logout", at(2))).toBe(0);
    expect(await revokeHolderSessions(db, { userId: otherUserId }, "operator", at(3))).toBe(1); // b only
    expect((await rotateSession(db, { tokenHash: hashToken(b.token), newTokenHash: hashToken(newToken()), expiresAt: at(60), now: at(4) })).status).toBe("revoked");
    expect((await rotateSession(db, { tokenHash: hashToken(other.token), newTokenHash: hashToken(newToken()), expiresAt: at(60), now: at(4) })).status).toBe("rotated");
  });

  it("enforces exactly one holder, a revoke reason, and a truncated IP", async () => {
    const base = { family_id: randomUUID(), token_hash: hashToken(newToken()), created_at: T0, expires_at: at(60) };
    await rejects(db.insert(s.auth_sessions).values({ ...base }), /auth_sessions_one_holder/);
    await rejects(db.insert(s.auth_sessions).values({ ...base, user_id: userId, attendee_id: attendeeId }), /auth_sessions_one_holder/);
    await rejects(db.insert(s.auth_sessions).values({ ...base, user_id: userId, revoked_at: T0 }), /auth_sessions_revoke_reason/);
    await rejects(db.insert(s.auth_sessions).values({ ...base, user_id: userId, ip_prefix: "203.0.113.77/32" }), /auth_sessions_ip_truncated/);
  });
});

describe("auth_links", () => {
  it("redeems exactly once", async () => {
    const token = newToken();
    await createLink(db, { tokenHash: hashToken(token), attendeeId, expiresAt: at(15), now: T0 });
    const first = await redeemLink(db, hashToken(token), at(1));
    expect(first).toMatchObject({ status: "redeemed", attendee_id: attendeeId, purpose: "sign_in" });
    expect((await redeemLink(db, hashToken(token), at(2))).status).toBe("already_redeemed");
    expect((await redeemLink(db, hashToken("unknown"), at(2))).status).toBe("invalid");
  });

  it("refuses an expired link and allows an email-hash-only link for an unknown address", async () => {
    const t1 = newToken();
    await createLink(db, { tokenHash: hashToken(t1), attendeeId, expiresAt: at(15), now: T0 });
    expect((await redeemLink(db, hashToken(t1), at(16))).status).toBe("expired");
    const t2 = newToken();
    await createLink(db, { tokenHash: hashToken(t2), emailHash: "a".repeat(64), purpose: "verify_email", expiresAt: at(15), now: T0 });
    expect(await redeemLink(db, hashToken(t2), at(1))).toMatchObject({ status: "redeemed", attendee_id: null, email_hash: "a".repeat(64), purpose: "verify_email" });
    await rejects(createLink(db, { tokenHash: hashToken(newToken()), expiresAt: at(15), now: T0 }), /auth_links_recipient/);
    await rejects(createLink(db, { tokenHash: hashToken(t2), attendeeId, expiresAt: at(15), now: T0 }), /auth_links_token_hash_uq/);
  });
});

describe("ws_tickets", () => {
  it("is consumed on first presentation; replays fail", async () => {
    const a = await login({ userId });
    const t = newToken();
    await mintWsTicket(db, { ticketHash: hashToken(t), holder: { userId }, sessionFamilyId: a.familyId, channel: "/stream/scans", eventId, expiresAt: new Date(T0.getTime() + 30_000), now: T0 });
    const first = await consumeWsTicket(db, hashToken(t), new Date(T0.getTime() + 5_000));
    expect(first).toMatchObject({ status: "valid", user_id: userId, channel: "/stream/scans", event_id: eventId });
    expect((await consumeWsTicket(db, hashToken(t), new Date(T0.getTime() + 6_000))).status).toBe("already_consumed");
    expect((await consumeWsTicket(db, hashToken("forged"), T0)).status).toBe("invalid");
  });

  it("refuses an expired ticket (still consuming it) and a ticket whose session was revoked", async () => {
    const a = await login({ attendeeId });
    const t1 = newToken();
    await mintWsTicket(db, { ticketHash: hashToken(t1), holder: { attendeeId }, sessionFamilyId: a.familyId, channel: "/stream/me", expiresAt: new Date(T0.getTime() + 30_000), now: T0 });
    expect((await consumeWsTicket(db, hashToken(t1), new Date(T0.getTime() + 31_000))).status).toBe("expired");
    expect((await consumeWsTicket(db, hashToken(t1), new Date(T0.getTime() + 1_000))).status).toBe("already_consumed");
    const t2 = newToken();
    await mintWsTicket(db, { ticketHash: hashToken(t2), holder: { attendeeId }, sessionFamilyId: a.familyId, channel: "/stream/me", expiresAt: new Date(T0.getTime() + 30_000), now: T0 });
    await revokeFamily(db, a.familyId, "logout", T0);
    expect((await consumeWsTicket(db, hashToken(t2), new Date(T0.getTime() + 1_000))).status).toBe("revoked");
  });

  it("is short-lived and has exactly one holder", async () => {
    await rejects(
      mintWsTicket(db, { ticketHash: hashToken(newToken()), holder: { userId }, channel: "/stream/alerts", expiresAt: at(6), now: T0 }),
      /ws_tickets_short_lived/,
    );
    await rejects(
      db.insert(s.ws_tickets).values({ ticket_hash: hashToken(newToken()), channel: "/stream/alerts", created_at: T0, expires_at: at(1) }),
      /ws_tickets_one_holder/,
    );
  });
});

describe("cleanup", () => {
  it("deletes expired state past the retention window and keeps what is recent", async () => {
    const before = await q<{ s: number; l: number; t: number }>(
      db,
      `select (select count(*) from auth_sessions)::int s, (select count(*) from auth_links)::int l, (select count(*) from ws_tickets)::int t`,
    );
    // Nothing is old enough relative to T0 + 1 day.
    expect(await cleanupAuthState(db, { now: at(60 * 24) })).toMatchObject({ sessions: 0, links: 0, tickets: before[0]!.t });
    // 70 days later every session (including the 30-day attendee ones), link and ticket expired > 30 days ago.
    const res = await cleanupAuthState(db, { now: at(60 * 24 * 70), batch: 2 });
    expect(res).toMatchObject({ sessions: before[0]!.s, links: before[0]!.l, tickets: 0 });
    const after = await q<{ n: number }>(db, `select ((select count(*) from auth_sessions) + (select count(*) from auth_links) + (select count(*) from ws_tickets))::int n`);
    expect(after[0]!.n).toBe(0);
  });
});
