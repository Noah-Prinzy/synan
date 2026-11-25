import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import { MIGRATIONS_FOLDER } from "../src/migrate";
import { createMigratedPglite, createRealPgDatabase, type RealPgDatabase } from "../src/testing";
import * as schema from "../src/schema/index";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

/** Number of migrations in the journal. */
export const JOURNAL_ENTRIES: number = (
  JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }
).entries.length;

/**
 * The backend under test. Default: PGlite (in process, fast). `vitest --mode realpg` (root script
 * `test:db:realpg`): every createTestDb() is a fresh clone of a migrated template on the real server at
 * REAL_PG_ADMIN_URL, reached through node-postgres as the admin, over ONE connection — the same single
 * session PGlite gives, so `set role`, session settings and statement order mean the same thing.
 */
export const REAL_PG: boolean = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "realpg" || process.env.DB_TEST_BACKEND === "realpg";

/** Real-server test databases made by this file, dropped by test/realpg-setup.ts after the file. */
export const realPgDatabases: RealPgDatabase[] = [];

/**
 * The PGlite client methods the tests use, over one node-postgres connection. `close()` ends it and
 * drops the database.
 */
/**
 * A "pool" of exactly one connection that is never replaced. pg.Pool would destroy its connection
 * after any failed query (and with it a `set role`, which every expected-rejection test triggers);
 * PGlite keeps its one session. A transaction holds the connection and everything else waits for it,
 * as on PGlite. Drizzle needs a pg.Pool instance to give transactions their own client.
 */
class OneConnectionPool extends pg.Pool {
  private readonly conn: pg.Client;
  private connected: Promise<unknown> | null = null;
  private lock: Promise<void> = Promise.resolve();
  constructor(connectionString: string) {
    super({ connectionString, max: 1 });
    this.conn = new pg.Client({ connectionString });
    this.conn.on("error", () => undefined);
  }
  private async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.lock;
    this.lock = prev.then(() => next);
    await prev;
    this.connected ??= this.conn.connect();
    await this.connected;
    return release;
  }
  override async connect(): Promise<pg.PoolClient> {
    const release = await this.acquire();
    let done = false;
    return Object.assign(Object.create(this.conn) as pg.PoolClient, {
      query: (...a: unknown[]) => (this.conn.query as (...x: unknown[]) => unknown)(...a),
      release: () => {
        if (!done) (done = true), release();
      },
    });
  }
  // @ts-expect-error -- see connect()
  override async query(...a: unknown[]): Promise<unknown> {
    const release = await this.acquire();
    try {
      return await (this.conn.query as (...x: unknown[]) => Promise<unknown>)(...a);
    } finally {
      release();
    }
  }
  override async end(): Promise<void> {
    await this.lock;
    if (this.connected) await this.conn.end().catch(() => undefined);
  }
}

class SingleSessionClient {
  readonly pool: OneConnectionPool;
  constructor(readonly database: RealPgDatabase) {
    this.pool = new OneConnectionPool(database.adminUrl);
  }
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<pg.QueryResult<T & pg.QueryResultRow>> {
    return this.pool.query(text, params) as Promise<pg.QueryResult<T & pg.QueryResultRow>>;
  }
  /** Several statements, simple protocol (no parameters). */
  exec(text: string): Promise<unknown> {
    return this.pool.query(text);
  }
  /** PGlite's client.transaction: the callback gets query/exec bound to the open transaction. */
  async transaction<T>(fn: (tx: { query: (t: string, p?: unknown[]) => Promise<pg.QueryResult>; exec: (t: string) => Promise<unknown> }) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      try {
        const out = await fn({ query: (t, p) => c.query(t, p as unknown[]), exec: (t) => c.query(t) });
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      }
    } finally {
      c.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
    await this.database.drop();
    const i = realPgDatabases.indexOf(this.database);
    if (i >= 0) realPgDatabases.splice(i, 1);
  }
}

async function createRealPgTestDb(): Promise<TestDb> {
  const database = await createRealPgDatabase();
  realPgDatabases.push(database);
  const session = new SingleSessionClient(database);
  const db = drizzlePg(session.pool as unknown as pg.Pool, { schema }) as unknown as TestDb;
  // Tests reach the session through $client (query/exec/transaction/close), exactly as on PGlite.
  Object.defineProperty(db, "$client", { value: session, configurable: true });
  return db;
}

/**
 * Where pg-boss connects for a test database. PGlite: the same in-process client (the test switches
 * role with `set role` first). Real server: its own pool, logged in as the given role's test login.
 */
export function jobTarget(db: TestDb, as: "owner" | "app_api" | "app_jobs"): { pglite: PGlite } | { connectionString: string } {
  const c = db.$client as unknown;
  if (c instanceof SingleSessionClient) {
    const d = c.database;
    return { connectionString: as === "owner" ? d.adminUrl : as === "app_api" ? d.urls.api : d.urls.jobs };
  }
  return { pglite: db.$client };
}

/** A fresh database with every migration applied: PGlite, or a clone on the real server (REAL_PG). */
export async function createTestDb(): Promise<TestDb> {
  if (REAL_PG) return createRealPgTestDb();
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as TestDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }); // a no-op on the snapshot; keeps the journal honest
  return db;
}

/** Runs a raw statement and returns its rows. */
export async function q<T = Record<string, unknown>>(db: TestDb, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.$client.query<T>(text, params);
  return res.rows;
}

/** Expects a promise to reject with a Postgres error whose message matches. */
export async function rejects(p: Promise<unknown>, match: RegExp): Promise<void> {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`expected rejection matching ${match}, but it succeeded`);
  // Drizzle wraps the driver error ("Failed query: …") and keeps the Postgres error in `cause`.
  const parts: string[] = [];
  for (let e: any = err; e; e = e.cause) {
    parts.push(String(e.message ?? e));
    if (e.constraint) parts.push(`constraint=${e.constraint}`);
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) parts.push(`code=${e.code}`);
  }
  const msg = parts.join(" | ");
  if (!match.test(msg)) throw new Error(`expected rejection matching ${match}, got: ${msg}`);
}

export { sql };

/**
 * Drops the encryption constraints switched on by migrations 0008–0010, to simulate a database written
 * before enforcement (legacy plaintext) in the re-encryption tests.
 */
export async function dropEncryptionEnforcement(db: TestDb): Promise<void> {
  await db.$client.exec(`
    alter table pii_vault.attendees drop constraint if exists attendees_email_encrypted;
    alter table pii_vault.attendees drop constraint if exists attendees_full_name_encrypted;
    alter table pii_vault.attendees drop constraint if exists attendees_profile_encrypted;
    alter table pii_vault.attendees drop constraint if exists attendees_phone_encrypted;
    alter table public.users drop constraint if exists users_mfa_secret_encrypted;
    alter table public.signing_keys drop constraint if exists signing_keys_private_key_encrypted;
    alter table public.users drop constraint if exists users_email_encrypted;
    alter table public.users drop constraint if exists users_email_hash_required;
    alter table public.users alter column email_hash drop not null;
  `);
}
