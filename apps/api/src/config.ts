import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runtime configuration from the environment. See `.env.example`.
 *
 * Fails closed: a value that is present but malformed or out of range stops startup, rather than
 * becoming NaN and silently disabling a check (a NaN QR leeway used to accept every code forever).
 */

export interface Config {
  port: number;
  host: string;
  /** Origins allowed for CORS and WebSocket upgrade (Origin header). */
  allowedOrigins: string[];
  /** Where attendee sign-in links point. */
  attendeeAppOrigin: string;
  /** Ed25519 private JWK (JSON) for access tokens. Generated at startup when absent (dev only). */
  accessTokenPrivateJwk: string | null;
  accessTokenTtlS: number;
  operatorRefreshTtlS: number;
  attendeeRefreshTtlS: number;
  /** How long an MFA step-up authorises privileged actions. */
  mfaFreshS: number;
  emailLinkTtlS: number;
  wsTicketTtlS: number;
  /** Portal QR: validity of one code and how many consecutive codes per batch (O-07). */
  qrCodeTtlS: number;
  qrBatchSize: number;
  /** Seconds of tolerance when checking a QR's validity window against the scan time. 0–30. */
  qrLeewayS: number;
  /** k-anonymity threshold for public telemetry (O-08). */
  kAnon: number;
  /**
   * How long after a shift ends its scanner may still sync offline scans taken during the shift.
   * Online scans are always judged at server receipt time.
   */
  offlineSyncGraceS: number;
  /** Repository implementation: in-memory maps, or @synan/db on an in-process PGlite. */
  /**
   * Repository: in-memory maps (no encryption); @synan/db on an in-process PGlite (dev/tests, dev keys
   * unless DB_DATA_KEYS is set); or @synan/db on PostgreSQL via node-postgres with the role split.
   */
  repo: "memory" | "pglite" | "postgres";
  /** postgres: general (app_api), identity (app_vault) and scan (app_scan) connection URLs. */
  databaseUrl: string | null;
  databaseVaultUrl: string | null;
  databaseScanUrl: string | null;
  /** PGlite data directory; null = in-memory database (lost on exit). */
  pgliteDataDir: string | null;
  /** Dev fixtures. Opt-in: only `SEED=dev` or `--seed=dev` seeds. */
  seed: "dev" | "none";
  /**
   * Express `trust proxy`: false, a hop count, or a list of trusted proxy addresses/CIDRs.
   * Never `true` (that trusts a client-supplied X-Forwarded-For entirely).
   */
  trustProxy: false | number | string[];
  /** Dev-only: log emails to the console. */
  mailTransport: "console" | "memory";
  rateLimits: { authPerMin: number; scanPerMin: number; resendPerHour: number };
  /** Validate every response against its contract (on outside production). */
  /** Absolute origin of this API, for signed report download links. */
  publicApiOrigin: string;
  /** Local-disk report storage (development implementation of the storage interface). */
  reportStorageDir: string;
  /** Lifetime of a signed report download link. */
  reportLinkTtlS: number;
  /** Lifetime of the signed link a scheduled report emails (recipients open it later than a click in the console). */
  reportEmailLinkTtlS: number;
  /** Days a stored export file is kept before the retention job deletes it. */
  exportRetentionDays: number;
  validateResponses: boolean;
  production: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = "ConfigError";
  }
}

function int(env: NodeJS.ProcessEnv, key: string, d: number): number {
  const v = env[key];
  if (v === undefined || v.trim() === "") return d;
  if (!/^-?\d+$/.test(v.trim())) throw new ConfigError(`${key} must be an integer, got "${v}"`);
  return Number(v.trim());
}

/** `TRUST_PROXY`: unset/0/false → false; positive integer → hop count; otherwise a comma list of addresses/CIDRs. */
export function parseTrustProxy(v: string | undefined): Config["trustProxy"] {
  const s = (v ?? "").trim();
  if (s === "" || s === "0" || s.toLowerCase() === "false") return false;
  if (/^\d+$/.test(s)) return Number(s);
  if (s.toLowerCase() === "true") throw new ConfigError("TRUST_PROXY=true would trust any X-Forwarded-For; give a hop count or proxy addresses");
  const list = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (list.some((x) => !/^[0-9a-fA-F:.]+(\/\d{1,3})?$|^(loopback|linklocal|uniquelocal)$/.test(x))) {
    throw new ConfigError(`TRUST_PROXY must be a hop count or a list of IPs/CIDRs, got "${s}"`);
  }
  return list;
}

