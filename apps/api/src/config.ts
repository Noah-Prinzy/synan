/** Runtime configuration from the environment. See `.env.example`. */
import { randomBytes } from "node:crypto";

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
  /** Seconds of tolerance when checking a QR's nbf/exp against the corrected scan time. */
  qrLeewayS: number;
  /** k-anonymity threshold for public telemetry (O-08). */
  kAnon: number;
  /** Repository implementation: in-memory maps, or @synan/db on an in-process PGlite. */
  repo: "memory" | "pglite";
  /** PGlite data directory; null = in-memory database (lost on exit). */
  pgliteDataDir: string | null;
  /** HMAC key for the attendee email blind index. Must be stable once data exists. Generated when absent (dev). */
  emailIndexKey: string;
  seed: "dev" | "none";
  trustProxy: boolean;
  /** Dev-only: log emails to the console. */
  mailTransport: "console" | "memory";
  rateLimits: { authPerMin: number; scanPerMin: number; resendPerHour: number };
  /** Validate every response against its contract (on outside production). */
  validateResponses: boolean;
}

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 5180),
    host: env.HOST ?? "127.0.0.1",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    attendeeAppOrigin: env.ATTENDEE_APP_ORIGIN ?? "http://localhost:5173",
    accessTokenPrivateJwk: env.ACCESS_TOKEN_PRIVATE_JWK || null,
    accessTokenTtlS: num(env.ACCESS_TOKEN_TTL_S, 600),
    operatorRefreshTtlS: num(env.OPERATOR_REFRESH_TTL_S, 12 * 3600),
    attendeeRefreshTtlS: num(env.ATTENDEE_REFRESH_TTL_S, 30 * 86400),
    mfaFreshS: num(env.MFA_FRESH_S, 900),
    emailLinkTtlS: num(env.EMAIL_LINK_TTL_S, 900),
    wsTicketTtlS: 30,
    qrCodeTtlS: num(env.QR_CODE_TTL_S, 60),
    qrBatchSize: num(env.QR_BATCH_SIZE, 15),
    qrLeewayS: num(env.QR_LEEWAY_S, 5),
    kAnon: num(env.K_ANON, 5),
    repo: env.REPO === "pglite" || process.argv.includes("--repo=pglite") ? "pglite" : "memory",
    pgliteDataDir: env.PGLITE_DATA_DIR || null,
    emailIndexKey: env.EMAIL_INDEX_KEY || randomBytes(32).toString("base64url"),
    seed: env.SEED === "none" ? "none" : "dev",
    trustProxy: env.TRUST_PROXY === "1",
    mailTransport: env.MAIL_TRANSPORT === "memory" ? "memory" : "console",
    rateLimits: {
      authPerMin: num(env.RATE_AUTH_PER_MIN, 10),
      scanPerMin: num(env.RATE_SCAN_PER_MIN, 600),
      resendPerHour: num(env.RATE_RESEND_PER_HOUR, 5),
    },
    validateResponses: env.NODE_ENV !== "production",
  };
}
