/**
 * Role separation (migration 0005), exercised as the actual non-superuser roles via SET ROLE.
 * PGlite connects as a superuser; SET ROLE drops to the named role for privilege and RLS checks.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { describeConnection, setVaultScope, withVaultScope } from "../src/client";
import { createCipher, devKeyProvider, type Cipher } from "../src/crypto/index";
import { auditVerify, eraseAttendee, purgeEventMovementData } from "../src/functions";
import * as s from "../src/schema/index";
import { createAttendee, findAttendeeByEmail, readAttendee } from "../src/secrets";
import { attendeeWithCredential, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let cipher: Cipher;
let person: Awaited<ReturnType<typeof attendeeWithCredential>>;
let identityId: string;

const as = (role: "app_api" | "app_scan" | "app_vault") => q(db, `set role ${role}`);

beforeAll(async () => {
  db = await createTestDb();
  cipher = await createCipher(devKeyProvider());
  v = await miniVenue(db);
  person = await attendeeWithCredential(db, v.eventId);
  identityId = await createAttendee(db, cipher, { email: "vip@example.test", full_name: "Very Important" });
});
afterEach(async () => {
  await q(db, "reset role");
});

describe("roles", () => {
  it("exist as NOLOGIN group roles; app_scan inherits app_api", async () => {
    const r = await q<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
      db,
      `select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname in ('app_api','app_scan','app_vault') order by 1`,
    );
    expect(r).toEqual([
      { rolname: "app_api", rolcanlogin: false, rolsuper: false, rolbypassrls: false },
      { rolname: "app_scan", rolcanlogin: false, rolsuper: false, rolbypassrls: false },
      { rolname: "app_vault", rolcanlogin: false, rolsuper: false, rolbypassrls: false },
    ]);
    await as("app_scan");
    expect((await describeConnection(db)).memberOf).toEqual({ app_api: true, app_scan: true, app_vault: false });
  });
});

describe("app_api (general application role)", () => {
  it("cannot read identity, even after setting the vault scope itself", async () => {
    await as("app_api");
    await rejects(withVaultScope(db, "system", (tx) => tx.select().from(s.attendees)), /permission denied for table attendees/);
    await rejects(withVaultScope(db, "system", (tx) => tx.select({ id: s.attendees.id }).from(s.attendees)), /permission denied/);
    await q(db, `select set_config('app.vault_scope','system',false)`); // session-wide, as an attacker would
    await rejects(q(db, `select email from pii_vault.attendees`), /permission denied/);
    await q(db, `select set_config('app.vault_scope','',false)`);
    await rejects(withVaultScope(db, "system", (tx) => tx.select().from(s.ephemeral_ids)), /permission denied for table ephemeral_ids/);
    await rejects(findAttendeeByEmail(db, cipher, "vip@example.test"), /permission denied/);
    await rejects(
      withVaultScope(db, "system", (tx) => tx.update(s.attendees).set({ full_name: null }).where(eq(s.attendees.id, identityId))),
      /permission denied/,
    );
    await rejects(eraseAttendee(db, identityId), /permission denied for function erase_attendee/);
  });

  it("can create an attendee write-only (no RETURNING)", async () => {
    await as("app_api");
    const id = await createAttendee(db, cipher, { email: "new@example.test", full_name: "New Person" });
    await rejects(
      withVaultScope(db, "system", (tx) => tx.insert(s.attendees).values({ full_name: "x" }).returning()),
      /permission denied/,
    );
    await q(db, "reset role");
    expect((await readAttendee(db, cipher, id, "system"))!.email).toBe("new@example.test");
  });

  it("runs the operational schema: events (with partitions), scans append-only, audit, purge", async () => {
    await as("app_api");
    const e = await miniVenue(db);
    await scan(db, e, e.cpAin, null, "unknown_token", "2026-12-01T10:00:00Z");
    await rejects(q(db, `update scans set result = 'admitted'`), /permission denied for table scans/);
    await db.insert(s.audit_log).values({ action: "x", target: "t:1" });
    await rejects(q(db, `update audit_chain_head set last_hash = 'x'`), /permission denied/);
    await rejects(q(db, `delete from audit_log`), /permission denied/);
    expect(await auditVerify(db)).toEqual([]);
    await q(db, `update events set state = 'closed' where id = $1`, [e.eventId]);
    expect(await purgeEventMovementData(db, e.eventId, { force: true })).toEqual({ scans_dropped: 1, ephemeral_ids_deleted: 0 });
    // Deleting an event drops its (empty) partition through the SECURITY DEFINER trigger.
    const draft = await miniVenue(db, { eventState: "draft" });
    await q(db, `delete from sessions where event_id = $1`, [draft.eventId]);
    await q(db, `delete from event_rooms where event_id = $1`, [draft.eventId]);
    await q(db, `delete from events where id = $1`, [draft.eventId]);
  });

  it("is not tricked by a temporary table shadowing a definer function's objects", async () => {
    await as("app_api");
    await q(db, `create temp table audit_chain_head (id boolean, last_id bigint, last_hash text)`);
    await db.insert(s.audit_log).values({ action: "after-shadow", target: "t:2" });
    expect(await auditVerify(db)).toEqual([]);
    await q(db, `drop table pg_temp.audit_chain_head`);
  });
});

describe("app_scan (scan ingest)", () => {
  it("reads and writes the ephemeral mapping only, plus everything app_api has", async () => {
    await as("app_scan");
    const e = await miniVenue(db);
    const rows = await withVaultScope(db, "scan", async (tx) => {
      await tx.insert(s.ephemeral_ids).values({ event_id: e.eventId, credential_id: person.credentialId });
      return tx.select().from(s.ephemeral_ids).where(eq(s.ephemeral_ids.event_id, e.eventId));
    });
    expect(rows).toHaveLength(1);
    await scan(db, e, e.cpAin, rows[0]!.ephemeral_id, "admitted", "2026-12-01T10:00:00Z");
    // Without a scope the mapping is invisible; identity is never readable.
    expect(await db.select().from(s.ephemeral_ids)).toHaveLength(0);
    await rejects(withVaultScope(db, "system", (tx) => tx.select().from(s.attendees)), /permission denied/);
    await rejects(withVaultScope(db, "system", (tx) => tx.delete(s.ephemeral_ids)), /permission denied/);
  });
});

describe("app_vault (identity)", () => {
  it("reads and updates identity inside a scope, and nothing operational", async () => {
    await as("app_vault");
    expect(await db.select().from(s.attendees)).toHaveLength(0); // no scope: RLS hides all
    const got = await readAttendee(db, cipher, identityId, "operator");
    expect(got).toMatchObject({ email: "vip@example.test", full_name: "Very Important" });
    expect((await findAttendeeByEmail(db, cipher, "VIP@example.test"))!.id).toBe(identityId);
    await rejects(q(db, `select * from events limit 1`), /permission denied for table events/);
    await rejects(q(db, `select * from scans limit 1`), /permission denied/);
    await rejects(withVaultScope(db, "system", (tx) => tx.delete(s.attendees)), /permission denied/);
  });

  it("runs erasure", async () => {
    await as("app_vault");
    expect(await eraseAttendee(db, identityId)).toBe(true);
    const after = await withVaultScope(db, "system", async (tx) => {
      await setVaultScope(tx, "system");
      return tx.select({ e: s.attendees.email }).from(s.attendees).where(eq(s.attendees.id, identityId));
    });
    expect(after[0]!.e).toBeNull();
  });
});

describe("SECURITY DEFINER functions", () => {
  it("all pin search_path with pg_catalog first and pg_temp last, and none is executable by PUBLIC unless harmless", async () => {
    const r = await q<{ name: string; cfg: string[] | null; public_exec: boolean }>(
      db,
      `select n.nspname || '.' || p.proname as name, p.proconfig as cfg,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('public','pii_vault') order by 1`,
    );
    expect(r.map((x) => x.name)).toEqual([
      "pii_vault.erase_attendee",
      "public.audit_log_chain",
      "public.audit_prune",
      "public.create_scan_partition",
      "public.events_scan_partition",
      "public.purge_event_movement_data",
      "public.rebuild_event_rollups",
    ]);
    for (const x of r) {
      const sp = (x.cfg ?? []).find((c) => c.startsWith("search_path="));
      expect(sp, x.name).toMatch(/^search_path=pg_catalog, public(, pii_vault)?, pg_temp$/);
    }
    // Only the trigger functions stay executable by PUBLIC (they can only run as triggers).
    expect(r.filter((x) => x.public_exec).map((x) => x.name)).toEqual(["public.audit_log_chain", "public.events_scan_partition"]);
    void sql;
  });
});
