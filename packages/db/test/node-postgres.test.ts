/**
 * Exercises the production code path — node-postgres over TCP via createDb() and runMigrations() —
 * against PGlite served on the wire protocol (./pg-wire). PGlite is a single session, so
 * connections are served one at a time and the pool is limited to one connection here.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations, withVaultScope, type Db } from "../src/index";
import { auditVerify, roomOccupancy } from "../src/functions";
import * as s from "../src/schema/index";
import { seed } from "../src/seed/index";
import { JOURNAL_ENTRIES } from "./helpers";
import { servePgWire, type PgWireServer } from "./pg-wire";

let pglite: PGlite;
let server: PgWireServer;
let db: Db;
let url: string;

beforeAll(async () => {
  pglite = new PGlite({ extensions: { btree_gist } });
  server = await servePgWire(pglite); // waits for PGlite to boot
  url = server.url;
});

afterAll(async () => {
  await db?.$client.end();
  await server?.close();
  await pglite?.close();
});

describe("node-postgres path (createDb / runMigrations)", () => {
  it("runMigrations applies every migration, and is idempotent", async () => {
    await runMigrations(url, { jobs: false }); // pg-boss needs a second connection; jobs.test.ts covers it on PGlite
    await runMigrations(url, { jobs: false });
    const r = await pglite.query<{ n: number }>(`select count(*)::int n from drizzle.__drizzle_migrations`);
    expect(r.rows[0]!.n).toBe(JOURNAL_ENTRIES);
  });

  it("createDb returns a typed client that can seed and query", async () => {
    db = createDb(url, { max: 1 });
    const summary = await seed(db);
    expect(summary.counts["pii_vault.attendees"]).toBe(1400);
    const [{ n }] = (await db.select({ n: count() }).from(s.rooms)) as [{ n: number }];
    expect(n).toBe(60);
    const live = await db.select().from(s.events).where(eq(s.events.state, "live"));
    expect(live).toHaveLength(1);
    expect(live[0]!.starts_at).toBeInstanceOf(Date);
    const occ = await roomOccupancy(db, live[0]!.id);
    expect(occ).toHaveLength(36);
    expect(await auditVerify(db)).toEqual([]);
  }, 300_000);

  it("withVaultScope works through the pool and does not leak to the next query", async () => {
    // postgres is a superuser here, which bypasses RLS; check the setting itself instead.
    const inside = await withVaultScope(db, "operator", async (tx) => {
      const r = await tx.execute<{ scope: string }>(sql`select pii_vault.current_scope() as scope`);
      return r.rows[0]!.scope;
    });
    expect(inside).toBe("operator");
    const after = await db.execute<{ scope: string }>(sql`select pii_vault.current_scope() as scope`);
    expect(after.rows[0]!.scope).toBe("none");
  });
});
