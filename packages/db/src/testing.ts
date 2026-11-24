/**
 * Test and development support: an in-process PostgreSQL (PGlite) with every migration applied,
 * started from a cached snapshot instead of re-running the migrations (≈0.3–0.5 s instead of ≈3 s).
 *
 * The snapshot is a dump of a freshly migrated data directory, cached on disk and keyed by a hash of
 * the migration files, so every test worker after the first one only loads it. Never used in
 * production; import from "@synan/db/testing".
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_FOLDER } from "./migrate";

function migrationsHash(): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else h.update(name.name).update(readFileSync(p));
    }
  };
  walk(MIGRATIONS_FOLDER);
  return h.digest("hex").slice(0, 16);
}

export interface MigratedPgliteOptions {
  /** Also install the pg-boss job schema (installJobSchema). Default false. */
  jobs?: boolean;
  /** Where the snapshot is cached; false to always migrate from scratch. Default: the OS temp directory. */
  cacheDir?: string | false;
}

/* ------------------------------------------------------------------ real PostgreSQL */

/**
 * A throwaway database on a real PostgreSQL server, for the `realpg` test mode. The admin login
 * (REAL_PG_ADMIN_URL, a superuser or CREATEDB + CREATEROLE) migrates a template database once per
 * migration set (`synan_tpl_<hash>`, built under an advisory lock so parallel workers build it once),
 * then every call clones it (`CREATE DATABASE … TEMPLATE`, ≈0.1–0.3 s). Four LOGIN roles shared by all
 * test databases log in exactly as production does: `synan_test_api` (app_api), `synan_test_vault`
 * (app_vault), `synan_test_scan` (app_scan) and `synan_test_jobs` (app_jobs + app_api). Their password
 * is derived from the admin URL, so it is never stored and every worker agrees on it.
 */
export interface RealPgDatabase {
  name: string;
  /** The admin (migrating role) connected to this database. */
  adminUrl: string;
  /** One login per role, connected to this database. */
  urls: { api: string; vault: string; scan: string; jobs: string };
  /** Runs SQL (several statements allowed) as the admin, on this database; the last statement's rows. */
  execAsAdmin<T = Record<string, unknown>>(text: string): Promise<T[]>;
  /** Drops the database (terminating its sessions). */
  drop(): Promise<void>;
}

export const REAL_PG_TEST_LOGINS = { api: "synan_test_api", vault: "synan_test_vault", scan: "synan_test_scan", jobs: "synan_test_jobs" } as const;

const withDb = (url: string, name: string, user?: { name: string; password: string }) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
};

let templateReady: Promise<string> | null = null;

