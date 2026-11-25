#!/usr/bin/env node
/**
 * Reports the local PostgreSQL 17: binaries, data directory, running or not, and the admin URL with
 * the password masked. Exit code 0 when accepting connections, 3 when not.   corepack pnpm pg:status
 */
import { adminUrl, bin, data, host, initialised, logFile, masked, passwordFile, port, ready, requireBinaries, run, running } from "./pg-lib.mjs";

requireBinaries();
const version = run("pg_ctl", ["--version"], { quiet: true }).stdout.trim();
const up = running();
const accepting = up && ready();
const url = adminUrl();
console.log(
  [
    `binaries   ${bin} (${version})`,
    `data       ${data} (${initialised() ? "initialised" : "not initialised"})`,
    `server     ${accepting ? `running, accepting connections on ${host}:${port}` : up ? "running, not accepting connections" : "stopped"}`,
    `password   ${passwordFile}`,
    `log        ${logFile}`,
    `admin URL  ${url ? masked(url) : "(none: no password file yet)"}`,
  ].join("\n"),
);
process.exit(accepting ? 0 : 3);
