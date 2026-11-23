import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { revocationEpoch } from "../src/allowlist";
import { hashToken, newToken, startSession, rotateSession } from "../src/auth";
import { importCarrierIdentifiers } from "../src/carriers";
import {
  changeRegistrationTier,
  claimDataRequest,
  collectAttendeeExport,
  createInvitation,
  expireInvitations,
  finishDataRequest,
  listDataRequests,
  openDataRequest,
  processErasureRequest,
  registerAttendee,
  registerPublicAttendee,
  rsvpInvitation,
  setRegistrationState,
} from "../src/registration";
import * as s from "../src/schema/index";
import { insertUser, readAttendee } from "../src/secrets";
import { b64Hash, credentialRef, devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let other: MiniVenue;
let op: string;
const T0 = new Date("2026-12-01T09:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  other = await miniVenue(db);
  op = await insertUser(db, devCipher, { email: "organiser@example.test", role: "organiser" });
});

/** Everything below runs as the general application role, as the API does. */
async function asApi<T>(f: () => Promise<T>): Promise<T> {
  await q(db, "set role app_api");
  try {
    return await f();
  } finally {
    await q(db, "reset role");
  }
}

describe("Private Invitation", () => {
  it("creates one open invitation per recipient and returns the token only once", async () => {
    const a = await asApi(() => createInvitation(db, devCipher, { eventId: v.eventId, email: "Guest@Example.test", expiresAt: at(60 * 24), actorId: op, now: T0 }));
    expect(a.status).toBe("created");
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const b = await asApi(() => createInvitation(db, devCipher, { eventId: v.eventId, email: "guest@example.test", expiresAt: at(60 * 24), now: T0 }));
    expect(b).toEqual({ status: "already_open", invitation_id: a.invitation_id, token: null });
    const [row] = await db.select().from(s.invitations).where(eq(s.invitations.id, a.invitation_id));
    expect(row!.token_hash).toBe(hashToken(a.token!));
    expect(row!.email_hash).toBe(devCipher.blindIndex("guest@example.test"));
  });

  it("RSVP: single use, only for the invited address, creates the attendee, registration and credential atomically", async () => {
    const inv = await createInvitation(db, devCipher, { eventId: v.eventId, email: "vip.guest@example.test", expiresAt: at(60), now: T0 });
    const wrong = await asApi(() => rsvpInvitation(db, devCipher, { token: inv.token!, email: "someone.else@example.test", zonePresenceConsent: true, now: at(1) }));
    expect(wrong.status).toBe("wrong_recipient");
    const ok = await asApi(() =>
      rsvpInvitation(db, devCipher, { token: inv.token!, email: "VIP.Guest@example.test", fullName: "Vera Guest", zonePresenceConsent: true, credentialRef: credentialRef(), now: at(2) }),
    );
    expect(ok.status).toBe("registered");
    const [reg] = await db.select().from(s.registrations).where(eq(s.registrations.id, ok.registration_id!));
    expect(reg).toMatchObject({ tier: "PRIVATE_INVITE", state: "confirmed", invitation_id: inv.invitation_id });
    expect(reg!.zone_presence_consent_at).toEqual(at(2));
    expect((await readAttendee(db, devCipher, ok.attendee_id!, "system"))!).toMatchObject({ email: "VIP.Guest@example.test", full_name: "Vera Guest" });
    const carriers = await db.select().from(s.carriers).where(eq(s.carriers.credential_id, ok.credential_id!));
    expect(carriers.map((c) => `${c.kind}:${c.state}`)).toEqual(["qr_portal:active"]);
    const again = await asApi(() => rsvpInvitation(db, devCipher, { token: inv.token!, email: "vip.guest@example.test", zonePresenceConsent: true, now: at(3) }));
    expect(again.status).toBe("already_redeemed");
    expect((await asApi(() => rsvpInvitation(db, devCipher, { token: newToken(), email: "x@example.test", zonePresenceConsent: false }))).status).toBe("invalid");
  });

  it("reuses an existing person, and leaves the invitation open when they are already registered", async () => {
    const first = await registerAttendee(db, devCipher, { eventId: other.eventId, tier: "ORDINARY", state: "confirmed", email: "known@example.test", zonePresenceConsent: false });
    const inv = await createInvitation(db, devCipher, { eventId: v.eventId, email: "known@example.test", expiresAt: at(60), now: T0 });
    const ok = await asApi(() => rsvpInvitation(db, devCipher, { token: inv.token!, email: "known@example.test", zonePresenceConsent: false, now: at(1) }));
    expect(ok).toMatchObject({ status: "registered", attendee_id: first.attendee_id });
    const inv2 = await createInvitation(db, devCipher, { eventId: other.eventId, email: "known@example.test", expiresAt: at(60), now: T0 });
    const dup = await asApi(() => rsvpInvitation(db, devCipher, { token: inv2.token!, email: "known@example.test", zonePresenceConsent: false, now: at(1) }));
    expect(dup.status).toBe("already_registered");
    const [still] = await db.select().from(s.invitations).where(eq(s.invitations.id, inv2.invitation_id));
    expect(still!.state).toBe("sent");
  });

  it("expires outstanding invitations", async () => {
    const inv = await createInvitation(db, devCipher, { eventId: v.eventId, email: "late@example.test", expiresAt: at(10), now: T0 });
    expect((await rsvpInvitation(db, devCipher, { token: inv.token!, email: "late@example.test", zonePresenceConsent: false, now: at(11) })).status).toBe("expired");
    expect(await expireInvitations(db, at(11))).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(s.invitations).where(eq(s.invitations.id, inv.invitation_id));
    expect(row!.state).toBe("expired");
  });
});