/** Builds (once) the migrated template database and the shared test logins; returns the template's name. */
export function realPgTemplate(adminUrl: string): Promise<string> {
  templateReady ??= (async () => {
    const pg = (await import("pg")).default;
    const { runMigrations } = await import("./migrate");
    const tpl = `synan_tpl_${migrationsHash()}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`select pg_advisory_lock(hashtext('synan-test-template'))`);
      const have = await admin.query(`select 1 from pg_database where datname = $1`, [tpl]);
      if (!have.rowCount) {
        // Templates of older migration sets are of no further use.
        const old = await admin.query<{ datname: string }>(`select datname from pg_database where datname like 'synan\\_tpl\\_%'`);
        for (const r of old.rows) await admin.query(`drop database if exists "${r.datname}" with (force)`);
        const building = `${tpl}_building`;
        await admin.query(`drop database if exists "${building}" with (force)`);
        await admin.query(`create database "${building}"`);
        await runMigrations(withDb(adminUrl, building)); // the schema plus the pg-boss job schema
        await admin.query(`alter database "${building}" rename to "${tpl}"`);
      }
      const password = realPgTestPassword(adminUrl);
      const member = { api: "app_api", vault: "app_vault", scan: "app_scan", jobs: "app_jobs, app_api" } as const;
      for (const [k, login] of Object.entries(REAL_PG_TEST_LOGINS) as [keyof typeof member, string][]) {
        const exists = (await admin.query(`select 1 from pg_roles where rolname = $1`, [login])).rowCount;
        if (exists) await admin.query(`alter role ${login} login password '${password}'`);
        else await admin.query(`create role ${login} login password '${password}' in role ${member[k]}`);
      }
      return tpl;
    } finally {
      await admin.query(`select pg_advisory_unlock(hashtext('synan-test-template'))`).catch(() => undefined);
      await admin.end();
    }
  })();
  templateReady.catch(() => (templateReady = null));
  return templateReady;
}

/** The test logins' password: derived from the admin URL (never stored, the same in every worker). */
export function realPgTestPassword(adminUrl: string): string {
  return createHash("sha256").update(`synan-test-logins:${adminUrl}`).digest("base64url").slice(0, 32);
}

/** A fresh migrated database on the real server. Call `drop()` when done. */
export async function createRealPgDatabase(adminUrl: string = requireRealPgAdminUrl()): Promise<RealPgDatabase> {
  const pg = (await import("pg")).default;
  const tpl = await realPgTemplate(adminUrl);
  const name = `synan_t_${process.pid}_${randomBytes(5).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // A clone needs the template free of sessions; a concurrent clone by another worker can still be
    // finishing, so retry briefly on "being accessed by other users".
    for (let i = 0; ; i++) {
      try {
        await admin.query(`create database "${name}" template "${tpl}"`);
        break;
      } catch (e) {
        // 55006 object_in_use: "source database … is being accessed by other users".
        if (i >= 50 || (e as { code?: string }).code !== "55006") throw e;
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      }
    }
  } finally {
    await admin.end();
  }
  const password = realPgTestPassword(adminUrl);
  const as = (login: string) => withDb(adminUrl, name, { name: login, password });
  return {
    name,
    adminUrl: withDb(adminUrl, name),
    urls: { api: as(REAL_PG_TEST_LOGINS.api), vault: as(REAL_PG_TEST_LOGINS.vault), scan: as(REAL_PG_TEST_LOGINS.scan), jobs: as(REAL_PG_TEST_LOGINS.jobs) },
    execAsAdmin: async <T,>(text: string) => {
      const c = new pg.Client({ connectionString: withDb(adminUrl, name) });
      await c.connect();
      try {
        const r = (await c.query(text)) as unknown as { rows: T[] } | { rows: T[] }[];
        return Array.isArray(r) ? (r.at(-1)?.rows ?? []) : r.rows;
      } finally {
        await c.end();
      }
    },
    drop: async () => {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

export function requireRealPgAdminUrl(): string {
  const url = process.env.REAL_PG_ADMIN_URL;
  if (!url) {
    throw new Error("REAL_PG_ADMIN_URL is not set: start the local server (corepack pnpm pg:start) and run through the root test:*:realpg scripts");
  }
  return url;
}

/** A PGlite with every migration applied (as a superuser, like a migrating role with all rights). */
export async function createMigratedPglite(opts: MigratedPgliteOptions = {}): Promise<PGlite> {
  const [{ PGlite }, { btree_gist }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/btree_gist"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const file =
    opts.cacheDir === false ? null : join(opts.cacheDir ?? tmpdir(), `db-pglite-${migrationsHash()}${opts.jobs ? "-jobs" : ""}.tar`);
  if (file && existsSync(file)) {
    try {
      return new PGlite({ extensions: { btree_gist }, loadDataDir: new Blob([readFileSync(file)]) });
    } catch {
      // Unreadable or partial snapshot: fall through and rebuild it.
    }
  }
  const client = new PGlite({ extensions: { btree_gist } });
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  if (opts.jobs) {
    const { installJobSchema } = await import("./jobs");
    await installJobSchema({ pglite: client });
  }
  if (file) {
    const blob = await client.dumpDataDir("none");
    const tmp = `${file}.${randomBytes(4).toString("hex")}.part`;
    writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
    renameSync(tmp, file); // atomic: concurrent workers never read a half-written snapshot
  }
  return client;
}
