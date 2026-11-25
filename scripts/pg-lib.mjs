/**
 * Shared settings for the local PostgreSQL 17 scripts (pg-start, pg-stop, pg-status, pg-reset,
 * with-pg). A plain PostgreSQL binaries folder, no service, no installer, no admin rights.
 *
 * Everything machine-specific comes from the environment, with these defaults:
 *
 *   SYNAN_PG_HOME           tools folder                      ~/.synan-tools
 *   SYNAN_PG_BIN            folder holding pg_ctl, initdb      $SYNAN_PG_HOME/pgsql17/bin
 *   SYNAN_PG_DATA           data directory                     $SYNAN_PG_HOME/pgdata17
 *   SYNAN_PG_PORT           port (127.0.0.1 only)              54329
 *   SYNAN_PG_PASSWORD_FILE  superuser password (generated)     $SYNAN_PG_HOME/pg17-postgres.password
 *   SYNAN_PG_LOG            server log                         $SYNAN_PG_HOME/pg17.log
 *
 * The superuser is `postgres`. Its password is generated at initdb time, kept only in the password
 * file, and never printed. REAL_PG_ADMIN_URL, when set, wins over all of this (CI sets it directly).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;
const exe = process.platform === "win32" ? ".exe" : "";

export const home = env.SYNAN_PG_HOME || join(homedir(), ".synan-tools");
export const bin = env.SYNAN_PG_BIN || join(home, "pgsql17", "bin");
export const data = env.SYNAN_PG_DATA || join(home, "pgdata17");
export const port = Number(env.SYNAN_PG_PORT || 54329);
export const passwordFile = env.SYNAN_PG_PASSWORD_FILE || join(home, "pg17-postgres.password");
export const logFile = env.SYNAN_PG_LOG || join(home, "pg17.log");
export const host = "127.0.0.1";

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`SYNAN_PG_PORT must be an integer 1024..65535, got ${env.SYNAN_PG_PORT}`);
  process.exit(2);
}

export const tool = (name) => join(bin, name + exe);

export function requireBinaries() {
  if (!existsSync(tool("pg_ctl"))) {
    console.error(
      `PostgreSQL binaries not found in ${bin}.\n` +
        `Download the EnterpriseDB "postgresql-17.x-windows-x64-binaries.zip", unzip it, and move its "pgsql" folder to ` +
        `${join(home, "pgsql17")} (or set SYNAN_PG_BIN to its bin folder).`,
    );
    process.exit(2);
  }
}

/** Runs a PostgreSQL tool, inheriting output unless `quiet`. Returns { status, stdout, stderr }. */
export function run(name, args, { quiet = false, input } = {}) {
  const r = spawnSync(tool(name), args, {
    encoding: "utf8",
    stdio: quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
    input,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  return r;
}

export const initialised = () => existsSync(join(data, "PG_VERSION"));

/** pg_ctl status: true when a server is running on the data directory. */
export function running() {
  if (!initialised()) return false;
  return run("pg_ctl", ["status", "-D", data], { quiet: true }).status === 0;
}

/** Accepting connections on host:port (pg_isready). */
export function ready() {
  return run("pg_isready", ["-h", host, "-p", String(port), "-q"], { quiet: true }).status === 0;
}

export function readPassword() {
  if (!existsSync(passwordFile)) return null;
  return readFileSync(passwordFile, "utf8").trim() || null;
}

/** The superuser URL (contains the password: never print it). */
export function adminUrl(database = "postgres") {
  if (env.REAL_PG_ADMIN_URL) return env.REAL_PG_ADMIN_URL;
  const pw = readPassword();
  if (!pw) return null;
  return `postgres://postgres:${encodeURIComponent(pw)}@${host}:${port}/${database}`;
}

export const masked = (url) => url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");

/** Server options given on the command line, so the environment always decides the port. */
export const serverOptions = () => `-p ${port} -c listen_addresses=${host}`;

/**
 * initdb: UTF8, C locale (byte order, the same on every machine and on PGlite), superuser `postgres`
 * with a freshly generated password written to the password file (owner-only where the OS allows),
 * password (SCRAM) authentication for every connection, listening on 127.0.0.1 only.
 */
export function initCluster() {
  requireBinaries();
  if (initialised()) return false;
  mkdirSync(home, { recursive: true });
  const pw = randomBytes(24).toString("base64url");
  writeFileSync(passwordFile, pw + "\n", { mode: 0o600 });
  const pwTmp = join(home, `.initdb-pw-${randomBytes(4).toString("hex")}`);
  writeFileSync(pwTmp, pw + "\n", { mode: 0o600 });
  try {
    const r = run("initdb", [
      "-D", data, "-U", "postgres", `--pwfile=${pwTmp}`, "-E", "UTF8", "--locale=C",
      "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
    ], { quiet: true });
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error(`initdb failed (exit ${r.status})`);
    }
  } finally {
    rmSync(pwTmp, { force: true });
  }
  // Settings kept with the cluster. The port and address are also passed at every start (serverOptions).
  appendFileSync(
    join(data, "postgresql.conf"),
    [
      "",
      "# --- synan local development (scripts/pg-lib.mjs) ---",
      `listen_addresses = '${host}'`,
      `port = ${port}`,
      "max_connections = 400",
      "shared_buffers = 256MB",
      "work_mem = 8MB",
      "maintenance_work_mem = 128MB",
      "log_min_duration_statement = -1",
      "shared_preload_libraries = 'pg_stat_statements'",
      "track_io_timing = on",
      "log_line_prefix = '%m [%p] %u@%d '",
      "",
    ].join("\n"),
  );
  return true;
}
