#!/usr/bin/env node
/**
 * Throws the local cluster away: stops it, deletes the data directory and the password file, and
 * initialises a new one with a new password. Leaves it stopped unless `--start` is given.
 *
 *   node scripts/pg-reset.mjs --yes [--start]
 */
import { rmSync } from "node:fs";
import { data, initCluster, passwordFile, requireBinaries, run, running } from "./pg-lib.mjs";

if (!process.argv.includes("--yes")) {
  console.error(`This deletes every database in ${data}. Run again with --yes to confirm.`);
  process.exit(2);
}
requireBinaries();
if (running()) run("pg_ctl", ["stop", "-D", data, "-m", "immediate", "-w"], { quiet: true });
rmSync(data, { recursive: true, force: true });
rmSync(passwordFile, { force: true });
initCluster();
console.log(`re-initialised ${data}`);
if (process.argv.includes("--start")) await import("./pg-start.mjs");
