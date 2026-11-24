#!/usr/bin/env node
/**
 * `corepack pnpm db:migrations:verify` — no applied migration has been edited.
 *
 * PROVISIONAL (CI, step 5.1): a minimal version written so the CI workflow is complete on its own.
 * Another engineer is writing migration-hygiene scripts under the same name; at merge, keep one
 * implementation and make sure it still covers the checks listed here.
 *
 * Applied migrations are the ones recorded in packages/db/migration-checksums.json: their SQL
 * (line endings normalised to LF) and their journal entry (tag, `when`, breakpoints — drizzle decides
 * what is applied from `when`) must be unchanged. A migration file not yet recorded fails the check
 * until it is recorded with `--update`, which adds new entries and never changes existing ones.
 * With `--base <git ref>`, every migration at that ref must also be byte-identical (LF) now and its
 * journal entry unchanged, so an edit cannot hide behind an edited manifest.
 *
 *   node scripts/db/migrations-verify.mjs [--update] [--base <ref>]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { annotate, git, mdTable, ROOT, summary } from "../lib/util.mjs";

const DIR = "packages/db/migrations";
const MANIFEST = "packages/db/migration-checksums.json";
const args = process.argv.slice(2);
const update = args.includes("--update");
const baseRef = args.includes("--base") ? args[args.indexOf("--base") + 1] : undefined;

const lf = (s) => s.replace(/\r\n/g, "\n");
const sha = (s) => createHash("sha256").update(lf(s)).digest("hex");
const journal = JSON.parse(readFileSync(join(ROOT, DIR, "meta/_journal.json"), "utf8"));
const entryOf = (j, tag) => {
  const e = j.entries.find((x) => x.tag === tag);
  return e ? { when: e.when, breakpoints: e.breakpoints } : null;
};
const files = readdirSync(join(ROOT, DIR)).filter((f) => f.endsWith(".sql")).sort();
const manifest = existsSync(join(ROOT, MANIFEST)) ? JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8")) : { migrations: {} };

const problems = [];
const added = [];
for (const [file, rec] of Object.entries(manifest.migrations)) {
  const p = join(ROOT, DIR, file);
  if (!existsSync(p)) {
    problems.push([file, "recorded as applied but deleted"]);
    continue;
  }
  if (sha(readFileSync(p, "utf8")) !== rec.sha256) problems.push([file, "edited after it was recorded as applied (checksum differs)"]);
  const e = entryOf(journal, file.replace(/\.sql$/, ""));
  if (!e || e.when !== rec.when || e.breakpoints !== rec.breakpoints) problems.push([file, "journal entry changed or removed (tag, when or breakpoints)"]);
}
for (const f of files) {
  if (manifest.migrations[f]) continue;
  const e = entryOf(journal, f.replace(/\.sql$/, ""));
  if (update) {
    if (!e) problems.push([f, "not in the journal; generate it with drizzle-kit"]);
    else {
      manifest.migrations[f] = { sha256: sha(readFileSync(join(ROOT, DIR, f), "utf8")), when: e.when, breakpoints: e.breakpoints };
      added.push(f);
    }
  } else problems.push([f, "new migration not recorded: run `corepack pnpm db:migrations:verify --update` and commit the manifest"]);
}

if (baseRef) {
  const listing = git(["ls-tree", "--name-only", `${baseRef}:${DIR}`], { allowFail: true });
  if (listing === null) console.log(`No ${DIR} at ${baseRef}: nothing to compare with.`);
  else {
    const baseJournalText = git(["show", `${baseRef}:${DIR}/meta/_journal.json`], { allowFail: true });
    const baseJournal = baseJournalText ? JSON.parse(baseJournalText) : { entries: [] };
    for (const f of listing.split("\n").filter((x) => x.endsWith(".sql"))) {
      const p = join(ROOT, DIR, f);
      if (!existsSync(p)) {
        problems.push([f, `deleted since ${baseRef}`]);
        continue;
      }
      if (sha(git(["show", `${baseRef}:${DIR}/${f}`])) !== sha(readFileSync(p, "utf8"))) problems.push([f, `edited since ${baseRef}`]);
      const before = entryOf(baseJournal, f.replace(/\.sql$/, ""));
      const now = entryOf(journal, f.replace(/\.sql$/, ""));
      if (before && (!now || now.when !== before.when || now.breakpoints !== before.breakpoints)) problems.push([f, `journal entry changed since ${baseRef}`]);
    }
  }
}

if (update && added.length) {
  const sorted = Object.fromEntries(Object.entries(manifest.migrations).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    join(ROOT, MANIFEST),
    `${JSON.stringify({ $comment: "Applied migrations: SHA-256 of each SQL file (LF line endings) and its journal entry. Checked by `db:migrations:verify`; new entries are added with `--update`; existing entries are never changed.", migrations: sorted }, null, 2)}\n`,
  );
  console.log(`Recorded ${added.length} migration(s): ${added.join(", ")}`);
}

const recorded = Object.keys(manifest.migrations).length;
if (problems.length) {
  for (const [f, why] of problems) annotate("error", `${DIR}/${f}: ${why}`, "migrations");
  summary(`### Migrations verify: ${problems.length} problem(s)\n\n${mdTable(["Migration", "Problem"], problems.map(([f, w]) => [`\`${f}\``, w]))}`);
  process.exit(1);
}
console.log(`Migrations verify: ${recorded} recorded migrations unchanged; ${files.length} files${baseRef ? `; none edited since ${baseRef}` : ""}.`);
summary(`### Migrations verify: pass\n\n${recorded} applied migrations unchanged${baseRef ? `, none edited since \`${baseRef}\`` : ""}.`);
