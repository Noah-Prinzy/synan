#!/usr/bin/env node
/**
 * Runs named test suites and records each one's counts for the test-count guard
 * (scripts/test-counts.mjs). One place defines what each suite is, so the local pre-push check and
 * the CI jobs run exactly the same commands.
 *
 *   node scripts/run-suite.mjs <suite> [<suite> …]       e.g. db api-memory
 *   node scripts/run-suite.mjs <suite> -- <extra args>    extra arguments for that one suite's runner
 *                                                         e.g. e2e -- --grep @a11y
 *   node scripts/run-suite.mjs --list
 *
 * Vitest suites write vitest JSON; the end-to-end suite (Playwright) writes its own JSON report, which
 * is turned into the same counts. Results go to $SYNAN_TEST_RESULTS or test-results/ at the root
 * (git-ignored), one <suite>.json each. Runs every suite asked for, then exits 1 if any failed.
 *
 * The realpg-* suites need REAL_PG_ADMIN_URL (root `corepack pnpm test:realpg` sets it from the local
 * server, scripts/with-pg.mjs; CI sets it to its service container). They run the WHOLE db and API
 * suites on that server (vitest `--mode realpg`): the API through the three role logins
 * (REPO=postgres), plus test/realpg/ (pg-boss), which no other mode includes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { annotate, mdTable, pnpm, ROOT, summary, textTable } from "./lib/util.mjs";

export const SUITES = {
  contracts: { pkg: "@synan/contracts", args: [], about: "contracts (Zod schemas, role matrix)" },
  db: { pkg: "@synan/db", args: [], about: "database package on PGlite (the real-PostgreSQL file skips itself)" },
  "api-memory": { pkg: "@synan/api", args: [], about: "API on the in-memory backend" },
  "api-pglite": { pkg: "@synan/api", args: ["--mode", "pglite"], about: "API on the SQL backend, PGlite" },
  scanner: { pkg: "@synan/scanner", args: [], about: "Gate Scanner offline core" },
  attendee: { pkg: "@synan/attendee", args: [], about: "Attendee Portal (API client, screens' logic)" },
  admin: { pkg: "@synan/admin", args: [], about: "Admin Console (API client, screens' logic)" },
  "realpg-db": { pkg: "@synan/db", args: ["--mode", "realpg"], realPg: true, about: "the whole db suite on a real PostgreSQL server" },
  "realpg-api": { pkg: "@synan/api", args: ["--mode", "realpg"], realPg: true, about: "the whole API suite on a real PostgreSQL server (REPO=postgres, three role logins) and the pg-boss job runner" },
  e2e: { pkg: "@synan/e2e", runner: "playwright", about: "end-to-end journeys (Playwright, the three apps against one API)" },
};

export const resultsDir = () => process.env.SYNAN_TEST_RESULTS || join(ROOT, "test-results");

/** { passed, failed, skipped, todo, total } from a vitest JSON report, or null. */
export function readCounts(file) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, "utf8"));
  return { passed: j.numPassedTests, failed: j.numFailedTests, skipped: j.numPendingTests, todo: j.numTodoTests, total: j.numTotalTests, success: j.success };
}

/** Where the Playwright config (e2e/playwright.config.ts) writes its JSON report. */
const PLAYWRIGHT_JSON = join(ROOT, "e2e", ".results", "results.json");

/**
 * A Playwright JSON report's totals in vitest's JSON shape. Passed: tests that ended as expected
 * (an expected failure, `test.fail`, counts, as vitest's `it.fails` does) plus flaky ones (passed on
 * the retry); failed: unexpected; skipped: skipped and fixme.
 */
function playwrightToVitest(file) {
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, "utf8")).stats ?? {};
  const passed = (s.expected ?? 0) + (s.flaky ?? 0);
  const failed = s.unexpected ?? 0;
  const skipped = s.skipped ?? 0;
  return { numPassedTests: passed, numFailedTests: failed, numPendingTests: skipped, numTodoTests: 0, numTotalTests: passed + failed + skipped, success: failed === 0, source: "playwright", flaky: s.flaky ?? 0 };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf("--");
  const names = dash >= 0 ? argv.slice(0, dash) : argv;
  const extra = dash >= 0 ? argv.slice(dash + 1) : [];
  if (!names.length || names.includes("--list")) {
    console.log(Object.entries(SUITES).map(([n, s]) => `${n.padEnd(12)} ${s.about}`).join("\n"));
    process.exit(names.length ? 0 : 1);
  }
  const unknown = names.filter((n) => !SUITES[n]);
  if (unknown.length) {
    console.error(`Unknown suite(s): ${unknown.join(", ")}. Known: ${Object.keys(SUITES).join(", ")}`);
    process.exit(1);
  }
  if (extra.length && names.length > 1) {
    console.error("Extra arguments (after --) are for one suite at a time.");
    process.exit(1);
  }
  const dir = resultsDir();
  mkdirSync(dir, { recursive: true });
  const rows = [];
  let failed = false;
  for (const name of names) {
    const s = SUITES[name];
    if (s.realPg && !process.env.REAL_PG_ADMIN_URL) {
      annotate("error", `${name} needs REAL_PG_ADMIN_URL (an admin login with CREATEDB and CREATEROLE; locally: corepack pnpm test:realpg); without it the suite cannot run.`, "test suite");
      failed = true;
      rows.push([name, "-", "-", "-", "not run"]);
      continue;
    }
    const out = join(dir, `${name}.json`);
    rmSync(out, { force: true }); // never count an earlier run's results
    console.log(`\n=== ${name}: ${s.about}\n`);
    let status;
    if (s.runner === "playwright") {
      rmSync(PLAYWRIGHT_JSON, { force: true });
      status = pnpm(["--filter", s.pkg, "test", ...extra]);
      const converted = playwrightToVitest(PLAYWRIGHT_JSON);
      if (converted) writeFileSync(out, `${JSON.stringify(converted, null, 2)}\n`);
    } else {
      const reporters = ["--reporter=default", "--reporter=json", `--outputFile.json=${out}`];
      if (process.env.GITHUB_ACTIONS) reporters.push("--reporter=github-actions");
      status = pnpm(["--filter", s.pkg, "exec", "vitest", "run", ...s.args, ...extra, ...reporters]);
    }
    const c = readCounts(out);
    if (status !== 0 || !c || c.failed > 0) failed = true;
    rows.push([name, c ? String(c.passed) : "-", c ? String(c.failed) : "-", c ? String(c.skipped) : "-", status === 0 && c && c.failed === 0 ? "pass" : "FAIL"]);
  }
  const headers = ["Suite", "Passed", "Failed", "Skipped", "Result"];
  const align = ["l", "r", "r", "r", "l"];
  console.log(`\n${textTable(headers, rows, align)}`);
  summary(`### Tests\n\n${mdTable(headers, rows, align)}`);
  process.exit(failed ? 1 : 0);
}
