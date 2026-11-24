/**
 * 0028–0029: refresh reuse grace, allowlist age on heartbeats and in gate health, pending
 * registrations in the vault, append-only scan voids.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { hashToken, newToken, rotateSession, startSession } from "../src/auth";
import { gateHealth, recordHeartbeat, registerDevice } from "../src/operations";
import { cleanupPendingRegistrations, createPendingRegistration, deletePendingRegistrationsOf, takePendingRegistration } from "../src/pending-registrations";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { attendeeWithCredential, devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let userId: string;
const T0 = new Date("2026-12-01T10:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const ttl = { userSeconds: 3600, attendeeSeconds: 7200 };

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  userId = await insertUser(db, devCipher, { email: "gap-op@example.test", role: "organiser" });
});

async function family(ctx: { userAgent?: string; ip?: string } = { userAgent: "UA-1", ip: "203.0.113.5" }) {
  const token = newToken();
  await startSession(db, { holder: { userId }, familyId: randomUUID(), tokenHash: hashToken(token), expiresAt: at(86_400), now: T0, ...ctx });
  return token;
}
const rotate = (token: string, now: Date, ctx: { userAgent?: string; ip?: string } = { userAgent: "UA-1", ip: "203.0.113.5" }, graceSeconds = 10) => {
  const next = newToken();
  return rotateSession(db, { tokenHash: hashToken(token), newTokenHash: hashToken(next), ttl, now, graceSeconds, ...ctx }).then((r) => ({ ...r, next }));
};

describe("refresh reuse grace (0029)", () => {
  it("re-issues a token presented again within the window by the same client while its child is unused", async () => {
    await q(db, "set role app_api");
    try {
      const a = await family();
      const b = await rotate(a, at(1)); // the response is lost
      expect(b.status).toBe("rotated");
      const c = await rotate(a, at(4)); // the client retries with the old token
      expect(c.status).toBe("rotated");
      expect(c.reissued).toBe(true);
      expect(c.family_id).toBe(b.family_id);
      // The lost token is superseded: presenting it now is reuse and ends the family.
      const d = await rotate(b.next, at(5));
      expect(d.status).toBe("reuse_detected");
      expect((await rotate(c.next, at(6))).status).toBe("revoked");
    } finally {
      await q(db, "reset role");
    }
  });

  it("is still theft outside the window, from another client, once the child was used, or with no grace", async () => {
    const late = await family();
    await rotate(late, at(1));
    expect((await rotate(late, at(30))).status).toBe("reuse_detected");

    const other = await family();
    await rotate(other, at(1));
    expect((await rotate(other, at(3), { userAgent: "Evil", ip: "198.51.100.7" })).status).toBe("reuse_detected");
    const otherNet = await family();
    await rotate(otherNet, at(1));
    expect((await rotate(otherNet, at(3), { userAgent: "UA-1", ip: "198.51.100.7" })).status).toBe("reuse_detected");

    const used = await family();
    const child = await rotate(used, at(1));
    expect((await rotate(child.next, at(2))).status).toBe("rotated");
    expect((await rotate(used, at(3))).status).toBe("reuse_detected");

    const off = await family();
    await rotate(off, at(1));
    expect((await rotate(off, at(2), undefined, 0)).status).toBe("reuse_detected");
  });
});

describe("allowlist age (0029)", () => {
  it("is recorded by the heartbeat and reported per gate, stale past 15 minutes", async () => {
    const d = await registerDevice(db, { venueId: v.venueId, kind: "scanner", label: "Phone", hardwareId: `PH-${randomUUID()}`, checkpointId: v.cpPerimeter });
    expect(await recordHeartbeat(db, { deviceId: d.id, checkpointId: v.cpPerimeter, queueDepth: 0, allowlistIssuedAt: at(-60), now: at(0) })).toBe("ok");
    let g = (await gateHealth(db, v.venueId, { now: at(1) })).find((x) => x.checkpoint_id === v.cpPerimeter)!;
    expect(g.allowlist_issued_at?.toISOString()).toBe(at(-60).toISOString());
    expect(g.allowlist_stale).toBe(false);
    // A heartbeat without the field keeps the last one reported.
    await recordHeartbeat(db, { deviceId: d.id, checkpointId: v.cpPerimeter, now: at(16 * 60) });
    g = (await gateHealth(db, v.venueId, { now: at(16 * 60) })).find((x) => x.checkpoint_id === v.cpPerimeter)!;
    expect(g.allowlist_stale).toBe(true);
    // A device not heard from for 15 minutes no longer counts.
    g = (await gateHealth(db, v.venueId, { now: at(40 * 60) })).find((x) => x.checkpoint_id === v.cpPerimeter)!;
    expect(g.allowlist_issued_at).toBeNull();
    expect(g.allowlist_stale).toBe(false);
  });
});

describe("pending registrations (0028–0029)", () => {
  it("are held encrypted in the vault, taken once, and expire", async () => {
    const { attendeeId } = await attendeeWithCredential(db, v.eventId);
    const link = hashToken(newToken());
    await q(db, "set role app_vault");
    try {
      await createPendingRegistration(db, devCipher, {
        linkTokenHash: link, attendeeId, eventId: v.eventId, zonePresenceConsent: true, answers: { company: "Acme", phone: "+256 700 000000" }, expiresAt: at(900), now: T0,
      });
      // Without a vault scope nothing is visible.
      expect(await q(db, "select * from pii_vault.pending_registrations")).toHaveLength(0);
      const raw = await db.transaction(async (tx) => {
        await tx.execute("select set_config('app.vault_scope', 'system', true)" as never);
        return tx.select().from(s.pending_registrations);
      });
      expect(raw.find((r) => r.link_token_hash === link)!.answers_enc).toMatch(/^ev1\./);
      const taken = await takePendingRegistration(db, devCipher, link, at(10));
      expect(taken).toMatchObject({ attendee_id: attendeeId, event_id: v.eventId, zone_presence_consent: true, answers: { company: "Acme" } });
      expect(await takePendingRegistration(db, devCipher, link, at(11))).toBeNull();

      const late = hashToken(newToken());
      await createPendingRegistration(db, devCipher, { linkTokenHash: late, attendeeId, eventId: v.eventId, zonePresenceConsent: false, answers: {}, expiresAt: at(900) });
      expect(await takePendingRegistration(db, devCipher, late, at(901))).toBeNull(); // expired: deleted, not returned
      await createPendingRegistration(db, devCipher, { linkTokenHash: hashToken(newToken()), attendeeId, eventId: v.eventId, zonePresenceConsent: false, answers: {}, expiresAt: at(900) });
      await createPendingRegistration(db, devCipher, { linkTokenHash: hashToken(newToken()), attendeeId, eventId: v.eventId, zonePresenceConsent: false, answers: {}, expiresAt: at(5000) });
      expect(await cleanupPendingRegistrations(db, at(1000))).toBe(1);
      expect(await deletePendingRegistrationsOf(db, attendeeId)).toBe(1);
    } finally {
      await q(db, "reset role");
    }
  });

  it("refuse plaintext answers and the general application role", async () => {
    const { attendeeId } = await attendeeWithCredential(db, v.eventId);
    await rejects(
      db.transaction(async (tx) => {
        await tx.execute("select set_config('app.vault_scope', 'system', true)" as never);
        await tx.insert(s.pending_registrations).values({ link_token_hash: hashToken("x"), attendee_id: attendeeId, event_id: v.eventId, zone_presence_consent: false, answers_enc: "{}", expires_at: at(60) });
      }),
      /pending_registrations_answers_encrypted/,
    );
    await q(db, "set role app_api");
    try {
      await rejects(q(db, "select * from pii_vault.pending_registrations"), /permission denied/);
    } finally {
      await q(db, "reset role");
    }
  });
});

describe("scan voids and the undo adjustment reason (0028–0029)", () => {
  it("are append-only and accept scan_undo corrections", async () => {
    const [row] = await db.insert(s.scan_voids).values({ event_id: v.eventId, scan_id: randomUUID(), voided_by: userId, reason: "wrong person" }).returning();
    await rejects(q(db, "update public.scan_voids set reason = 'x' where id = $1", [row!.id]), /append-only/);
    await rejects(db.insert(s.scan_voids).values({ event_id: v.eventId, scan_id: row!.scan_id }), /scan_voids_scan_uq/);
    await db.insert(s.occupancy_adjustments).values({ event_id: v.eventId, room_id: v.roomA, delta: -1, reason: "scan_undo", note: "undo" });
  });
});
