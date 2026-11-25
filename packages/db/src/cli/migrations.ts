/**
 * Migration hygiene, for CI and for people (roadmap 5.1).
 *
 *   tsx src/cli/migrations.ts verify [--base <git ref>]
 *        static: journal in order, no gaps or duplicates, every file journalled; no recorded migration
 *        edited (checksum manifest); `drizzle-kit generate` finds no difference from src/schema. With
 *        --base, every migration that existed at that ref is unchanged now (SQL and journal entry), so
 *        an edit cannot hide behind an edited manifest.
 *   tsx src/cli/migrations.ts manifest [--accept-changed=<tag>,…]
 *        record new migrations in the manifest (deliberate). An edited one is refused unless named:
 *        --accept-changed=0012_phase4_core
 *   tsx src/cli/migrations.ts check [--from <git ref>]
 *        apply every migration to an empty database on a real server (REAL_PG_ADMIN_URL), apply again
 *        (a no-op), and compare the result with the journal; with --from, also apply that ref's
 *        migrations to another empty database and upgrade it with today's; then confirm that
 *        `drizzle-kit generate` writes nothing. Every database it made is dropped afterwards.
 *
 * The manifest (migrations/checksums.json) holds a SHA-256 of each migration's SQL, with line endings
 * normalised to LF (a Windows checkout with core.autocrlf must not count as an edit), and of its journal
 * entry. Never edit an applied migration: add a new one that corrects it. In GitHub Actions the results
 * also go to the job summary and failures become annotations.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_FOLDER } from "../migrate";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = resolve(PKG, "../..");
/** The migrations folder as git names it, from the repository root. */
const GIT_DIR = relative(REPO, MIGRATIONS_FOLDER).replace(/\\/g, "/");
const MANIFEST = join(MIGRATIONS_FOLDER, "checksums.json");

/** `--name value` or `--name=value`. */
const option = (name: string): string | undefined => {
  const args = process.argv.slice(3);
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3) || undefined;
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : undefined;
};
const git = (args: string[]) => spawnSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const report = (title: string, problems: string[], ok: string) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, problems.length ? `### ${title}: ${problems.length} problem(s)\n\n${problems.map((p) => `- ${p.split("\n")[0]}`).join("\n")}\n\n` : `### ${title}: pass\n\n${ok}\n\n`);
  if (process.env.GITHUB_ACTIONS) for (const p of problems) console.log(`::error title=${title}::${p.replace(/\r?\n/g, "%0A")}`);
};

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Manifest {
  note: string;
  algorithm: "sha256-lf";
  migrations: Record<string, { sql: string; journal: string }>;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const journal = (): { dialect: string; entries: JournalEntry[] } => JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
const sqlHash = (tag: string) => sha(readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), "utf8").replace(/\r\n/g, "\n"));
const entryHash = (e: JournalEntry) => sha(JSON.stringify({ idx: e.idx, tag: e.tag, when: e.when, breakpoints: e.breakpoints }));
const readManifest = (): Manifest | null => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null);

