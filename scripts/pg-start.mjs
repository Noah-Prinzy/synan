#!/usr/bin/env node
/**
 * Starts the local PostgreSQL 17 (initialising the data directory on first use). Idempotent.
 * Settings and defaults: scripts/pg-lib.mjs.   corepack pnpm pg:start
 */
import { spawnSync } from "node:child_process";
import { data, initCluster, logFile, port, host, ready, requireBinaries, running, serverOptions, tool } from "./pg-lib.mjs";

requireBinaries();
if (initCluster()) console.log(`initialised ${data} (superuser postgres, password in the password file)`);
if (running()) {
  console.log(`already running on ${host}:${port}`);
  process.exit(0);
}
// stdio "ignore": the server inherits pg_ctl's handles, and a pipe it holds would keep this script waiting forever.
const r = spawnSync(tool("pg_ctl"), ["start", "-D", data, "-l", logFile, "-w", "-t", "60", "-o", serverOptions()], { stdio: "ignore", windowsHide: true });
if (r.error) throw r.error;
if (r.status !== 0 || !ready()) {
  console.error(`PostgreSQL did not start; see ${logFile}`);
  process.exit(1);
}
console.log(`PostgreSQL running on ${host}:${port} (data ${data}, log ${logFile})`);
