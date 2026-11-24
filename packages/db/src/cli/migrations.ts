/**
 * Migration hygiene, for CI and for people (roadmap 5.1).
 *
 *   tsx src/cli/migrations.ts verify     static: journal in order, no gaps or duplicates, every file
 *                                        journalled; no recorded migration edited (checksum manifest);
 *                                        `drizzle-kit generate` finds no difference from src/schema
 *   tsx src/cli/migrations.ts manifest   record new migrations in the manifest (deliberate). An edited
 *                                        one is refused unless named: --accept-changed=0012_phase4_core
 *   tsx src/cli/migrations.ts check      apply every migration to an empty database on a real server
 *                                        (REAL_PG_ADMIN_URL), apply again (a no-op), and compare the
 *                                        result with the journal; the database is dropped afterwards
 *
 * The manifest (migrations/checksums.json) holds a SHA-256 of each migration's SQL, with line endings
 * normalised to LF (a Windows checkout with core.autocrlf must not count as an edit), and of its journal
 * entry. Never edit an applied migration: add a new one that corrects it.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_FOLDER } from "../migrate";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST = join(MIGRATIONS_FOLDER, "checksums.json");

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

async function check(): Promise<void> {
  const admin = process.env.REAL_PG_ADMIN_URL;
  if (!admin) throw new Error("REAL_PG_ADMIN_URL is not set (root: corepack pnpm db:migrate:check starts from the local server)");
  const pg = (await import("pg")).default;
  const { runMigrations } = await import("../migrate");
  const name = `synan_migcheck_${randomBytes(4).toString("hex")}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const t0 = Date.now();
  try {
    await c.query(`create database "${name}"`);
    await runMigrations(url.toString());
    const first = Date.now() - t0;
    await runMigrations(url.toString()); // again: nothing pending, nothing fails
    const d = new pg.Client({ connectionString: url.toString() });
    await d.connect();
    try {
      const applied = (await d.query<{ n: number; last: string }>(`select count(*)::int n, max(created_at)::text last from drizzle.__drizzle_migrations`)).rows[0]!;
      const { entries } = journal();
      if (applied.n !== entries.length) throw new Error(`applied ${applied.n} migrations, the journal has ${entries.length}`);
      if (Number(applied.last) !== entries.at(-1)!.when) throw new Error(`last applied migration is ${applied.last}, the journal's last is ${entries.at(-1)!.when}`);
      const v = (await d.query<{ v: string }>(`select current_setting('server_version') v`)).rows[0]!.v;
      const queues = (await d.query<{ n: number }>(`select count(*)::int n from pgboss.queue`)).rows[0]!.n;
      console.log(`ok: ${entries.length} migrations applied to an empty database on PostgreSQL ${v} in ${first} ms, re-applied as a no-op; pg-boss installed with ${queues} queues`);
    } finally {
      await d.end();
    }
  } finally {
    await c.query(`drop database if exists "${name}" with (force)`).catch(() => undefined);
    await c.end();
  }
}

const cmd = process.argv[2];
if (cmd === "verify") {
  const sections: [string, () => string[]][] = [["journal", checkJournal], ["checksums", checkManifest], ["schema vs migrations (drizzle-kit generate)", checkGenerate]];
  let failed = false;
  for (const [name, f] of sections) {
    const p = f();
    console.log(`${p.length ? "FAIL" : "ok  "} ${name}${p.length ? `\n  - ${p.join("\n  - ")}` : ""}`);
    failed ||= p.length > 0;
  }
  process.exit(failed ? 1 : 0);
} else if (cmd === "manifest") {
  const arg = process.argv.find((a) => a.startsWith("--accept-changed="));
  writeManifest(new Set(arg ? arg.slice("--accept-changed=".length).split(",").filter(Boolean) : []));
} else if (cmd === "check") {
  await check();
} else {
  console.error("usage: tsx src/cli/migrations.ts verify | manifest [--accept-changed=tag,…] | check");
  process.exit(2);
}
