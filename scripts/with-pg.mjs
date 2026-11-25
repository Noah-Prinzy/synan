#!/usr/bin/env node
/**
 * Runs a command with REAL_PG_ADMIN_URL pointing at the local PostgreSQL (scripts/pg-lib.mjs), unless
 * it is already set (CI sets it to its own service). The URL holds the password and is passed only in
 * the child's environment, never printed.
 *
 *   node scripts/with-pg.mjs pnpm --filter @synan/db migrate:check
 *   node scripts/with-pg.mjs node scripts/run-suite.mjs realpg-db realpg-api
 *
 * Nothing runs through a shell, so no argument is ever re-read by cmd.exe or sh. `pnpm` goes through
 * scripts/lib/util.mjs (so it works where pnpm is not on PATH), `node` is this Node, and anything else
 * is started directly; on Windows that means a real `.exe`, not a `.cmd` shim — wrap such tools in
 * `pnpm exec …` instead.
 */
import { spawn } from "node:child_process";
import { adminUrl, host, port } from "./pg-lib.mjs";
import { pnpmCommand } from "./lib/util.mjs";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/with-pg.mjs <command> [args…]");
  process.exit(2);
}
const url = adminUrl();
if (!url) {
  console.error(`No REAL_PG_ADMIN_URL and no local password file: run "corepack pnpm pg:start" first (${host}:${port}).`);
  process.exit(2);
}
const env = { ...process.env, REAL_PG_ADMIN_URL: url };
let child;
if (cmd === "pnpm") {
  const p = pnpmCommand();
  child = spawn(p.cmd, [...p.pre, ...args], { stdio: "inherit", env });
} else if (cmd === "node") {
  child = spawn(process.execPath, args, { stdio: "inherit", env });
} else {
  child = spawn(cmd, args, { stdio: "inherit", env });
}
child.on("error", (err) => {
  console.error(`with-pg: could not start "${cmd}": ${err.message}`);
  process.exit(127);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