describe("registration", () => {
  it("self-service and operator registration, with duplicate detection by address", async () => {
    const a = await asApi(() =>
      registerAttendee(db, devCipher, { eventId: v.eventId, tier: "ORDINARY", state: "confirmed", email: "new.person@example.test", fullName: "New Person", zonePresenceConsent: true, credentialRef: credentialRef() }),
    );
    expect(a.status).toBe("registered");
    expect(a.credential_id).not.toBeNull();
    const b = await asApi(() => registerAttendee(db, devCipher, { eventId: v.eventId, tier: "VIP", state: "pending_approval", email: "NEW.person@example.test", zonePresenceConsent: false }));
    expect(b).toMatchObject({ status: "already_registered", attendee_id: a.attendee_id, registration_id: a.registration_id });
  });

  it("kiosk: an anonymous Public attendee with a credential and a reusable band, no personal data", async () => {
    await importCarrierIdentifiers(db, [b64Hash("kiosk-band")], { chipProfile: "ntag_uid" });
    const r = await asApi(() => registerPublicAttendee(db, devCipher, { eventId: v.eventId, zonePresenceConsent: true, credentialRef: credentialRef(), bandIdentifier: b64Hash("kiosk-band") }));
    expect(r).toMatchObject({ status: "registered", band_status: "bound" });
    const att = await readAttendee(db, devCipher, r.attendee_id, "system");
    expect(att).toMatchObject({ email: null, full_name: null, profile: {} });
    const [reg] = await db.select().from(s.registrations).where(eq(s.registrations.id, r.registration_id));
    expect(reg).toMatchObject({ tier: "PUBLIC", state: "confirmed" });
  });

  it("operator tier change: audited with reason, advances the epoch; reason required", async () => {
    const a = await registerAttendee(db, devCipher, { eventId: v.eventId, tier: "ORDINARY", state: "confirmed", email: "upgrade@example.test", zonePresenceConsent: false });
    const e0 = await revocationEpoch(db, v.eventId);
    const r = await asApi(() => changeRegistrationTier(db, { registrationId: a.registration_id, tier: "VIP", actorId: op, reason: "sponsor guest", mfaAt: T0 }));
    expect(r).toMatchObject({ status: "changed", from_tier: "ORDINARY" });
    const [audit] = await db.select().from(s.audit_log).where(eq(s.audit_log.id, r.audit_id!));
    expect(audit).toMatchObject({ action: "registration.tier_change", meta_jsonb: { from: "ORDINARY", to: "VIP", reason: "sponsor guest" } });
    expect(await revocationEpoch(db, v.eventId)).toBe(e0 + 1);
    expect((await changeRegistrationTier(db, { registrationId: a.registration_id, tier: "VIP", actorId: op, reason: "again" })).status).toBe("unchanged");
    await rejects(changeRegistrationTier(db, { registrationId: a.registration_id, tier: "ORDINARY", actorId: op, reason: " " }), /needs an actor and a reason/);
  });

  it("approval and cancellation; cancelling revokes the credential", async () => {
    const a = await registerAttendee(db, devCipher, { eventId: v.eventId, tier: "VIP", state: "pending_approval", email: "pending@example.test", zonePresenceConsent: false });
    expect((await setRegistrationState(db, { registrationId: a.registration_id, state: "confirmed", actorId: op })).status).toBe("changed");
    const c = await asApi(async () => {
      const { issueCredential } = await import("../src/registration");
      return issueCredential(db, { registrationId: a.registration_id, ref: credentialRef() });
    });
    expect(c.status).toBe("issued");
    expect((await setRegistrationState(db, { registrationId: a.registration_id, state: "pending_approval" })).status).toBe("not_allowed");
    expect((await setRegistrationState(db, { registrationId: a.registration_id, state: "cancelled", actorId: op })).status).toBe("changed");
    const [cred] = await db.select().from(s.credentials).where(eq(s.credentials.id, c.credential_id));
    expect(cred!.state).toBe("revoked");
  });
});

