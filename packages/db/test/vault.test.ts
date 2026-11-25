/**
 * Row-level security on the identity vault. PGlite connects as a superuser, which bypasses RLS, so
 * these tests switch to an ordinary role (`app_user`, like the API's login role) with SET ROLE.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withVaultScope } from "../src/client";
import { eraseAttendee, purgeEventMovementData } from "../src/functions";
import * as s from "../src/schema/index";
import { encryptAttendeeColumns } from "../src/secrets";
import { attendeeWithCredential, devCipher, miniVenue, scan, type MiniVenue } from "./fixtures";
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let alice: Awaited<ReturnType<typeof attendeeWithCredential>>;
let bob: Awaited<ReturnType<typeof attendeeWithCredential>>;

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  alice = await attendeeWithCredential(db, v.eventId);
  bob = await attendeeWithCredential(db, v.eventId);
  // Roles belong to the whole server, not one database: on a real server another test database may
  // have created app_user already.
  await db.$client.exec(`
    do $$ begin if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user nologin; end if; end $$;
    grant usage on schema public, pii_vault to app_user;
    grant select, insert, update, delete on all tables in schema public, pii_vault to app_user;
    grant usage on all sequences in schema public to app_user;
    -- A login holding every role (the single-login case): RLS scopes are the only inner layer.
    grant app_api, app_vault to app_user;
    set role app_user;
  `);
});

afterAll(async () => {
  await q(db, `reset role`);
});

const attendeesVisible = () => db.select().from(s.attendees);

describe("identity vault RLS (as a non-superuser role)", () => {
  it("runs as a role that is subject to RLS", async () => {
    const r = await q<{ u: string; bypass: boolean }>(db, `select current_user u, rolbypassrls bypass from pg_roles where rolname = current_user`);
    expect(r[0]).toEqual({ u: "app_user", bypass: false });
  });

  it("hides everything and rejects writes without a scope", async () => {
    expect(await attendeesVisible()).toHaveLength(0);
    expect(await db.select().from(s.ephemeral_ids)).toHaveLength(0);
    await rejects(db.insert(s.attendees).values({ profile_jsonb: {} }), /row-level security/);
    await rejects(
      db.insert(s.ephemeral_ids).values({ event_id: v.eventId, credential_id: alice.credentialId }),
      /row-level security/,
    );
  });

  it("operator scope: all attendees, no ephemeral mapping", async () => {
    await withVaultScope(db, "operator", async (tx) => {
      expect(await tx.select().from(s.attendees)).toHaveLength(2);
      expect(await tx.select().from(s.ephemeral_ids)).toHaveLength(0);
      const del = await tx.delete(s.attendees).where(eq(s.attendees.id, alice.attendeeId)).returning();
      expect(del).toHaveLength(0); // only `system` may delete
    });
  });

  it("attendee scope: own row only, can update self but not others", async () => {
    await withVaultScope(
      db,
      "attendee",
      async (tx) => {
        const rows = await tx.select().from(s.attendees);
        expect(rows.map((r) => r.id)).toEqual([alice.attendeeId]);
        const mine = await tx.update(s.attendees).set(encryptAttendeeColumns(devCipher, alice.attendeeId, { full_name: "Alice A." })).where(eq(s.attendees.id, alice.attendeeId)).returning();
        expect(mine).toHaveLength(1);
        const theirs = await tx.update(s.attendees).set({ full_name: null }).where(eq(s.attendees.id, bob.attendeeId)).returning();
        expect(theirs).toHaveLength(0);
        expect(await tx.select().from(s.ephemeral_ids)).toHaveLength(0);
      },
      { attendeeId: alice.attendeeId },
    );
  });

  it("scan scope: ephemeral mapping read/insert, no attendee rows, no deletes", async () => {
    const v2 = await (async () => {
      await q(db, `reset role`);
      const x = await miniVenue(db);
      await q(db, `set role app_user`);
      return x;
    })();
    await withVaultScope(db, "scan", async (tx) => {
      expect(await tx.select().from(s.attendees)).toHaveLength(0);
      expect((await tx.select().from(s.ephemeral_ids)).length).toBe(2);
      const [row] = await tx.insert(s.ephemeral_ids).values({ event_id: v2.eventId, credential_id: alice.credentialId }).returning();
      expect(row!.ephemeral_id).toMatch(/^[0-9a-f-]{36}$/);
      const del = await tx.delete(s.ephemeral_ids).where(eq(s.ephemeral_ids.event_id, v2.eventId)).returning();
      expect(del).toHaveLength(0);
    });
  });

  it("does not leak the scope past the transaction", async () => {
    await withVaultScope(db, "system", async (tx) => {
      expect((await tx.select().from(s.attendees)).length).toBe(2);
    });
    expect(await attendeesVisible()).toHaveLength(0);
  });

  it("system scope: full access", async () => {
    await withVaultScope(db, "system", async (tx) => {
      expect((await tx.select().from(s.attendees)).length).toBe(2);
      expect((await tx.select().from(s.ephemeral_ids)).length).toBe(3);
    });
  });

  it("erasure scrubs identity but keeps the row and the registration", async () => {
    await withVaultScope(db, "operator", async (tx) => {
      await tx.update(s.attendees).set(encryptAttendeeColumns(devCipher, bob.attendeeId, { email: "bob@example.test" })).where(eq(s.attendees.id, bob.attendeeId));
    });
    expect(await eraseAttendee(db, bob.attendeeId)).toBe(true);
    const [row] = await withVaultScope(db, "system", (tx) => tx.select().from(s.attendees).where(eq(s.attendees.id, bob.attendeeId)));
    expect([row!.email, row!.email_hash, row!.full_name, row!.erased_at instanceof Date]).toEqual([null, null, null, true]);
    expect(await db.select().from(s.registrations).where(eq(s.registrations.attendee_id, bob.attendeeId))).toHaveLength(1);
    expect(await attendeesVisible()).toHaveLength(0); // the function restored the (empty) scope
  });

  it("lets the application role run the purge (SECURITY DEFINER) without vault privileges of its own", async () => {
    await scan(db, v, v.cpAin, alice.ephemeralId, "admitted", "2026-12-01T10:00:00Z");
    await q(db, `reset role`);
    await q(db, `update events set state = 'closed' where id = $1`, [v.eventId]);
    await q(db, `set role app_user`);
    expect(await purgeEventMovementData(db, v.eventId, { force: true })).toEqual({ scans_dropped: 1, ephemeral_ids_deleted: 2 });
  });
});
