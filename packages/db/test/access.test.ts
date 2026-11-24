import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  accessPermits,
  credentialMayEnter,
  diffAccessRuleVersions,
  diffProposedAccessRules,
  readAccessRules,
  replaceAccessRules,
  type AccessRuleInput,
} from "../src/access-rules";
import { allowlistEntries, buildAllowlist, revocationEpoch } from "../src/allowlist";
import { bindCarrier, importCarrierIdentifiers } from "../src/carriers";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { attendeeWithCredential, b64Hash, credentialRef, devCipher, miniVenue, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
const T = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
});

const baseRules = (): AccessRuleInput[] => [
  { subject_kind: "tier", subject: "VIP", room_id: v.roomA, effect: "permit" },
  { subject_kind: "tier", subject: "ORDINARY", room_id: v.roomA, window_start: T("10:00"), window_end: T("12:00"), effect: "permit" },
  { subject_kind: "tier", subject: "ORDINARY", room_id: v.roomA, window_start: T("11:00"), window_end: T("11:30"), effect: "deny" },
  { subject_kind: "role", subject: "crew", room_id: v.roomB, effect: "permit" },
];

describe("access rules", () => {
  it("replace atomically with a version check, snapshot every version, and audit", async () => {
    expect((await readAccessRules(db, v.eventId)).version).toBe(0);
    const conflict = await replaceAccessRules(db, v.eventId, 5, baseRules());
    expect(conflict).toMatchObject({ status: "version_conflict", version: 0 });
    const r1 = await replaceAccessRules(db, v.eventId, 0, baseRules());
    expect(r1).toMatchObject({ status: "ok", version: 1, added: 4, removed: 0 });
    const set = await readAccessRules(db, v.eventId);
    expect(set.version).toBe(1);
    expect(set.rules).toHaveLength(4);
    const audit = await db.select().from(s.audit_log).where(eq(s.audit_log.id, r1.audit_id!));
    expect(audit[0]).toMatchObject({ action: "access_rules.republish", target: `event:${v.eventId}`, meta_jsonb: { from_version: 0, to_version: 1, added: 4, removed: 0 } });
    // Stale writers lose.
    expect((await replaceAccessRules(db, v.eventId, 0, [])).status).toBe("version_conflict");
  });

  it("refuse an invalid rule and leave the previous set untouched", async () => {
    const [stray] = await db.insert(s.rooms).values({ venue_id: v.venueId, zone_id: v.zoneId, name: "Not in event", capacity: 5 }).returning();
    await rejects(
      replaceAccessRules(db, v.eventId, 1, [...baseRules(), { subject_kind: "tier", subject: "VIP", room_id: stray!.id, effect: "permit" }]),
      /access_rules_event_room_fk/,
    );
    await rejects(replaceAccessRules(db, v.eventId, 1, [{ subject_kind: "tier", subject: "crew", room_id: v.roomA, effect: "permit" }]), /access_rules_subject_valid/);
    expect(await readAccessRules(db, v.eventId)).toMatchObject({ version: 1 });
    expect((await readAccessRules(db, v.eventId)).rules).toHaveLength(4);
  });

  it("diff proposed rules and any two versions", async () => {
    const proposed = baseRules().filter((r) => r.subject !== "crew");
    proposed.push({ subject_kind: "tier", subject: "PUBLIC", room_id: v.roomB, effect: "permit" });
    const d = await diffProposedAccessRules(db, v.eventId, proposed);
    expect(d.map((x) => `${x.change}:${x.subject}:${x.room_id === v.roomB ? "B" : "A"}`)).toEqual(["added:PUBLIC:B", "removed:crew:B"]);
    expect((await replaceAccessRules(db, v.eventId, 1, proposed)).version).toBe(2);
    expect((await diffAccessRuleVersions(db, v.eventId, 1, 2)).map((x) => `${x.change}:${x.subject}`)).toEqual(["added:PUBLIC", "removed:crew"]);
    expect((await diffAccessRuleVersions(db, v.eventId, 0, 2)).filter((x) => x.change === "added")).toHaveLength(4);
    expect(await diffAccessRuleVersions(db, v.eventId, 2)).toEqual([]);
    // The windows survive the round trip exactly.
    const ord = (await diffAccessRuleVersions(db, v.eventId, 0, 1)).find((x) => x.subject === "ORDINARY" && x.effect === "deny")!;
    expect([ord.window_start!.toISOString(), ord.window_end!.toISOString()]).toEqual([T("11:00").toISOString(), T("11:30").toISOString()]);
    expect((await replaceAccessRules(db, v.eventId, 2, baseRules())).version).toBe(3);
  });

  it("resolve entitlement: windows, deny wins, default deny", async () => {
    const ord = { kind: "tier" as const, value: "ORDINARY" };
    expect(await accessPermits(db, v.eventId, ord, v.roomA, T("09:59"))).toBe(false);
    expect(await accessPermits(db, v.eventId, ord, v.roomA, T("10:00"))).toBe(true);
    expect(await accessPermits(db, v.eventId, ord, v.roomA, T("11:15"))).toBe(false); // deny window
    expect(await accessPermits(db, v.eventId, ord, v.roomA, T("11:30"))).toBe(true);
    expect(await accessPermits(db, v.eventId, ord, v.roomA, T("12:00"))).toBe(false); // window end is exclusive
    expect(await accessPermits(db, v.eventId, { kind: "tier", value: "VIP" }, v.roomA, T("03:00"))).toBe(true);
    expect(await accessPermits(db, v.eventId, { kind: "tier", value: "PUBLIC" }, v.roomA, T("10:30"))).toBe(false);
    expect(await accessPermits(db, v.eventId, { kind: "role", value: "crew" }, v.roomB, T("10:30"))).toBe(true);
  });

  it("resolve a credential's subject and say why it may not enter", async () => {
    const a = await attendeeWithCredential(db, v.eventId, "ORDINARY");
    expect(await credentialMayEnter(db, v.eventId, a.credentialId, v.roomA, T("10:30"))).toEqual({ allowed: true, reason: "ok", subject_kind: "tier", subject: "ORDINARY" });
    expect((await credentialMayEnter(db, v.eventId, a.credentialId, v.roomB, T("10:30"))).reason).toBe("not_permitted");
    const other = await miniVenue(db);
    expect((await credentialMayEnter(db, other.eventId, a.credentialId, other.roomA)).reason).toBe("not_in_event");
    const crewUser = await insertUser(db, devCipher, { email: "crew@example.test", role: "crew" });
    const [cc] = await db.insert(s.credentials).values({ staff_user_id: crewUser, token_hash: credentialRef(), state: "active" }).returning();
    expect(await credentialMayEnter(db, v.eventId, cc!.id, v.roomB)).toMatchObject({ allowed: true, subject_kind: "role", subject: "crew" });
    await db.update(s.credentials).set({ state: "revoked", revoked_at: new Date() }).where(eq(s.credentials.id, a.credentialId));
    expect((await credentialMayEnter(db, v.eventId, a.credentialId, v.roomA, T("10:30"))).reason).toBe("credential_not_usable");
  });
});

