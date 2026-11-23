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
