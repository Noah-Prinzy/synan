#!/usr/bin/env node
/**
 * Runs a command with REAL_PG_ADMIN_URL pointing at the local PostgreSQL (scripts/pg-lib.mjs), unless
 * it is already set (CI sets it to its own service). The URL holds the password and is passed only in
 * the child's environment, never printed.
 *
 *   node scripts/with-pg.mjs corepack pnpm --filter ./packages/db test:realpg
 */
import { spawn } from "node:child_process";
import { adminUrl, host, port } from "./pg-lib.mjs";
import { pnpmCommand } from "./pnpm.mjs";

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
const childEnv = { ...process.env, REAL_PG_ADMIN_URL: url };
// Windows needs a shell to find `corepack`/`.cmd` shims; give it one quoted command line.
const quote = (a) => (/^[\w./:=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const child =
  cmd === "pnpm"
    ? (([c, a, shell]) => spawn(c, a, { stdio: "inherit", shell, env: childEnv }))(pnpmCommand(args))
    : process.platform === "win32"
    ? spawn([cmd, ...args].map(quote).join(" "), { stdio: "inherit", shell: true, env: childEnv })
    : spawn(cmd, args, { stdio: "inherit", env: childEnv });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
