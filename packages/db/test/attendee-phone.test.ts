/**
 * 0030–0031: the attendee's optional phone is an encrypted vault column, re-encrypted with the
 * others, scrubbed by erasure; erasure also deletes the attendee's pending registrations.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eraseAttendee } from "../src/functions";
import { hashToken, newToken } from "../src/auth";
import { createPendingRegistration } from "../src/pending-registrations";
import * as s from "../src/schema/index";
import { createAttendee, readAttendee, reencryptSecrets, updateAttendeeIdentity } from "../src/secrets";
import { devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
});

describe("attendee phone (0030–0031)", () => {
  it("is held encrypted, bound to its row and column, and read back decrypted", async () => {
    const id = await createAttendee(db, devCipher, { email: "phone-1@example.test", full_name: "Pho Ne", phone: "+256 700 123456" });
    const stored = await db.transaction(async (tx) => {
      await tx.execute("select set_config('app.vault_scope', 'system', true)" as never);
      return (await tx.select().from(s.attendees)).find((r) => r.id === id)!.phone!;
    });
    expect(stored).toMatch(/^ev1\./);
    expect(stored).not.toContain("123456");
    expect((await readAttendee(db, devCipher, id, "system"))!.phone).toBe("+256 700 123456");
    expect(await updateAttendeeIdentity(db, devCipher, id, { phone: null }, "system")).toBe(true);
    expect((await readAttendee(db, devCipher, id, "system"))!.phone).toBeNull();
    // An attendee without a phone reads null (nothing written).
    const other = await createAttendee(db, devCipher, { email: "phone-2@example.test", full_name: "No Phone" });
    expect((await readAttendee(db, devCipher, other, "system"))!.phone).toBeNull();
  });

  it("refuses a plaintext phone", async () => {
    const id = await createAttendee(db, devCipher, { email: "phone-3@example.test" });
    await rejects(
      db.transaction(async (tx) => {
        await tx.execute("select set_config('app.vault_scope', 'system', true)" as never);
        await tx.execute(`update pii_vault.attendees set phone = '+256700000000' where id = '${id}'` as never);
      }),
      /attendees_phone_encrypted/,
    );
  });

  it("is re-encrypted by the key rotation run (plaintext-free columns stay readable)", async () => {
    const id = await createAttendee(db, devCipher, { email: "phone-4@example.test", phone: "+44 20 7946 0000" });
    const summary = await reencryptSecrets({ db, cipher: devCipher });
    expect(summary["attendees.phone"]).toBeDefined();
    expect((await readAttendee(db, devCipher, id, "system"))!.phone).toBe("+44 20 7946 0000");
  });

  it("is scrubbed by erasure, which also deletes the attendee's pending registrations", async () => {
    const id = await createAttendee(db, devCipher, { email: "phone-5@example.test", full_name: "Era Sed", phone: "+256 700 999999" });
    await createPendingRegistration(db, devCipher, {
      linkTokenHash: hashToken(newToken()), attendeeId: id, eventId: v.eventId, zonePresenceConsent: true,
      answers: { phone: "+256 700 999999" }, expiresAt: new Date(Date.now() + 900_000),
    });
    expect(await eraseAttendee(db, id)).toBe(true);
    const after = await readAttendee(db, devCipher, id, "system");
    expect(after).toMatchObject({ email: null, full_name: null, phone: null, profile: {} });
    const left = await db.transaction(async (tx) => {
      await tx.execute("select set_config('app.vault_scope', 'system', true)" as never);
      return (await tx.select().from(s.pending_registrations)).filter((r) => r.attendee_id === id);
    });
    expect(left).toHaveLength(0);
  });
});