describe("offline allowlist", () => {
  let ev: MiniVenue;
  let vip: Awaited<ReturnType<typeof attendeeWithCredential>>;
  let ord: Awaited<ReturnType<typeof attendeeWithCredential>>;
  let gone: Awaited<ReturnType<typeof attendeeWithCredential>>;
  let crewCred: string;

  beforeAll(async () => {
    ev = await miniVenue(db);
    await replaceAccessRules(db, ev.eventId, 0, baseRules().map((r) => ({ ...r, room_id: r.room_id === v.roomA ? ev.roomA : ev.roomB })));
    vip = await attendeeWithCredential(db, ev.eventId, "VIP");
    ord = await attendeeWithCredential(db, ev.eventId, "ORDINARY");
    gone = await attendeeWithCredential(db, ev.eventId, "ORDINARY");
    await db.update(s.registrations).set({ state: "cancelled" }).where(eq(s.registrations.id, gone.registrationId));
    const crewUser = await insertUser(db, devCipher, { email: "crew2@example.test", role: "crew" });
    crewCred = (await db.insert(s.credentials).values({ staff_user_id: crewUser, token_hash: credentialRef(), state: "active" }).returning())[0]!.id;
    const bands = [b64Hash("band-v"), b64Hash("band-o"), b64Hash("band-o2")];
    await importCarrierIdentifiers(db, bands);
    await bindCarrier(db, { identifier: bands[0]!, credentialId: vip.credentialId });
    await bindCarrier(db, { identifier: bands[1]!, credentialId: ord.credentialId });
    await q(db, `update carriers set state = 'lost' where identifier = $1`, [bands[1]]);
    await bindCarrier(db, { identifier: bands[2]!, credentialId: ord.credentialId });
  });

  it("lists every credential with subject, effective state and band hashes, and exact room windows per subject", async () => {
    const al = await buildAllowlist(db, ev.eventId, { from: T("09:00"), to: T("13:00") });
    expect(al.access_rules_version).toBe(1);
    expect(al.subjects["tier:VIP"]).toEqual([{ room_id: ev.roomA, windows: [[T("09:00").toISOString(), T("13:00").toISOString()]] }]);
    expect(al.subjects["tier:ORDINARY"]).toEqual([
      { room_id: ev.roomA, windows: [[T("10:00").toISOString(), T("11:00").toISOString()], [T("11:30").toISOString(), T("12:00").toISOString()]] },
    ]);
    expect(al.subjects["role:crew"]![0]!.room_id).toBe(ev.roomB);
    const byRef = Object.fromEntries(al.entries.map((e) => [e.credential_ref, e]));
    const refOf = async (id: string) => (await db.select({ t: s.credentials.token_hash }).from(s.credentials).where(eq(s.credentials.id, id)))[0]!.t;
    expect(byRef[await refOf(vip.credentialId)]).toMatchObject({ subject: "VIP", effective_state: "active", nfc_hashes: [b64Hash("band-v")], permitted_room_ids: [ev.roomA] });
    expect(byRef[await refOf(ord.credentialId)]).toMatchObject({ nfc_hashes: [b64Hash("band-o2")], dead_nfc_hashes: [b64Hash("band-o")] });
    expect(byRef[await refOf(gone.credentialId)]!.effective_state).toBe("revoked");
    expect(byRef[await refOf(crewCred)]).toMatchObject({ subject_kind: "role", subject: "crew", permitted_room_ids: [ev.roomB] });
    // No identity anywhere in the payload.
    expect(JSON.stringify(al)).not.toMatch(/@|Test Person|attendee_id|registration_id/);
    // Limited to the rooms behind given checkpoints.
    const onlyB = await buildAllowlist(db, ev.eventId, { from: T("09:00"), to: T("13:00"), checkpointIds: [ev.cpBin] });
    expect(Object.keys(onlyB.subjects)).toEqual(["role:crew"]);
    expect(onlyB.entries).toHaveLength(al.entries.length);
  });

  it("also returns the contract's flat shape (allowlistEntries)", async () => {
    const r = await allowlistEntries(db, ev.eventId, ev.cpAin, { from: T("09:00"), to: T("13:00") });
    expect(r.revocation_epoch).toBeGreaterThan(0);
    const crew = r.entries.find((e) => e.tier === null)!;
    expect(crew.permitted_room_ids).toEqual([]); // crew may enter B, but only A's door was asked for
    const cancelled = r.entries.filter((e) => e.revoked);
    expect(cancelled).toHaveLength(1);
    expect(Object.keys(r.entries[0]!).sort()).toEqual(["credential_hash", "dead_nfc_hashes", "nfc_hashes", "permitted_room_ids", "qr_email_hashes", "qr_email_spent", "revoked", "state", "tier"]);
    const whole = await allowlistEntries(db, ev.eventId, null);
    expect(whole.entries.find((e) => e.tier === null)!.permitted_room_ids).toEqual([ev.roomB]);
  });

  it("advances the revocation epoch on revoke, suspend, clear, band loss, tier change and republish — not on the scan path", async () => {
    const e0 = await revocationEpoch(db, ev.eventId);
    const step = async (label: string, f: () => Promise<unknown>, bumps: boolean) => {
      const before = await revocationEpoch(db, ev.eventId);
      await f();
      expect(await revocationEpoch(db, ev.eventId), label).toBe(before + (bumps ? 1 : 0));
    };
    const fresh = await attendeeWithCredential(db, ev.eventId, "ORDINARY");
    await step("zone_state update (scan path)", () => q(db, `update credentials set zone_state = $1 where id = $2`, [`INSIDE_${ev.zoneId}`, vip.credentialId]), false);
    await step("suspend", () => q(db, `update credentials set state = 'suspended_review' where id = $1`, [vip.credentialId]), true);
    await step("clear", () => q(db, `update credentials set state = 'active' where id = $1`, [vip.credentialId]), true);
    await step("revoke", () => q(db, `update credentials set state = 'revoked', revoked_at = now() where id = $1`, [fresh.credentialId]), true);
    await step("tier change", () => q(db, `update registrations set tier = 'VIP' where id = $1`, [ord.registrationId]), true);
    await step("band lost", () => q(db, `update carriers set state = 'lost' where identifier = $1`, [b64Hash("band-v")]), true);
    await step("republish", () => replaceAccessRules(db, ev.eventId, 1, []), true);
    await step("checked_in_at (scan path)", () => q(db, `update registrations set checked_in_at = now() where id = $1`, [vip.registrationId]), false);
    expect(await revocationEpoch(db, ev.eventId)).toBeGreaterThan(e0);
  });

  it("is built quickly for 10,000 credentials", async () => {
    const big = await miniVenue(db);
    await replaceAccessRules(db, big.eventId, 0, [{ subject_kind: "tier", subject: "ORDINARY", room_id: big.roomA, effect: "permit" }]);
    // Bulk-create 10,000 attendees, registrations and credentials directly in SQL.
    await q(db, `select set_config('app.vault_scope','system',false)`);
    await q(
      db,
      `with a as (insert into pii_vault.attendees (id) select gen_random_uuid() from generate_series(1, 10000) returning id),
            r as (insert into registrations (event_id, attendee_id, tier, state) select $1, id, 'ORDINARY', 'confirmed' from a returning id)
       insert into credentials (registration_id, token_hash, state)
       select id, substr(translate(encode(sha256(id::text::bytea), 'base64'), '+/', '-_'), 1, 22), 'active' from r`,
      [big.eventId],
    );
    await q(db, `select set_config('app.vault_scope','',false)`);
    const t0 = performance.now();
    const al = await buildAllowlist(db, big.eventId, { from: T("09:00"), to: T("18:00") });
    const ms = performance.now() - t0;
    console.log(`allowlist with ${al.entries.length} credentials built in ${ms.toFixed(0)} ms (PGlite/WASM)`);
    expect(al.entries).toHaveLength(10_000);
    expect(ms).toBeLessThan(10_000);
  });
});