/** Journal order: idx 0..n-1 without gaps, tags NNNN_name matching idx, unique, `when` strictly increasing, files ↔ entries. */
function checkJournal(): string[] {
  const problems: string[] = [];
  const { entries, dialect } = journal();
  if (dialect !== "postgresql") problems.push(`journal dialect is ${dialect}`);
  const tags = new Set<string>();
  entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`entry ${i} has idx ${e.idx} (gap or duplicate)`);
    if (!/^\d{4}_[a-z0-9_]+$/.test(e.tag) || Number(e.tag.slice(0, 4)) !== i) problems.push(`entry ${i} has tag ${e.tag} (expected ${String(i).padStart(4, "0")}_…)`);
    if (tags.has(e.tag)) problems.push(`tag ${e.tag} appears twice`);
    tags.add(e.tag);
    // drizzle's migrator applies only entries newer than the last applied one: an older `when` is skipped silently.
    if (i > 0 && e.when <= entries[i - 1]!.when) problems.push(`entry ${e.tag} has when ${e.when}, not after ${entries[i - 1]!.tag} (${entries[i - 1]!.when}); it would be skipped on an existing database`);
    if (!e.breakpoints) problems.push(`entry ${e.tag} has breakpoints off`);
    if (!existsSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`))) problems.push(`entry ${e.tag} has no ${e.tag}.sql`);
    if (!existsSync(join(MIGRATIONS_FOLDER, "meta", `${e.tag.slice(0, 4)}_snapshot.json`))) problems.push(`entry ${e.tag} has no snapshot`);
  });
  for (const f of readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql"))) {
    if (!tags.has(f.replace(/\.sql$/, ""))) problems.push(`${f} is not in the journal (it would never be applied)`);
  }
  return problems;
}

/** Recorded migrations unchanged; unrecorded ones reported (record them with `manifest`). */
function checkManifest(): string[] {
  const m = readManifest();
  if (!m) return [`no ${MANIFEST}: run "migrations:manifest" to create it`];
  const problems: string[] = [];
  const { entries } = journal();
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  for (const [tag, h] of Object.entries(m.migrations)) {
    const e = byTag.get(tag);
    if (!e) {
      problems.push(`${tag} is recorded as applied but is gone from the journal`);
      continue;
    }
    if (!existsSync(join(MIGRATIONS_FOLDER, `${tag}.sql`))) problems.push(`${tag}.sql is recorded as applied but is missing`);
    else if (sqlHash(tag) !== h.sql) problems.push(`${tag}.sql has changed since it was recorded: never edit an applied migration, add a new one`);
    if (entryHash(e) !== h.journal) problems.push(`${tag}'s journal entry has changed since it was recorded`);
  }
  for (const e of entries) if (!m.migrations[e.tag]) problems.push(`${e.tag} is not in the checksum manifest: record it with "migrations:manifest"`);
  return problems;
}

/** `drizzle-kit generate` on a throwaway copy of the migrations: any new file means src/schema and the migrations differ. */
function checkGenerate(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "synan-generate-"));
  try {
    const out = join(dir, "out");
    cpSync(MIGRATIONS_FOLDER, out, { recursive: true });
    const config = join(dir, "drizzle.config.json");
    // Paths relative to the package: drizzle-kit 0.31 joins an absolute `out` onto the working directory on Windows.
    writeFileSync(config, JSON.stringify({
      dialect: "postgresql", schema: "./src/schema/index.ts", out: relative(PKG, out).replace(/\\/g, "/"),
      schemaFilter: ["public", "pii_vault"], strict: false, verbose: false,
    }));
    // drizzle-kit's own bin script under this Node, so no shell is involved (the repo path has spaces).
    const kit = join(PKG, "node_modules", "drizzle-kit");
    const bin = join(kit, (JSON.parse(readFileSync(join(kit, "package.json"), "utf8")) as { bin: Record<string, string> }).bin["drizzle-kit"]!);
    const r = spawnSync(process.execPath, [bin, "generate", `--config=${config}`, "--name=__diff_check"], {
      cwd: PKG, encoding: "utf8", input: "", timeout: 120_000,
    });
    if (process.env.MIGRATIONS_DEBUG) console.log(r.stdout, r.stderr);
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const added = readdirSync(out).filter((f) => f.endsWith(".sql") && !existsSync(join(MIGRATIONS_FOLDER, f)));
    // drizzle-kit can exit 0 after an error: pass only on its explicit "no changes".
    if (!added.length) {
      if (r.status === 0 && /No schema changes/i.test(output)) return [];
      return [`drizzle-kit generate did not confirm "no schema changes" (exit ${r.status}): ${output.trim().slice(-2000)}`];
    }
    return added.map((f) => `drizzle-kit generate produced ${f}: src/schema differs from the migrations:\n${readFileSync(join(out, f), "utf8").slice(0, 4000)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every migration at `ref` is still here, unchanged (SQL with LF endings, and its journal entry). */
function checkBase(ref: string): string[] {
  const ls = git(["ls-tree", "--name-only", `${ref}:${GIT_DIR}`]);
  if (ls.status !== 0) {
    console.log(`  (no ${GIT_DIR} at ${ref}: nothing to compare with)`);
    return [];
  }
  const shown = git(["show", `${ref}:${GIT_DIR}/meta/_journal.json`]);
  const before = new Map<string, JournalEntry>(shown.status === 0 ? (JSON.parse(shown.stdout) as { entries: JournalEntry[] }).entries.map((e) => [e.tag, e]) : []);
  const now = new Map(journal().entries.map((e) => [e.tag, e]));
  const problems: string[] = [];
  for (const f of ls.stdout.split("\n").filter((x) => x.endsWith(".sql"))) {
    const tag = f.replace(/\.sql$/, "");
    if (!existsSync(join(MIGRATIONS_FOLDER, f))) {
      problems.push(`${f} existed at ${ref} and has been deleted`);
      continue;
    }
    const old = git(["show", `${ref}:${GIT_DIR}/${f}`]);
    if (old.status !== 0 || sha(old.stdout.replace(/\r\n/g, "\n")) !== sqlHash(tag)) problems.push(`${f} has been edited since ${ref}: never edit an applied migration, add a new one`);
    const b = before.get(tag);
    const n = now.get(tag);
    if (b && (!n || entryHash(b) !== entryHash(n))) problems.push(`${tag}'s journal entry has changed since ${ref}`);
  }
  return problems;
}

