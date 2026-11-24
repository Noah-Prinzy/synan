#!/usr/bin/env node
/**
 * `corepack pnpm check` — the fast subset of CI, to run before pushing:
 * lockfile in sync, repository hygiene, Markdown links, applied migrations unchanged, typecheck of
 * all 8 packages, the unit suites (contracts, scanner, db and API on PGlite, API in memory), the
 * test-count guard for those suites, and the migration check on PGlite.
 *
 *   corepack pnpm check            everything above (about 3–5 minutes)
 *   corepack pnpm check --quick    without the PGlite suites (db, api-pglite) and the migration check
 *
 * Not here (CI only, or run by hand): the real-PostgreSQL job, app builds and bundle budgets
 * (`corepack pnpm build:apps && corepack pnpm budget`), the dependency audit
 * (`corepack pnpm audit:deps`), secret scanning and static analysis.
 */
import { spawnSync } from "node:child_process";
import { ROOT, pnpm, textTable } from "./lib/util.mjs";

const quick = process.argv.includes("--quick");
const node = (script, ...args) => () => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: "inherit" }).status ?? 1;
const suites = quick ? ["contracts", "scanner", "api-memory"] : ["contracts", "scanner", "db", "api-memory", "api-pglite"];

const steps = [
  ["Lockfile in sync (pnpm install --frozen-lockfile)", () => pnpm(["install", "--frozen-lockfile", "--prefer-offline"])],
  ["Repository hygiene", node("scripts/hygiene.mjs")],
  ["Markdown links", node("scripts/check-links.mjs")],
  ["Applied migrations unchanged", node("scripts/db/migrations-verify.mjs")],
  ["Typecheck, all packages", () => pnpm(["-r", "typecheck"])],
  [`Tests: ${suites.join(", ")}`, node("scripts/run-suite.mjs", ...suites)],
  ["Test counts", node("scripts/test-counts.mjs", "check", "--suites", suites.join(","))],
  ...(quick ? [] : [["Migrations apply (PGlite) and match the schema", () => pnpm(["--filter", "@synan/db", "exec", "tsx", "../../scripts/db/migrate-check.mts"])]]),
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
