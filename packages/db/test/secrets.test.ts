import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withVaultScope } from "../src/client";
import { createCipher, ENVELOPE_RE, StaticKeyProvider, type Cipher } from "../src/crypto/index";
import { eraseAttendee } from "../src/functions";
import * as s from "../src/schema/index";
import {
  createAttendee,
  findAttendeeByEmail,
  insertSigningKey,
  readAttendee,
  readMfaSecret,
  readSigningPrivateKey,
  reencryptSecrets,
  reindexEmailBlindIndex,
  setMfaSecret,
  updateAttendeeIdentity,
  findUserByEmail,
  insertUser,
  readUserEmail,
} from "../src/secrets";
import { seed } from "../src/seed/index";
import { createTestDb, dropEncryptionEnforcement, q, rejects, type TestDb } from "./helpers";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const b1 = randomBytes(32);
const b2 = randomBytes(32);
const mk = (data: Record<string, Buffer>, bi: Record<string, Buffer>, activeData?: string, activeBi?: string) =>
  createCipher(new StaticKeyProvider({ data, blindIndex: bi, activeData, activeBlindIndex: activeBi }));

let db: TestDb;
let c1: Cipher;
beforeAll(async () => {
  db = await createTestDb();
  c1 = await mk({ k1 }, { b1 });
});

const raw = async (id: string) =>
  (await withVaultScope(db, "system", (tx) => tx.select().from(s.attendees).where(eq(s.attendees.id, id))))[0]!;

describe("attendee identity helpers", () => {
  it("encrypt on write, decrypt on read, and never store plaintext", async () => {
    const id = await createAttendee(db, c1, {
      email: "Ada.Lovelace@Example.test",
      full_name: "Ada Lovelace",
      profile: { company: "Analytical Engines", dietary: "halal" },
    });
    const row = await raw(id);
    expect(row.email).toMatch(ENVELOPE_RE);
    expect(row.full_name).toMatch(ENVELOPE_RE);
    expect(Object.keys(row.profile_jsonb as object)).toEqual(["$enc"]);
    const dump = JSON.stringify(row);
    for (const p of ["Ada", "Lovelace", "Analytical", "halal", "@Example"]) expect(dump).not.toContain(p);
    expect(row.email_hash).toBe(c1.blindIndex("ada.lovelace@example.test"));

    const back = await readAttendee(db, c1, id);
    expect(back).toMatchObject({ email: "Ada.Lovelace@Example.test", full_name: "Ada Lovelace", profile: { company: "Analytical Engines", dietary: "halal" } });
    expect((await findAttendeeByEmail(db, c1, "  ada.LOVELACE@example.test"))!.id).toBe(id);
    expect(await findAttendeeByEmail(db, c1, "nobody@example.test")).toBeNull();

    expect(await updateAttendeeIdentity(db, c1, id, { full_name: "Augusta Ada King" })).toBe(true);
    expect((await readAttendee(db, c1, id, "attendee"))!.full_name).toBe("Augusta Ada King");
  });

  it("keep a Public-tier attendee free of personal data", async () => {
    const id = await createAttendee(db, c1, {});
    const row = await raw(id);
    expect([row.email, row.email_hash, row.full_name, row.profile_jsonb]).toEqual([null, null, null, {}]);
  });

  it("reject a ciphertext copied into another row", async () => {
    const a = await createAttendee(db, c1, { email: "a@example.test", full_name: "A" });
    const b = await createAttendee(db, c1, { email: "b@example.test", full_name: "B" });
    await withVaultScope(db, "system", async (tx) => {
      const ra = (await tx.select().from(s.attendees).where(eq(s.attendees.id, a)))[0]!;
      await tx.update(s.attendees).set({ email: ra.email }).where(eq(s.attendees.id, b));
    });
    await rejects(readAttendee(db, c1, b), /failed authentication/);
  });

  it("scrub identity on erasure", async () => {
    const id = await createAttendee(db, c1, { email: "erase@example.test", full_name: "Erase Me", profile: { x: 1 } });
    expect(await eraseAttendee(db, id)).toBe(true);
    expect(await readAttendee(db, c1, id, "system")).toMatchObject({ email: null, full_name: null, profile: {} });
    expect(await findAttendeeByEmail(db, c1, "erase@example.test")).toBeNull();
  });
});

