#!/usr/bin/env node
/** Stops the local PostgreSQL 17 (fast shutdown: open sessions are ended). Idempotent.   corepack pnpm pg:stop */
import { data, requireBinaries, run, running } from "./pg-lib.mjs";

requireBinaries();
if (!running()) {
  console.log("not running");
  process.exit(0);
}
const r = run("pg_ctl", ["stop", "-D", data, "-m", "fast", "-w", "-t", "60"], { quiet: true });
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
console.log("stopped");
