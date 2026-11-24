/**
 * `corepack pnpm db:migrate:check` — the migrations are in order, apply to an empty database and
 * upgrade the previous one, and the schema code has no change that lacks a migration.
 *
 * PROVISIONAL (CI, step 5.1): a minimal version written so the CI workflow is complete on its own.
 * Another engineer is writing migration-hygiene scripts under the same name; at merge, keep one
 * implementation and make sure it still covers the checks listed here.
 *
 *   1. Journal: entries numbered 0..n-1 in order, each tag starting with its four-digit number,
 *      `when` strictly increasing, one SQL file and one snapshot per entry, no SQL file outside it.
 *   2. Empty database: every migration applies (with the pg-boss schema) and a second run applies
 *      nothing. On a real server when REAL_PG_ADMIN_URL is set (a throwaway database, dropped after);
 *      otherwise on PGlite.
 *   3. Upgrade: with --from <git ref>, that ref's migrations are applied first, then today's.
 *   4. `drizzle-kit generate` against a copy of the migrations folder writes nothing.
 *
 * Run from the db package so its dependencies resolve:
 *   corepack pnpm --filter @synan/db exec tsx ../../scripts/db/migrate-check.mts [--from <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MIGRATIONS_FOLDER, runMigrations } from "../../packages/db/src/migrate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DB_PKG = join(ROOT, "packages/db");
const args = process.argv.slice(2);
const fromRef = args.includes("--from") ? args[args.indexOf("--from") + 1] : undefined;
const ADMIN = process.env.REAL_PG_ADMIN_URL;
const problems: string[] = [];
/** Imports a dependency of the db package (this file sits outside it). */
const req = createRequire(join(DB_PKG, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dep = (id: string): Promise<any> => import(pathToFileURL(req.resolve(id)).href);
const notes: string[] = [];
const log = (s: string) => console.log(s);

type Journal = { entries: { idx: number; tag: string; when: number; breakpoints: boolean }[] };
const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as Journal;

/* 1. Journal order ------------------------------------------------------------------------ */
{
  let prevWhen = -Infinity;
  journal.entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`journal entry ${i} has idx ${e.idx}`);
    if (!e.tag.startsWith(`${String(i).padStart(4, "0")}_`)) problems.push(`journal entry ${i} is tagged ${e.tag}; expected the prefix ${String(i).padStart(4, "0")}_ (two migrations claimed the same number?)`);
    if (!(e.when > prevWhen)) problems.push(`journal entry ${e.tag}: \`when\` is not after the previous entry's`);
    prevWhen = e.when;
    if (!existsSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`))) problems.push(`${e.tag}.sql is in the journal but missing`);
    if (!existsSync(join(MIGRATIONS_FOLDER, "meta", `${String(i).padStart(4, "0")}_snapshot.json`))) problems.push(`snapshot ${String(i).padStart(4, "0")}_snapshot.json missing for ${e.tag}`);
  });
  const tags = new Set(journal.entries.map((e) => e.tag));
  for (const f of readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql"))) {
    if (!tags.has(f.replace(/\.sql$/, ""))) problems.push(`${f} is not in the journal (drizzle would never apply it)`);
  }
  log(`1. Journal: ${journal.entries.length} entries checked.`);
}

/* Helpers for applying a migrations folder ---------------------------------------------- */
async function countApplied(query: (sql: string) => Promise<{ rows: { n: number }[] }>) {
  return (await query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0]!.n;
}

/** A migrations folder as it was at a git ref, in a temp directory; null when the ref has none. */
function folderAt(ref: string): string | null {
  const rel = "packages/db/migrations";
  const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", ref, rel], { cwd: ROOT, encoding: "utf8" });
  if (ls.status !== 0 || !ls.stdout.trim()) return null;
  const dir = mkdtempSync(join(tmpdir(), "synan-migrations-"));
  for (const path of ls.stdout.split("\n").filter(Boolean)) {
    const out = join(dir, relative(rel, path));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
  }
  return dir;
}

async function onRealPostgres() {
  const pg = (await dep("pg")).default;
  const { drizzle } = await dep("drizzle-orm/node-postgres");
  const { migrate } = await dep("drizzle-orm/node-postgres/migrator");
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  const urlOf = (db: string) => {
    const u = new URL(ADMIN!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const withDb = async (label: string, fn: (url: string) => Promise<void>) => {
    const name = `migcheck_${label}_${randomBytes(3).toString("hex")}`;
    await admin.query(`create database ${name}`);
    try {
      await fn(urlOf(name));
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`);
    }
  };
  try {
    await withDb("empty", async (url) => {
      await runMigrations(url);
      await runMigrations(url); // idempotent
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      const n = await countApplied((s) => c.query(s));
      const queues = (await c.query(`select count(*)::int as n from pgboss.queue`)).rows[0].n;
      await c.end();
      if (n !== journal.entries.length) problems.push(`empty database: ${n} migrations recorded, journal has ${journal.entries.length}`);
      log(`2. Empty database (real PostgreSQL): ${n} migrations applied, idempotent; pg-boss installed with ${queues} queues.`);
    });
    if (fromRef) {
      const old = folderAt(fromRef);
      if (!old) notes.push(`--from ${fromRef}: no migrations at that ref; upgrade check skipped`);
      else
        await withDb("upgrade", async (url) => {
          const pool = new pg.Pool({ connectionString: url, max: 1 });
          await migrate(drizzle(pool), { migrationsFolder: old });
          const c = await pool.connect();
          const before = await countApplied((s) => c.query(s));
          c.release();
          await pool.end();
          await runMigrations(url);
          const c2 = new pg.Client({ connectionString: url });
          await c2.connect();
          const after = await countApplied((s) => c2.query(s));
          await c2.end();
          rmSync(old, { recursive: true, force: true });
          if (after !== journal.entries.length) problems.push(`upgrade from ${fromRef}: ${after} migrations recorded, journal has ${journal.entries.length}`);
          log(`3. Upgrade from ${fromRef} (real PostgreSQL): ${before} → ${after} migrations.`);
        });
    }
  } finally {
    await admin.end();
  }
}

