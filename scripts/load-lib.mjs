/**
 * Shared by load-scans.mjs and explain-hot-paths.mjs: the seeded load database (apps/api seed:load),
 * its connection URLs, and the API started against it as a child process.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adminUrl } from "./pg-lib.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const home = process.env.SYNAN_PG_HOME || join(homedir(), ".synan-tools");
export const load = JSON.parse(readFileSync(join(home, "synan-load.json"), "utf8"));
export const ADMIN = adminUrl();
if (!ADMIN) throw new Error("no admin URL: corepack pnpm pg:start");
/** node-postgres, resolved from @synan/db (the root has no dependencies of its own). */
export const pg = createRequire(join(ROOT, "packages", "db", "package.json"))("pg");

// The test logins' password, as @synan/db/testing realPgTestPassword derives it.
const loginPassword = createHash("sha256").update(`synan-test-logins:${ADMIN}`).digest("base64url").slice(0, 32);
export const urlFor = (user) => {
  const u = new URL(ADMIN);
  u.pathname = `/${load.database}`;
  if (user) {
    u.username = user;
    u.password = loginPassword;
  }
  return u.toString();
};
/** The dev fixture's operator addresses (same domain as the gate users). */
export const devDomain = load.gates[0].email.split("@")[1];

export const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};

/** Starts the API on `port` against the load database (three role logins, rate limits lifted). */
export async function startApi(port) {
  const apiDir = join(ROOT, "apps", "api");
  const tsxCli = join(apiDir, "node_modules", "tsx", "dist", "cli.mjs");
  const api = spawn(process.execPath, [tsxCli, "src/main.ts"], {
    cwd: apiDir,
    env: {
      ...process.env, NODE_ENV: "development", REPO: "postgres", SEED: "none", PORT: String(port), HOST: "127.0.0.1", MAIL_TRANSPORT: "memory",
      DATABASE_URL: urlFor("synan_test_api"), DATABASE_VAULT_URL: urlFor("synan_test_vault"), DATABASE_SCAN_URL: urlFor("synan_test_scan"),
      ACCESS_TOKEN_TTL_S: "3600", RATE_AUTH_PER_MIN: "1000000", RATE_SCAN_PER_MIN: "10000000", RATE_CHECKPOINT_SCANS_PER_MIN: "1000000",
      RATE_PUBLIC_PER_MIN: "1000000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  api.stdout.on("data", (d) => (log += d));
  api.stderr.on("data", (d) => (log += d));
  process.on("exit", () => api.kill());
  for (const end = Date.now() + 120_000; !/listening on/.test(log); ) {
    if (Date.now() > end || api.exitCode !== null) throw new Error(`API did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (method, path, body, token) => {
    const t = performance.now();
    const r = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, ms: performance.now() - t };
  };
  const login = async (email) => {
    const r = await call("POST", "/auth/login", { email, password: load.password });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.access_token;
  };
  return { stop: () => api.kill(), call, login, log: () => log };
}

const uidBase = () => BigInt(`0x${load.bandUidBase}`);
/** Band UID of seeded attendee n (the rule of apps/api seed-load). */
export const bandUid = (n) => (uidBase() + BigInt(n)).toString(16).toUpperCase().padStart(14, "0");