/** The migrations folder as it was at a git ref, copied to a temp directory; null when the ref has none. */
function folderAt(ref: string): string | null {
  const ls = git(["ls-tree", "-r", "--name-only", ref, GIT_DIR]);
  if (ls.status !== 0 || !ls.stdout.trim()) return null;
  const dir = mkdtempSync(join(tmpdir(), "synan-migrations-"));
  for (const path of ls.stdout.split("\n").filter(Boolean)) {
    const out = join(dir, relative(GIT_DIR, path));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, execFileSync("git", ["show", `${ref}:${path}`], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }));
  }
  return dir;
}

function writeManifest(accept: Set<string>): void {
  const old = readManifest();
  const { entries } = journal();
  const migrations: Manifest["migrations"] = {};
  const changed: string[] = [];
  const added: string[] = [];
  for (const e of entries) {
    const now = { sql: sqlHash(e.tag), journal: entryHash(e) };
    const was = old?.migrations[e.tag];
    if (was && (was.sql !== now.sql || was.journal !== now.journal) && !accept.has(e.tag)) {
      changed.push(e.tag);
      migrations[e.tag] = was;
      continue;
    }
    if (!was) added.push(e.tag);
    migrations[e.tag] = now;
  }
  if (changed.length) {
    console.error(`refused: ${changed.join(", ")} changed after being recorded. Never edit an applied migration; if this change is deliberate and nothing has applied it, re-run with --accept-changed=${changed.join(",")}`);
    process.exit(1);
  }
  const m: Manifest = {
    note: "SHA-256 of each recorded migration (SQL with LF line endings, and its journal entry). Checked by `migrations:verify`; new migrations are added with `migrations:manifest`. Never edit a recorded migration.",
    algorithm: "sha256-lf",
    migrations,
  };
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
  console.log(added.length ? `recorded ${added.join(", ")}` : "manifest up to date");
}

