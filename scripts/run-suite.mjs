#!/usr/bin/env node
/**
 * Runs named test suites with vitest and records each one's counts for the test-count guard
 * (scripts/test-counts.mjs). One place defines what each suite is, so the local pre-push check and
 * the CI jobs run exactly the same commands.
 *
 *   node scripts/run-suite.mjs <suite> [<suite> …]     e.g. db api-memory
 *   node scripts/run-suite.mjs --list
 *
 * Results (vitest JSON) go to $SYNAN_TEST_RESULTS or test-results/ at the root (git-ignored).
 * Runs every suite asked for, then exits 1 if any failed.
 */
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { annotate, mdTable, pnpm, ROOT, summary, textTable } from "./lib/util.mjs";

export const SUITES = {
  contracts: { pkg: "@synan/contracts", args: [], about: "contracts (Zod schemas, role matrix)" },
  db: { pkg: "@synan/db", args: [], about: "database package on PGlite (the real-PostgreSQL file skips itself)" },
  "api-memory": { pkg: "@synan/api", args: [], about: "API on the in-memory backend" },
  "api-pglite": { pkg: "@synan/api", args: ["--mode", "pglite"], about: "API on the SQL backend, PGlite" },
  scanner: { pkg: "@synan/scanner", args: [], about: "Gate Scanner offline core" },
  "realpg-db": { pkg: "@synan/db", args: ["test/real-postgres.test.ts"], realPg: true, about: "database checks on a real PostgreSQL server" },
  "realpg-api": { pkg: "@synan/api", args: ["test/jobs-realpg.test.ts"], realPg: true, about: "job runner (pg-boss) smoke test on a real PostgreSQL server" },
};

export const resultsDir = () => process.env.SYNAN_TEST_RESULTS || join(ROOT, "test-results");

/** { passed, failed, skipped, todo, total } from a vitest JSON report, or null. */
export function readCounts(file) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, "utf8"));
  return { passed: j.numPassedTests, failed: j.numFailedTests, skipped: j.numPendingTests, todo: j.numTodoTests, total: j.numTotalTests, success: j.success };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const names = process.argv.slice(2);
  if (!names.length || names.includes("--list")) {
    console.log(Object.entries(SUITES).map(([n, s]) => `${n.padEnd(12)} ${s.about}`).join("\n"));
    process.exit(names.length ? 0 : 1);
  }
  const unknown = names.filter((n) => !SUITES[n]);
  if (unknown.length) {
    console.error(`Unknown suite(s): ${unknown.join(", ")}. Known: ${Object.keys(SUITES).join(", ")}`);
    process.exit(1);
  }
  const dir = resultsDir();
  mkdirSync(dir, { recursive: true });
  const rows = [];
  let failed = false;
  for (const name of names) {
    const s = SUITES[name];
    if (s.realPg && !process.env.REAL_PG_ADMIN_URL) {
      annotate("error", `${name} needs REAL_PG_ADMIN_URL (an admin login with CREATEDB and CREATEROLE); without it every test would be skipped.`, "test suite");
      failed = true;
      rows.push([name, "-", "-", "-", "not run"]);
      continue;
    }
    const out = join(dir, `${name}.json`);
    const reporters = ["--reporter=default", "--reporter=json", `--outputFile.json=${out}`];
    if (process.env.GITHUB_ACTIONS) reporters.push("--reporter=github-actions");
    console.log(`\n=== ${name}: ${s.about}\n`);
    const status = pnpm(["--filter", s.pkg, "exec", "vitest", "run", ...s.args, ...reporters]);
    const c = readCounts(out);
    if (status !== 0 || !c || c.failed > 0) failed = true;
    rows.push([name, c ? String(c.passed) : "-", c ? String(c.failed) : "-", c ? String(c.skipped) : "-", status === 0 && c ? "pass" : "FAIL"]);
  }
  const headers = ["Suite", "Passed", "Failed", "Skipped", "Result"];
  const align = ["l", "r", "r", "r", "l"];
  console.log(`\n${textTable(headers, rows, align)}`);
  summary(`### Tests\n\n${mdTable(headers, rows, align)}`);
  process.exit(failed ? 1 : 0);
}