async function onPglite() {
  const { PGlite } = await dep("@electric-sql/pglite");
  const { btree_gist } = await dep("@electric-sql/pglite/contrib/btree_gist");
  const { drizzle } = await dep("drizzle-orm/pglite");
  const { migrate } = await dep("drizzle-orm/pglite/migrator");
  const { installJobSchema } = await import("../../packages/db/src/jobs");
  const apply = async (folders: string[]) => {
    const client = new PGlite({ extensions: { btree_gist } });
    const counts: number[] = [];
    for (const f of folders) {
      await migrate(drizzle(client), { migrationsFolder: f });
      counts.push(await countApplied((s) => client.query(s)));
    }
    return { client, counts };
  };
  {
    const { client, counts } = await apply([MIGRATIONS_FOLDER, MIGRATIONS_FOLDER]);
    await installJobSchema({ pglite: client });
    await client.close();
    if (counts[0] !== journal.entries.length || counts[1] !== counts[0]) problems.push(`empty database (PGlite): recorded ${counts.join(" then ")}, journal has ${journal.entries.length}`);
    log(`2. Empty database (PGlite; set REAL_PG_ADMIN_URL for a real server): ${counts[0]} migrations applied, idempotent; pg-boss installed.`);
  }
  if (fromRef) {
    const old = folderAt(fromRef);
    if (!old) notes.push(`--from ${fromRef}: no migrations at that ref; upgrade check skipped`);
    else {
      const { client, counts } = await apply([old, MIGRATIONS_FOLDER]);
      await client.close();
      rmSync(old, { recursive: true, force: true });
      if (counts[1] !== journal.entries.length) problems.push(`upgrade from ${fromRef} (PGlite): ${counts[1]} recorded, journal has ${journal.entries.length}`);
      log(`3. Upgrade from ${fromRef} (PGlite): ${counts[0]} → ${counts[1]} migrations.`);
    }
  }
}

/* 4. drizzle-kit generate shows no difference ------------------------------------------- */
function generateShowsNoDiff() {
  const tmp = mkdtempSync(join(tmpdir(), "synan-drizzle-"));
  const out = join(tmp, "migrations");
  cpSync(MIGRATIONS_FOLDER, out, { recursive: true });
  const before = new Set(readdirSync(out, { recursive: true }).map(String));
  // drizzle-kit resolves `out` against the working directory, so it is given relative to the package.
  const config = join(tmp, "drizzle.config.ts");
  const rel = (p: string) => relative(DB_PKG, p).replace(/\\/g, "/");
  writeFileSync(
    config,
    `export default ${JSON.stringify({ dialect: "postgresql", schema: rel(join(DB_PKG, "src/schema/index.ts")), out: rel(out), schemaFilter: ["public", "pii_vault"], strict: true })};\n`,
  );
  // drizzle-kit's own entry file, run by this Node (no shell). It never prompts here: a prompt
  // (an ambiguous rename) would mean a schema change without a migration, and the timeout ends it.
  const bin = join(DB_PKG, "node_modules", "drizzle-kit", "bin.cjs");
  const r = spawnSync(process.execPath, [bin, "generate", "--config", config], { cwd: DB_PKG, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
  const after = readdirSync(out, { recursive: true }).map(String).filter((f) => !before.has(f));
  rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) problems.push(`drizzle-kit generate failed: ${(r.stderr || r.stdout).slice(-2000)}`);
  else if (after.length) problems.push(`drizzle-kit generate found schema changes without a migration (it would write: ${after.join(", ")}). Run \`corepack pnpm --filter @synan/db db:generate\`.`);
  if (r.status === 0) log(`4. drizzle-kit generate: ${after.length ? `would write ${after.join(", ")}` : "no schema changes"}.`);
}

if (ADMIN) await onRealPostgres();
else await onPglite();
generateShowsNoDiff();

for (const n of notes) log(`note: ${n}`);
const report = problems.length
  ? `### Migration check: ${problems.length} problem(s)\n\n${problems.map((p) => `- ${p}`).join("\n")}`
  : `### Migration check: pass\n\n${journal.entries.length} migrations in order; applied to an empty database on ${ADMIN ? "real PostgreSQL" : "PGlite"}${fromRef ? ` and as an upgrade from \`${fromRef}\`` : ""}; \`drizzle-kit generate\` shows no difference.${notes.length ? `\n\n${notes.map((n) => `- ${n}`).join("\n")}` : ""}`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n\n`);
for (const p of problems) console.log(process.env.GITHUB_ACTIONS ? `::error title=migrations::${p}` : `ERROR: ${p}`);
process.exit(problems.length ? 1 : 0);
