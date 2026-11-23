import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanupAuthState } from "../src/auth";
import { importCarrierIdentifiers } from "../src/carriers";
import { registerAttendee } from "../src/registration";
import * as s from "../src/schema/index";
import { insertUser, readMfaSecret } from "../src/secrets";
import {
  bindBandWithDeskCode,
  cancelMfaEnrolment,
  confirmMfaEnrolment,
  consumeDeskCode,
  consumeUserInvite,
  createDeskCode,
  createUserInvite,
  findAttendeeIdsByEmail,
  readPendingMfaSecret,
  searchAttendeesDecrypted,
  startMfaEnrolment,
} from "../src/short-codes";
import { b64Hash, credentialRef, devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
const T0 = new Date("2026-12-01T09:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  await importCarrierIdentifiers(db, [b64Hash("desk-1"), b64Hash("desk-2"), b64Hash("desk-3")]);
});

const person = (email: string) =>
  registerAttendee(db, devCipher, { eventId: v.eventId, tier: "ORDINARY", state: "confirmed", email, fullName: email.split("@")[0]!, zonePresenceConsent: true, credentialRef: credentialRef() });

describe("desk codes", () => {
  it("are created only for stock bands, stored as a keyed hash, and consumed exactly once", async () => {
    expect((await createDeskCode(db, devCipher, { carrierIdentifier: b64Hash("nope") })).status).toBe("unknown_carrier");
    const c = await createDeskCode(db, devCipher, { carrierIdentifier: b64Hash("desk-1"), now: T0 });
    expect(c.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const [row] = await db.select().from(s.carrier_desk_codes);
    expect(row!.code_hash).not.toBe(createHash("sha256").update(c.code!).digest("base64url")); // keyed, not a plain hash
    expect(row!.expires_at).toEqual(at(10));
    const p = await person("self.binder@example.test");
    const first = await consumeDeskCode(db, devCipher, { code: c.code!.toLowerCase().replace(/^(...)/, "$1-"), attendeeId: p.attendee_id, now: at(1) });
    expect(first).toEqual({ status: "consumed", carrier_identifier: b64Hash("desk-1") });
    expect((await consumeDeskCode(db, devCipher, { code: c.code!, attendeeId: p.attendee_id, now: at(2) })).status).toBe("already_used");
  });

  it("refuse expired codes and lock an attendee out after repeated failures", async () => {
    const c = await createDeskCode(db, devCipher, { carrierIdentifier: b64Hash("desk-2"), now: T0 });
    const p = await person("guesser@example.test");
    expect((await consumeDeskCode(db, devCipher, { code: c.code!, attendeeId: p.attendee_id, now: at(11) })).status).toBe("expired");
    for (let k = 0; k < 4; k++) expect((await consumeDeskCode(db, devCipher, { code: "AAAAAA", attendeeId: p.attendee_id, now: at(12) })).status).toBe("invalid");
    // Five failures within ten minutes: even a valid code is refused until the window passes.
    const fresh = await createDeskCode(db, devCipher, { carrierIdentifier: b64Hash("desk-2"), now: at(12) });
    expect((await consumeDeskCode(db, devCipher, { code: fresh.code!, attendeeId: p.attendee_id, now: at(13) })).status).toBe("too_many_attempts");
    expect((await consumeDeskCode(db, devCipher, { code: fresh.code!, attendeeId: p.attendee_id, now: at(20.5) })).status).toBe("too_many_attempts");
    // At 21:00 the failure from 09:11 leaves the 10-minute window: four remain, under the limit.
    expect((await consumeDeskCode(db, devCipher, { code: fresh.code!, attendeeId: p.attendee_id, now: at(21.5) })).status).toBe("consumed");
  });

  it("bind a band from the attendee's phone in one step; a failed bind leaves the code unspent", async () => {
    const p = await person("phone@example.test");
    const other = await person("other@example.test");
    const c = await createDeskCode(db, devCipher, { carrierIdentifier: b64Hash("desk-3") });
    expect((await bindBandWithDeskCode(db, devCipher, { code: c.code!, attendeeId: p.attendee_id, credentialId: other.credential_id! })).status).toBe("not_your_credential");
    // Make the bind fail: the credential already has a band.
    await importCarrierIdentifiers(db, [b64Hash("already")]);
    const { bindCarrier } = await import("../src/carriers");
    await bindCarrier(db, { identifier: b64Hash("already"), credentialId: p.credential_id! });
    const failed = await bindBandWithDeskCode(db, devCipher, { code: c.code!, attendeeId: p.attendee_id, credentialId: p.credential_id! });
    expect(failed).toMatchObject({ status: "bind_failed", bind_status: "credential_has_carrier" });
    const [row] = await db.select().from(s.carrier_desk_codes).where(eq(s.carrier_desk_codes.carrier_identifier, b64Hash("desk-3")));
    expect(row!.used_at).toBeNull();
    const ok = await bindBandWithDeskCode(db, devCipher, { code: c.code!, attendeeId: other.attendee_id, credentialId: other.credential_id! });
    expect(ok).toMatchObject({ status: "consumed", bind_status: "bound" });
  });
});

describe("staff invites", () => {
  it("are single use, expire, and a new invite revokes the older one", async () => {
    const u = await insertUser(db, devCipher, { email: "new.staff@example.test", role: "security_staff" });
    const a = await createUserInvite(db, { userId: u, ttlHours: 1, now: T0 });
    const b = await createUserInvite(db, { userId: u, ttlHours: 1, now: at(1) });
    expect(b.revoked).toBe(1);
    expect((await consumeUserInvite(db, a.token!, at(2))).status).toBe("revoked");
    expect(await consumeUserInvite(db, b.token!, at(2))).toEqual({ status: "consumed", user_id: u });
    expect((await consumeUserInvite(db, b.token!, at(3))).status).toBe("already_used");
    const c = await createUserInvite(db, { userId: u, ttlHours: 1, now: at(3) });
    expect((await consumeUserInvite(db, c.token!, at(64))).status).toBe("expired");
    expect((await consumeUserInvite(db, "nope")).status).toBe("invalid");
    expect((await createUserInvite(db, { userId: "00000000-0000-4000-8000-000000000000" })).status).toBe("unknown_user");
  });

  it("are cleaned up with the sign-in state", async () => {
    const r = await cleanupAuthState(db, { now: new Date(T0.getTime() + 60 * 86_400_000) });
    expect(r.user_invites).toBeGreaterThanOrEqual(3);
    expect(r.desk_codes).toBeGreaterThanOrEqual(1);
    expect(r.desk_code_failures).toBeGreaterThanOrEqual(1);
  });
});

describe("MFA enrolment", () => {
  it("keeps the pending secret encrypted, expires it, and promotes it on confirmation", async () => {
    const u = await insertUser(db, devCipher, { email: "mfa.enrol@example.test", role: "admin" });
    await startMfaEnrolment(db, devCipher, u, "JBSWY3DPEHPK3PXP", { now: T0 });
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u));
    expect(row!.mfa_pending_secret_enc).toMatch(/^ev1\./);
    expect(await readPendingMfaSecret(db, devCipher, u, at(5))).toBe("JBSWY3DPEHPK3PXP");
    expect(await readPendingMfaSecret(db, devCipher, u, at(11))).toBeNull();
    expect(await confirmMfaEnrolment(db, devCipher, u, at(11))).toBe(false);
    await startMfaEnrolment(db, devCipher, u, "KRSXG5CTMVRXEZLU", { now: at(12) });
    expect(await confirmMfaEnrolment(db, devCipher, u, at(13))).toBe(true);
    expect(await readMfaSecret(db, devCipher, u)).toBe("KRSXG5CTMVRXEZLU");
    const [after] = await db.select().from(s.users).where(eq(s.users.id, u));
    expect([after!.mfa_pending_secret_enc, after!.mfa_enrolled_at]).toEqual([null, at(13)]);
    await startMfaEnrolment(db, devCipher, u, "X", { now: at(14) });
    await cancelMfaEnrolment(db, u);
    expect(await readPendingMfaSecret(db, devCipher, u, at(15))).toBeNull();
    await rejects(q(db, `update users set mfa_pending_secret_enc = 'PLAIN', mfa_pending_expires_at = now() where id = $1`, [u]), /users_mfa_pending_encrypted/);
  });
});

describe("attendee search", () => {
  it("finds by exact email through the blind index, and by substring by decrypting a bounded candidate set", async () => {
    const a = await person("Search.Me@Example.test");
    expect(await findAttendeeIdsByEmail(db, devCipher, " search.me@example.TEST ")).toEqual([a.attendee_id]);
    expect(await findAttendeeIdsByEmail(db, devCipher, "search.me@example.tes")).toEqual([]);
    const regs = await db.select({ id: s.registrations.attendee_id }).from(s.registrations).where(eq(s.registrations.event_id, v.eventId));
    const hits = await searchAttendeesDecrypted(db, devCipher, { q: "SEARCH", attendeeIds: regs.map((r) => r.id) });
    expect(hits.map((h) => h.id)).toEqual([a.attendee_id]);
    expect((await searchAttendeesDecrypted(db, devCipher, { q: "example.test", limit: 2 })).length).toBe(2);
  });
});