describe("MFA secrets and signing keys", () => {
  it("are encrypted at rest and bound to their row", async () => {
    const u = { id: await insertUser(db, c1, { email: "mfa@example.test", role: "admin" }) };
    await setMfaSecret(db, c1, u!.id, "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", new Date());
    const [stored] = await db.select().from(s.users).where(eq(s.users.id, u!.id));
    expect(stored!.mfa_secret_enc).toMatch(ENVELOPE_RE);
    expect(stored!.mfa_secret_enc).not.toContain("JBSWY3DP");
    expect(await readMfaSecret(db, c1, u!.id)).toBe("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");

    const jwk = JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "pub", d: "very-private-d-value" });
    const id = await insertSigningKey(db, c1, { purpose: "qr", qr_kid: "0a1b2c3d", public_key: '{"x":"pub"}', private_key: jwk });
    const [k] = await db.select().from(s.signing_keys).where(eq(s.signing_keys.id, id));
    expect(k!.private_key_enc).toMatch(ENVELOPE_RE);
    expect(k!.private_key_enc).not.toContain("very-private");
    expect(await readSigningPrivateKey(db, c1, id)).toBe(jwk);
    await rejects(insertSigningKey(db, c1, { purpose: "qr", qr_kid: "0a1b2c3d", public_key: "{}", private_key: "{}" }), /signing_keys_qr_kid_uq/);
  });
});