describe("data requests", () => {
  it("queue export and erasure requests, process them, and end the person's sessions on erasure", async () => {
    const a = await registerAttendee(db, devCipher, { eventId: v.eventId, tier: "ORDINARY", state: "confirmed", email: "rights@example.test", fullName: "Rita Rights", zonePresenceConsent: true });
    const ex = await asApi(() => openDataRequest(db, a.attendee_id, "export"));
    expect(ex.status).toBe("opened");
    expect((await openDataRequest(db, a.attendee_id, "export")).status).toBe("already_open");
    const claimed = await asApi(() => claimDataRequest(db, { kind: "export", handlerId: op }));
    expect(claimed).toMatchObject({ id: ex.request_id, state: "in_progress" });
    expect(await claimDataRequest(db, { kind: "export" })).toBeNull();
    const bundle = await collectAttendeeExport({ db, vault: db, cipher: devCipher }, a.attendee_id);
    expect(bundle.identity).toMatchObject({ email: "rights@example.test", full_name: "Rita Rights" });
    expect(bundle.registrations).toHaveLength(1);
    expect(await finishDataRequest(db, ex.request_id, { state: "completed", objectKey: "exports/x.zip", actorId: op })).toBe("completed");

    const token = newToken();
    await startSession(db, { holder: { attendeeId: a.attendee_id }, familyId: crypto.randomUUID(), tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) });
    const er = await openDataRequest(db, a.attendee_id, "erasure");
    const job = (await claimDataRequest(db, { kind: "erasure" }))!;
    expect(job.id).toBe(er.request_id);
    await processErasureRequest({ db, vault: db }, job, op);
    expect(await readAttendee(db, devCipher, a.attendee_id, "system")).toMatchObject({ email: null, full_name: null });
    expect((await rotateSession(db, { tokenHash: hashToken(token), newTokenHash: hashToken(newToken()), expiresAt: new Date(Date.now() + 86_400_000) })).status).toBe("revoked");
    const list = await listDataRequests(db, { kind: "erasure" });
    expect(list.items[0]).toMatchObject({ state: "completed" });
    expect(await finishDataRequest(db, er.request_id, { state: "rejected" })).toBe("not_open");
  });
});
