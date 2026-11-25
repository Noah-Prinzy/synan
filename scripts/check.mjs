#!/usr/bin/env node
/**
 * `corepack pnpm check` — the fast subset of CI, to run before pushing:
 * lockfile in sync, repository hygiene, Markdown links, migrations (journal in order, no recorded
 * migration edited, `drizzle-kit generate` finds no difference from the schema), typecheck of every
 * package, the unit suites (contracts, scanner, attendee, admin, db and API on PGlite, API in
 * memory), and the test-count guard for those suites.
 *
 *   corepack pnpm check            everything above (about 4–6 minutes)
 *   corepack pnpm check --quick    without the PGlite suites (db, api-pglite)
 *
 * Not here (CI, or run by hand): the real-PostgreSQL suites and migration check
 * (`corepack pnpm pg:start`, then `corepack pnpm test:realpg` and `corepack pnpm db:migrate:check`,
 * then `corepack pnpm pg:stop`), app builds and bundle budgets
 * (`corepack pnpm build:apps && corepack pnpm budget`), the end-to-end journeys (`corepack pnpm e2e`),
 * the dependency audit (`corepack pnpm audit:deps`), secret scanning and static analysis.
 */
import { spawnSync } from "node:child_process";
import { ROOT, pnpm, textTable } from "./lib/util.mjs";

const quick = process.argv.includes("--quick");
const node = (script, ...args) => () => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: "inherit" }).status ?? 1;
const suites = quick ? ["contracts", "scanner", "attendee", "admin", "api-memory"] : ["contracts", "scanner", "attendee", "admin", "db", "api-memory", "api-pglite"];

const steps = [
  ["Lockfile in sync (pnpm install --frozen-lockfile)", () => pnpm(["install", "--frozen-lockfile", "--prefer-offline"])],
  ["Repository hygiene", node("scripts/hygiene.mjs")],
  ["Markdown links", node("scripts/check-links.mjs")],
  ["Migrations: order, none edited, schema matches (db:migrations:verify)", () => pnpm(["--filter", "@synan/db", "migrations:verify"])],
  ["Typecheck, all packages", () => pnpm(["-r", "typecheck"])],
  [`Tests: ${suites.join(", ")}`, node("scripts/run-suite.mjs", ...suites)],
  ["Test counts", node("scripts/test-counts.mjs", "check", "--suites", suites.join(","))],
];

const results = [];
for (const [name, run] of steps) {
  console.log(`\n────── ${name}\n`);
  const t0 = Date.now();
  const status = run();
  results.push([name, status === 0 ? "pass" : "FAIL", `${Math.round((Date.now() - t0) / 1000)} s`]);
}
console.log(`\n${textTable(["Check", "Result", "Time"], results, ["l", "l", "r"])}`);
const failed = results.filter((r) => r[1] !== "pass").length;
console.log(failed ? `\n${failed} check(s) failed. Fix them before pushing.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