/** Applies the migrations to throwaway databases on the real server; returns the problems found. */
async function check(fromRef: string | undefined): Promise<string[]> {
  const admin = process.env.REAL_PG_ADMIN_URL;
  if (!admin) throw new Error("REAL_PG_ADMIN_URL is not set (root: corepack pnpm db:migrate:check starts from the local server)");
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { runMigrations } = await import("../migrate");
  const { entries } = journal();
  const problems: string[] = [];
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  const fresh = async (label: string, fn: (url: string) => Promise<void>) => {
    const name = `synan_migcheck_${label}_${randomBytes(4).toString("hex")}`;
    const url = new URL(admin);
    url.pathname = `/${name}`;
    try {
      await c.query(`create database "${name}"`);
      await fn(url.toString());
    } finally {
      await c.query(`drop database if exists "${name}" with (force)`).catch(() => undefined);
    }
  };
  const applied = async (url: string) => {
    const d = new pg.Client({ connectionString: url });
    await d.connect();
    try {
      return (await d.query<{ n: number; last: string }>(`select count(*)::int n, max(created_at)::text last from drizzle.__drizzle_migrations`)).rows[0]!;
    } finally {
      await d.end();
    }
  };
  try {
    await fresh("empty", async (url) => {
      const t0 = Date.now();
      await runMigrations(url);
      const first = Date.now() - t0;
      await runMigrations(url); // again: nothing pending, nothing fails
      const a = await applied(url);
      if (a.n !== entries.length) problems.push(`empty database: applied ${a.n} migrations, the journal has ${entries.length}`);
      if (Number(a.last) !== entries.at(-1)!.when) problems.push(`empty database: last applied migration is ${a.last}, the journal's last is ${entries.at(-1)!.when}`);
      const d = new pg.Client({ connectionString: url });
      await d.connect();
      try {
        const v = (await d.query<{ v: string }>(`select current_setting('server_version') v`)).rows[0]!.v;
        const queues = (await d.query<{ n: number }>(`select count(*)::int n from pgboss.queue`)).rows[0]!.n;
        console.log(`ok   empty database: ${entries.length} migrations applied on PostgreSQL ${v} in ${first} ms, re-applied as a no-op; pg-boss installed with ${queues} queues`);
      } finally {
        await d.end();
      }
    });
    if (fromRef) {
      const old = folderAt(fromRef);
      if (!old) console.log(`note upgrade: no migrations at ${fromRef}; upgrade check skipped`);
      else
        try {
          await fresh("upgrade", async (url) => {
            const pool = new pg.Pool({ connectionString: url, max: 1 });
            try {
              await migrate(drizzle(pool), { migrationsFolder: old });
            } finally {
              await pool.end();
            }
            const before = (await applied(url)).n;
            await runMigrations(url);
            const after = await applied(url);
            if (after.n !== entries.length) problems.push(`upgrade from ${fromRef}: ${after.n} migrations recorded, the journal has ${entries.length}`);
            else console.log(`ok   upgrade from ${fromRef}: ${before} → ${after.n} migrations`);
          });
        } finally {
          rmSync(old, { recursive: true, force: true });
        }
    }
  } finally {
    await c.end();
  }
  const gen = checkGenerate();
  console.log(`${gen.length ? "FAIL" : "ok  "} schema vs migrations (drizzle-kit generate writes nothing)${gen.length ? `\n  - ${gen.join("\n  - ")}` : ""}`);
  return [...problems, ...gen];
}

const cmd = process.argv[2];
if (cmd === "verify") {
  const base = option("base");
  const sections: [string, () => string[]][] = [
    ["journal", checkJournal],
    ["checksums", checkManifest],
    ...(base ? [[`unchanged since ${base}`, () => checkBase(base)] as [string, () => string[]]] : []),
    ["schema vs migrations (drizzle-kit generate)", checkGenerate],
  ];
  const all: string[] = [];
  for (const [name, f] of sections) {
    const p = f();
    console.log(`${p.length ? "FAIL" : "ok  "} ${name}${p.length ? `\n  - ${p.join("\n  - ")}` : ""}`);
    all.push(...p);
  }
  report("Migrations verify", all, `${journal().entries.length} migrations: journal in order, none edited since recorded${base ? ` or since \`${base}\`` : ""}, schema matches.`);
  process.exit(all.length ? 1 : 0);
} else if (cmd === "manifest") {
  const arg = process.argv.find((a) => a.startsWith("--accept-changed="));
  writeManifest(new Set(arg ? arg.slice("--accept-changed=".length).split(",").filter(Boolean) : []));
} else if (cmd === "check") {
  const from = option("from");
  const problems = await check(from);
  report("Migration check", problems, `${journal().entries.length} migrations applied to an empty database on real PostgreSQL${from ? ` and as an upgrade from \`${from}\`` : ""}; \`drizzle-kit generate\` writes nothing.`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error("usage: tsx src/cli/migrations.ts verify [--base ref] | manifest [--accept-changed=tag,…] | check [--from ref]");
  process.exit(2);
}
