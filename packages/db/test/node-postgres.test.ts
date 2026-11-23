/**
 * Exercises the production code path — node-postgres over TCP via createDb() and runMigrations() —
 * against PGlite exposed on a local socket (@electric-sql/pglite-socket). PGlite is a single
 * session behind the socket, so the pool is limited to one connection here.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations, withVaultScope, type Db } from "../src/index";
import { auditVerify, roomOccupancy } from "../src/functions";
import * as s from "../src/schema/index";
import { seed } from "../src/seed/index";
import { JOURNAL_ENTRIES } from "./helpers";

let pglite: PGlite;
let server: PGLiteSocketServer;
let db: Db;
let url: string;

beforeAll(async () => {
  pglite = new PGlite({ extensions: { btree_gist } });
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1", maxConnections: 1 });
  await server.start();
  url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
}, 60_000);

afterAll(async () => {
  await db?.$client.end();
  await server?.stop();
  await pglite?.close();
});

describe("node-postgres path (createDb / runMigrations)", () => {
  it("runMigrations applies every migration, and is idempotent", async () => {
    await runMigrations(url, { jobs: false }); // pg-boss needs a second connection; jobs.test.ts covers it on PGlite
    // pglite-socket serves one connection at a time; give it a moment to release the closed one.
    await new Promise((r) => setTimeout(r, 500));
    await runMigrations(url, { jobs: false }); // pg-boss needs a second connection; jobs.test.ts covers it on PGlite
    const r = await pglite.query<{ n: number }>(`select count(*)::int n from drizzle.__drizzle_migrations`);
    expect(r.rows[0]!.n).toBe(JOURNAL_ENTRIES);
  });

  it("createDb returns a typed client that can seed and query", async () => {
    await new Promise((r) => setTimeout(r, 500));
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
