import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Absolute path of the SQL migrations shipped with this package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Applies all pending migrations (drizzle journal in migrations/meta). Safe to run repeatedly.
 * Requires a role that can CREATE EXTENSION btree_gist (or have it pre-installed), create schemas,
 * types, tables, functions, triggers and policies.
 */
export async function runMigrations(connectionString: string, opts: { jobs?: boolean } = {}): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  // The pg-boss schema (src/jobs.ts), installed and upgraded by the same migrating role.
  if (opts.jobs ?? true) {
    const { installJobSchema } = await import("./jobs");
    await installJobSchema({ connectionString });
  }
}