describe("key rotation", () => {
  it("re-encrypts mixed key versions and legacy plaintext, resumably", async () => {
    const fresh = await createTestDb();
    await dropEncryptionEnforcement(fresh); // simulate data written before enforcement
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await createAttendee(fresh, c1, { email: `p${i}@example.test`, full_name: `Person ${i}`, profile: { i } }));
    // Two legacy rows written in the clear (what the API writes today).
    const legacy = [randomUUID(), randomUUID()];
    await withVaultScope(fresh, "system", (tx) =>
      tx.insert(s.attendees).values(legacy.map((id, i) => ({ id, email: `legacy${i}@example.test`, full_name: `Legacy ${i}`, profile_jsonb: { company: "Old Co" } }))),
    );
    const [u] = await q<{ id: string }>(fresh, "insert into users (email, role, mfa_secret_enc) values ('op@example.test', 'admin', 'PLAINTOTPSECRET') returning id");
    await insertSigningKey(fresh, c1, { purpose: "allowlist", public_key: "{}", private_key: '{"d":"k1-era"}' });

    const c2 = await mk({ k1, k2 }, { b1 }, "k2");
    // Interrupt after the first committed batch.
    let batches = 0;
    await expect(
      reencryptSecrets({
        db: fresh,
        cipher: c2,
        batchSize: 3,
        onBatch: () => {
          if (++batches === 1) throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrow("simulated crash");
    const mid = await withVaultScope(fresh, "system", (tx) => tx.select({ e: s.attendees.email }).from(s.attendees));
    const onK2 = mid.filter((r) => r.e?.startsWith("ev1.k2.")).length;
    expect(onK2).toBe(3); // exactly the committed batch

    // Resume: a plain re-run finishes the job.
    const summary = await reencryptSecrets({ db: fresh, cipher: c2, batchSize: 3 });
    expect(summary["attendees.email"]!.updated).toBe(9 - 3);
    expect(summary["users.mfa_secret_enc"]!.updated).toBe(1);
    expect(summary["signing_keys.private_key_enc"]!.updated).toBe(1);
    // A third run finds nothing left.
    const again = await reencryptSecrets({ db: fresh, cipher: c2 });
    expect(Object.values(again).every((x) => x.updated === 0)).toBe(true);

    // Everything decrypts with only the new key; values are unchanged.
    const onlyK2 = await mk({ k2 }, { b1 });
    for (const [i, id] of ids.entries()) expect(await readAttendee(fresh, onlyK2, id, "system")).toMatchObject({ email: `p${i}@example.test`, full_name: `Person ${i}`, profile: { i } });
    expect(await readAttendee(fresh, onlyK2, legacy[1]!, "system")).toMatchObject({ email: "legacy1@example.test", profile: { company: "Old Co" } });
    expect(await readMfaSecret(fresh, onlyK2, u!.id)).toBe("PLAINTOTPSECRET");
    const all = await withVaultScope(fresh, "system", (tx) => tx.select().from(s.attendees));
    expect(all.every((r) => r.email === null || r.email.startsWith("ev1.k2."))).toBe(true);
    expect(JSON.stringify(all)).not.toContain("legacy0@");
  });

  it("rotates the blind index: lookups work throughout and after re-indexing", async () => {
    const fresh = await createTestDb();
    const id = await createAttendee(fresh, c1, { email: "rotate@example.test" });
    // New blind-index key active; the row still carries the old index.
    const cBoth = await mk({ k1 }, { b1, b2 }, "k1", "b2");
    expect((await findAttendeeByEmail(fresh, cBoth, "rotate@example.test"))!.id).toBe(id);
    const r = await reindexEmailBlindIndex({ vault: fresh, cipher: cBoth, batchSize: 1 });
    expect(r).toMatchObject({ updated: 1, scanned: 1 });
    const cNew = await mk({ k1 }, { b2 });
    expect((await findAttendeeByEmail(fresh, cNew, "rotate@example.test"))!.id).toBe(id);
    expect((await reindexEmailBlindIndex({ vault: fresh, cipher: cNew })).updated).toBe(0);
  });
});

describe("seeded database and prepared enforcement", () => {
  let seeded: TestDb;
  beforeAll(async () => {
    seeded = await createTestDb();
    await seed(seeded);
  }, 120_000);

  it("contains no plaintext identity, MFA secret or signing key", async () => {
    const rows = await q<{ bad: number }>(
      seeded,
      `select
         (select count(*) from pii_vault.attendees where (email is not null and email !~ '^ev1\\.') or (full_name is not null and full_name !~ '^ev1\\.')
            or (profile_jsonb <> '{}'::jsonb and not (profile_jsonb ? '$enc')))
       + (select count(*) from users where mfa_secret_enc is not null and mfa_secret_enc !~ '^ev1\\.')
       + (select count(*) from signing_keys where private_key_enc !~ '^ev1\\.') as bad`,
    );
    expect(Number(rows[0]!.bad)).toBe(0);
    const anyAt = await q<{ n: number }>(seeded, `select count(*)::int n from pii_vault.attendees where email like '%@%' or full_name ~ ' '`);
    expect(anyAt[0]!.n).toBe(0);
    const mfa = await q<{ n: number }>(seeded, `select count(*)::int n from users where mfa_secret_enc is not null`);
    expect(mfa[0]!.n).toBe(5);
  });

  it("enforcement functions validate the seeded data, then reject plaintext and bad formats", async () => {
    await q(seeded, `select enforce_encrypted_secrets()`);
    await q(seeded, `select enforce_hash_formats()`);
    await q(seeded, `select enforce_encrypted_secrets()`); // idempotent
    await rejects(
      withVaultScope(seeded, "system", (tx) => tx.insert(s.attendees).values({ email: "plain@example.test" })),
      /attendees_email_encrypted/,
    );
    await rejects(q(seeded, `update users set mfa_secret_enc = 'PLAIN' where role = 'admin'`), /users_mfa_secret_encrypted/);
    await rejects(q(seeded, `update credentials set token_hash = 'not-22' where id = (select id from credentials limit 1)`), /credentials_token_hash_format/);
    await rejects(q(seeded, `insert into carriers (kind, identifier, state) values ('nfc', '04A1B2C3D4E5F6', 'stock')`), /carriers_identifier_format/);
  });

  it("refuse to switch on while plaintext remains, changing nothing", async () => {
    const fresh = await createTestDb();
    await dropEncryptionEnforcement(fresh);
    await withVaultScope(fresh, "system", (tx) => tx.insert(s.attendees).values({ email: "legacy@example.test" }));
    await rejects(q(fresh, `select enforce_encrypted_secrets()`), /attendees_email_encrypted/);
    const cons = await q<{ n: number }>(fresh, `select count(*)::int n from pg_constraint where conname like 'attendees_%_encrypted'`);
    expect(cons[0]!.n).toBe(0);
    await reencryptSecrets({ db: fresh, cipher: c1 });
    await q(fresh, `select enforce_encrypted_secrets()`);
  });
});

describe("enforcement is on (migration 0008)", () => {
  it("has validated constraints in place on a fresh database", async () => {
    const r = await q<{ conname: string; convalidated: boolean }>(
      db,
      "select conname, convalidated from pg_constraint where conname ~ '_(encrypted|format)$' order by 1",
    );
    expect(r.map((x) => x.conname)).toEqual([
      "attendees_email_encrypted", "attendees_email_hash_format", "attendees_full_name_encrypted", "attendees_phone_encrypted", "attendees_profile_encrypted",
      "auth_links_email_hash_format", "auth_links_token_hash_format", "auth_sessions_token_hash_format", "carrier_desk_codes_hash_format",
      "carriers_identifier_format", "credentials_token_hash_format", "credentials_zone_state_format", "devices_token_hash_format",
      "email_outbox_content_encrypted", "email_outbox_to_encrypted", "invitations_email_hash_format",
      "invitations_token_hash_format", "pending_registrations_answers_encrypted", "report_schedules_recipients_encrypted", "signing_keys_private_key_encrypted", "signing_keys_qr_kid_format",
      "user_invites_token_hash_format", "users_email_encrypted", "users_mfa_pending_encrypted", "users_mfa_secret_encrypted", "webhook_endpoints_secret_encrypted", "ws_tickets_ticket_hash_format",
    ]);
    expect(r.every((x) => x.convalidated)).toBe(true);
  });

  it("refuses plaintext through the strict default cipher", async () => {
    expect(c1.allowLegacyPlaintext).toBe(false);
    expect(() => c1.decrypt("plain@example.test", { table: "t", column: "c", rowId: "r" })).toThrow(/not encrypted/);
  });
});

describe("operator email (users.email)", () => {
  it("is encrypted with a separate-domain blind index, and found case-insensitively", async () => {
    const id = await insertUser(db, c1, { email: "Grace.Hopper@Example.test", role: "admin" });
    const [row] = await db.select().from(s.users).where(eq(s.users.id, id));
    expect(row!.email).toMatch(ENVELOPE_RE);
    expect(row!.email_hash).toBe(c1.blindIndex("grace.hopper@example.test", "user"));
    expect(row!.email_hash).not.toBe(c1.blindIndex("grace.hopper@example.test")); // attendee domain differs
    expect((await findUserByEmail(db, c1, "grace.hopper@EXAMPLE.test"))!.id).toBe(id);
    expect(await readUserEmail(db, c1, id)).toBe("Grace.Hopper@Example.test");
    await rejects(insertUser(db, c1, { email: "GRACE.hopper@example.test", role: "crew" }), /users_email_hash_uq/);
  });

  it("migrates a database written before enforcement: re-encryption, then enforcement validates", async () => {
    const fresh = await createTestDb();
    await dropEncryptionEnforcement(fresh); // as a database migrated only up to 0008 would be
    await q(fresh, "insert into users (email, role) values ('Legacy.Op@example.test', 'organiser')");
    await rejects(q(fresh, "select enforce_encrypted_user_email()"), /users_email_encrypted/);
    expect((await reencryptSecrets({ db: fresh, cipher: c1, includeUserEmail: false }))["users.email"]).toBeUndefined();
    const summary = await reencryptSecrets({ db: fresh, cipher: c1 }); // users.email is included by default
    expect(summary["users.email"]!.updated).toBe(1);
    const [u] = await fresh.select().from(s.users);
    expect(u!.email).toMatch(ENVELOPE_RE);
    expect(u!.email_hash).toBe(c1.blindIndex("legacy.op@example.test", "user"));
    await q(fresh, "select enforce_encrypted_user_email()");
    await rejects(q(fresh, "insert into users (email, role) values ('plain@example.test', 'crew')"), /users_email_encrypted|users_email_hash_required/);
    expect((await findUserByEmail(fresh, c1, "LEGACY.OP@example.test"))!.email).toBe("Legacy.Op@example.test");
  });
});

describe("operator-email enforcement (migrations 0009–0010)", () => {
  it("requires an encrypted address and a blind index on every row; uniqueness rests on the blind index", async () => {
    const cols = await q<{ is_nullable: string }>(db, "select is_nullable from information_schema.columns where table_name = 'users' and column_name = 'email_hash'");
    expect(cols[0]!.is_nullable).toBe("NO");
    const idx = await q<{ indexname: string; indexdef: string }>(db, "select indexname, indexdef from pg_indexes where tablename = 'users' and indexname like 'users_email%' order by 1");
    expect(idx.map((i) => i.indexname)).toEqual(["users_email_hash_uq"]); // users_email_lower_uq is gone
    expect(idx[0]!.indexdef).not.toMatch(/WHERE/); // not partial
    const cons = await q<{ conname: string; convalidated: boolean }>(db, "select conname, convalidated from pg_constraint where conname in ('users_email_encrypted','users_email_hash_required') order by 1");
    expect(cons).toEqual([
      { conname: "users_email_encrypted", convalidated: true },
      { conname: "users_email_hash_required", convalidated: true },
    ]);
    const id = await insertUser(db, c1, { email: "Linus@Example.test", role: "crew" });
    await rejects(q(db, "update users set email = 'linus@example.test' where id = $1", [id]), /users_email_encrypted/);
    await rejects(q(db, "update users set email_hash = 'ABC' where id = $1", [id]), /users_email_hash_required/);
    await rejects(insertUser(db, c1, { email: "LINUS@example.test ", role: "crew" }), /users_email_hash_uq/);
  });
});
