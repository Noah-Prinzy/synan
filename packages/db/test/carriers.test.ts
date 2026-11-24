import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { revocationEpoch } from "../src/allowlist";
import {
  bindCarrier,
  carrierInventory,
  confirmCarrier,
  importBands,
  importCarrierIdentifiers,
  importCarriers,
  nfcIdentifierHash,
  nfcIdentifierHint,
  noteCarrierHints,
  rebindCarrier,
  replaceLostBand,
} from "../src/carriers";
import * as s from "../src/schema/index";
import { attendeeWithCredential, b64Hash, credentialRef, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
const uid = (i: number) => `04${i.toString(16).toUpperCase().padStart(12, "0")}`;

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
});

describe("bulk import", () => {
  it("hashes UIDs like the scan path, inserts thousands, and reports duplicates and malformed rows without failing", async () => {
    expect(nfcIdentifierHash("04a1b2c3")).toBe(nfcIdentifierHash("04A1B2C3"));
    expect(nfcIdentifierHash("04A1B2C3")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const uids = Array.from({ length: 3000 }, (_, i) => uid(i));
    const input = [...uids, uid(5), uid(2999), "not-a-uid", "04ZZ"];
    const t0 = performance.now();
    const r = await importBands(db, input, { chipProfile: "ntag_uid", chunk: 1000 });
    console.log(`imported ${r.inserted} bands in ${(performance.now() - t0).toFixed(0)} ms`);
    expect(r.inserted).toBe(3000);
    expect(r.duplicateUids.sort()).toEqual([uid(2999), uid(5)].sort());
    expect(r.invalidUids).toEqual(["not-a-uid", "04ZZ"]);
    const again = await importBands(db, uids.slice(0, 10));
    expect(again).toMatchObject({ inserted: 0, invalidUids: [] });
    expect(again.duplicateUids).toHaveLength(10);
    const raw = await importCarrierIdentifiers(db, ["short", b64Hash("x"), b64Hash("x")]);
    expect(raw).toEqual({ inserted: 1, duplicates: [b64Hash("x")], invalid: ["short"] });
    expect((await carrierInventory(db)).stock).toBe(3001);
    // The readable hint (0035): the UID's last four, upper-case hex; the UID itself is not stored.
    const [b] = await db.select().from(s.carriers).where(eq(s.carriers.identifier, nfcIdentifierHash(uid(42))));
    expect(b!.identifier_hint).toBe(uid(42).slice(-4));
    expect(JSON.stringify(b)).not.toContain(uid(42));
  });

  it("notes a hint when a UID is presented, once, and refuses a malformed hint (0035)", async () => {
    await importCarrierIdentifiers(db, [nfcIdentifierHash("04AABBCCDD81bf")]);
    expect(await noteCarrierHints(db, ["04aabbccdd81BF", "not hex"])).toBe(1);
    const [c] = await db.select().from(s.carriers).where(eq(s.carriers.identifier, nfcIdentifierHash("04AABBCCDD81BF")));
    expect(c!.identifier_hint).toBe("81BF");
    expect(nfcIdentifierHint(" 04aabbccdd81bf ")).toBe("81BF");
    expect(await noteCarrierHints(db, ["04AABBCCDD81BF"])).toBe(0); // already noted
    await rejects(db.update(s.carriers).set({ identifier_hint: "81bf" }).where(eq(s.carriers.id, c!.id)), /carriers_identifier_hint_shape/);
  });
});

describe("importCarriers (row shape)", () => {
  it("imports identifier hashes with chip profiles and reports duplicates and invalid rows", async () => {
    const rows = [
      { identifier_hash: b64Hash("r1"), chip_profile: "ntag424_dna" as const },
      { identifier_hash: b64Hash("r2"), chip_profile: "ntag_uid" as const },
      { identifier_hash: b64Hash("r1"), chip_profile: "ntag_uid" as const },
      { identifier_hash: "bad" },
    ];
    const r = await importCarriers(db, rows);
    expect(r).toEqual({ imported: 2, duplicates: [b64Hash("r1")], invalid: ["bad"] });
    const [k] = await db.select().from(s.carriers).where(eq(s.carriers.identifier, b64Hash("r1")));
    expect(k!.chip_profile).toBe("ntag424_dna");
  });
});

describe("bind, rebind, lost and replace", () => {
  it("binds a stock band (assign then confirm), refuses a second band and unusable credentials", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    const assigned = await bindCarrier(db, { identifier: nfcIdentifierHash(uid(10)), credentialId: a.credentialId, confirm: false });
    expect(assigned).toMatchObject({ status: "assigned", carrier_state: "assigned" });
    const c = await confirmCarrier(db, assigned.carrier_id!);
    expect(c.status).toBe("bound");
    expect((await confirmCarrier(db, assigned.carrier_id!)).status).toBe("not_assigned");
    expect((await bindCarrier(db, { identifier: nfcIdentifierHash(uid(11)), credentialId: a.credentialId })).status).toBe("credential_has_carrier");
    expect((await bindCarrier(db, { identifier: nfcIdentifierHash(uid(10)), credentialId: a.credentialId })).status).toBe("not_in_stock");
    expect((await bindCarrier(db, { identifier: b64Hash("never-imported"), credentialId: a.credentialId })).status).toBe("unknown_carrier");
    const b = await attendeeWithCredential(db, v.eventId);
    await q(db, `update credentials set state = 'revoked', revoked_at = now() where id = $1`, [b.credentialId]);
    expect((await bindCarrier(db, { identifier: nfcIdentifierHash(uid(12)), credentialId: b.credentialId })).status).toBe("credential_not_usable");
    const audits = await db.select().from(s.audit_log).where(inArray(s.audit_log.id, [assigned.audit_id!, c.audit_id!]));
    expect(audits.map((x) => x.action).sort()).toEqual(["carrier.assign", "carrier.bind"]);
  });

  it("rebinds a damaged band keeping the credential", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await bindCarrier(db, { identifier: nfcIdentifierHash(uid(20)), credentialId: a.credentialId });
    const r = await rebindCarrier(db, { credentialId: a.credentialId, newIdentifier: nfcIdentifierHash(uid(21)) });
    expect(r.status).toBe("rebound");
    expect(r.audit_ids).toHaveLength(2);
    const bands = await db.select().from(s.carriers).where(eq(s.carriers.credential_id, a.credentialId));
    expect(bands.map((x) => x.state).sort()).toEqual(["bound", "retired"]);
    const [cred] = await db.select().from(s.credentials).where(eq(s.credentials.id, a.credentialId));
    expect(cred!.state).toBe("active");
  });

  it("replaces a lost band: band lost, credential replaced and re-issued, new band bound, four audit entries", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await q(db, `update credentials set zone_state = $1 where id = $2`, [`INSIDE_${v.zoneId}`, a.credentialId]);
    await db.insert(s.carriers).values([
      { credential_id: a.credentialId, kind: "qr_portal", state: "active" },
      { credential_id: a.credentialId, kind: "qr_email", identifier: b64Hash("mail-a"), state: "active" },
    ]);
    await bindCarrier(db, { identifier: nfcIdentifierHash(uid(30)), credentialId: a.credentialId });
    const epoch = await revocationEpoch(db, v.eventId);
    const ref = credentialRef();
    const r = await replaceLostBand(db, { lostIdentifier: nfcIdentifierHash(uid(30)), newIdentifier: nfcIdentifierHash(uid(31)), newCredentialRef: ref });
    expect(r.status).toBe("replaced");
    expect(r.old_credential_id).toBe(a.credentialId);
    const audits = await db.select().from(s.audit_log).where(inArray(s.audit_log.id, r.audit_ids));
    expect(r.audit_ids.map((id) => audits.find((x) => x.id === id)!.action)).toEqual([
      "carrier.mark_lost", "credential.replace", "credential.reissue", "carrier.bind",
    ]);
    const [oldC] = await db.select().from(s.credentials).where(eq(s.credentials.id, a.credentialId));
    const [newC] = await db.select().from(s.credentials).where(eq(s.credentials.id, r.new_credential_id!));
    expect(oldC).toMatchObject({ state: "replaced", replaced_by_id: newC!.id });
    expect(newC).toMatchObject({ registration_id: a.registrationId, token_hash: ref, state: "active", zone_state: `INSIDE_${v.zoneId}` });
    const oldCarriers = await db.select().from(s.carriers).where(eq(s.carriers.credential_id, a.credentialId));
    expect(oldCarriers.map((x) => `${x.kind}:${x.state}`).sort()).toEqual(["nfc:lost", "qr_email:retired", "qr_portal:retired"]);
    const newCarriers = await db.select().from(s.carriers).where(eq(s.carriers.credential_id, newC!.id));
    expect(newCarriers.map((x) => `${x.kind}:${x.state}`).sort()).toEqual(["nfc:bound", "qr_portal:active"]);
    expect(await revocationEpoch(db, v.eventId)).toBeGreaterThan(epoch);
    // The lost band cannot be re-imported or re-bound while it is recorded as lost.
    expect((await importBands(db, [uid(30)])).duplicateUids).toEqual([uid(30)]);
    expect((await replaceLostBand(db, { lostIdentifier: nfcIdentifierHash(uid(30)), newIdentifier: nfcIdentifierHash(uid(32)), newCredentialRef: credentialRef() })).status).toBe("carrier_not_live");
  });
});

describe("state machines", () => {
  it("refuse illegal credential transitions", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await q(db, `update credentials set state = 'revoked', revoked_at = now() where id = $1`, [a.credentialId]);
    await rejects(q(db, `update credentials set state = 'active', revoked_at = null where id = $1`, [a.credentialId]), /cannot move from revoked to active/);
    const b = await attendeeWithCredential(db, v.eventId);
    await q(db, `update credentials set state = 'replaced' where id = $1`, [b.credentialId]);
    await rejects(q(db, `update credentials set state = 'suspended_review' where id = $1`, [b.credentialId]), /cannot move from replaced/);
  });

  it("refuse illegal carrier transitions", async () => {
    const [k] = await db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("sm"), state: "stock" }).returning();
    const a = await attendeeWithCredential(db, v.eventId);
    await rejects(q(db, `update carriers set state = 'bound', credential_id = $2 where id = $1`, [k!.id, a.credentialId]), /cannot move from stock to bound/);
    await q(db, `update carriers set state = 'retired' where id = $1`, [k!.id]);
    await rejects(q(db, `update carriers set state = 'stock' where id = $1`, [k!.id]), /cannot move from retired to stock/);
  });
});