/** Range checks shared by env loading and programmatic overrides (tests, embedding). */
export function validateConfig(c: Config): Config {
  const range = (name: string, v: number, min: number, max: number) => {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) {
      throw new ConfigError(`${name} must be an integer in ${min}..${max}, got ${v}`);
    }
  };
  range("PORT", c.port, 0, 65535);
  range("ACCESS_TOKEN_TTL_S", c.accessTokenTtlS, 60, 3600);
  range("OPERATOR_REFRESH_TTL_S", c.operatorRefreshTtlS, 300, 30 * 86400);
  range("ATTENDEE_REFRESH_TTL_S", c.attendeeRefreshTtlS, 300, 90 * 86400);
  range("MFA_FRESH_S", c.mfaFreshS, 60, 3600);
  range("EMAIL_LINK_TTL_S", c.emailLinkTtlS, 60, 86400);
  range("wsTicketTtlS", c.wsTicketTtlS, 5, 60);
  range("QR_CODE_TTL_S", c.qrCodeTtlS, 10, 65535); // carried as u16 in the code
  range("QR_BATCH_SIZE", c.qrBatchSize, 1, 120);
  range("QR_LEEWAY_S", c.qrLeewayS, 0, 30);
  range("K_ANON", c.kAnon, 1, 1000);
  range("OFFLINE_SYNC_GRACE_S", c.offlineSyncGraceS, 0, 24 * 3600);
  range("RATE_AUTH_PER_MIN", c.rateLimits.authPerMin, 1, 1_000_000);
  range("RATE_SCAN_PER_MIN", c.rateLimits.scanPerMin, 1, 10_000_000);
  range("RATE_RESEND_PER_HOUR", c.rateLimits.resendPerHour, 1, 1_000_000);
  range("REPORT_LINK_TTL_S", c.reportLinkTtlS, 30, 3600);
  range("REPORT_EMAIL_LINK_TTL_S", c.reportEmailLinkTtlS, 300, 72 * 3600);
  range("EXPORT_RETENTION_DAYS", c.exportRetentionDays, 1, 365);
  if (c.trustProxy === (true as unknown)) throw new ConfigError("trustProxy must never be true");
  if (typeof c.trustProxy === "number") range("TRUST_PROXY", c.trustProxy, 1, 10);
  if (c.repo === "postgres" && !c.databaseUrl) throw new ConfigError("DATABASE_URL is required with REPO=postgres");
  if (c.production) {
    if (c.seed === "dev") throw new ConfigError("SEED=dev is not allowed in production");
    if (c.mailTransport === "console") throw new ConfigError("MAIL_TRANSPORT=console would write sign-in links to the log in production");
  }
  return c;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): Config {
  const production = env.NODE_ENV === "production";
  if (production && !env.ACCESS_TOKEN_PRIVATE_JWK) throw new ConfigError("ACCESS_TOKEN_PRIVATE_JWK is required in production");
  if (production) {
    // Production runs only on PostgreSQL with separated roles and real data keys (@synan/db 0005, crypto).
    if (env.REPO !== "postgres") throw new ConfigError("REPO=postgres is required in production");
    for (const k of ["DATABASE_URL", "DATABASE_VAULT_URL", "DATABASE_SCAN_URL", "DB_DATA_KEYS", "DB_BLIND_INDEX_KEYS"]) {
      if (!env[k]) throw new ConfigError(`${k} is required in production`);
    }
  }
  return validateConfig({
    port: int(env, "PORT", 5180),
    host: env.HOST ?? "127.0.0.1",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    attendeeAppOrigin: env.ATTENDEE_APP_ORIGIN ?? "http://localhost:5173",
    accessTokenPrivateJwk: env.ACCESS_TOKEN_PRIVATE_JWK || null,
    accessTokenTtlS: int(env, "ACCESS_TOKEN_TTL_S", 600),
    operatorRefreshTtlS: int(env, "OPERATOR_REFRESH_TTL_S", 12 * 3600),
    attendeeRefreshTtlS: int(env, "ATTENDEE_REFRESH_TTL_S", 30 * 86400),
    mfaFreshS: int(env, "MFA_FRESH_S", 900),
    emailLinkTtlS: int(env, "EMAIL_LINK_TTL_S", 900),
    wsTicketTtlS: 30,
    qrCodeTtlS: int(env, "QR_CODE_TTL_S", 60),
    qrBatchSize: int(env, "QR_BATCH_SIZE", 15),
    qrLeewayS: int(env, "QR_LEEWAY_S", 5),
    kAnon: int(env, "K_ANON", 5),
    offlineSyncGraceS: int(env, "OFFLINE_SYNC_GRACE_S", 3600),
    repo: env.REPO === "postgres" ? "postgres" : env.REPO === "pglite" || argv.includes("--repo=pglite") ? "pglite" : "memory",
    databaseUrl: env.DATABASE_URL || null,
    databaseVaultUrl: env.DATABASE_VAULT_URL || null,
    databaseScanUrl: env.DATABASE_SCAN_URL || null,
    pgliteDataDir: env.PGLITE_DATA_DIR || null,
    seed: env.SEED === "dev" || argv.includes("--seed=dev") ? "dev" : "none",
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    mailTransport: env.MAIL_TRANSPORT === "memory" ? "memory" : "console",
    rateLimits: {
      authPerMin: int(env, "RATE_AUTH_PER_MIN", 10),
      scanPerMin: int(env, "RATE_SCAN_PER_MIN", 600),
      resendPerHour: int(env, "RATE_RESEND_PER_HOUR", 5),
    },
    publicApiOrigin: env.API_PUBLIC_ORIGIN ?? "http://127.0.0.1:5180",
    reportStorageDir: env.REPORT_STORAGE_DIR ?? join(tmpdir(), "synan-reports"),
    reportLinkTtlS: int(env, "REPORT_LINK_TTL_S", 600),
    reportEmailLinkTtlS: int(env, "REPORT_EMAIL_LINK_TTL_S", 24 * 3600),
    exportRetentionDays: int(env, "EXPORT_RETENTION_DAYS", 7),
    validateResponses: !production,
    production,
  });
}
