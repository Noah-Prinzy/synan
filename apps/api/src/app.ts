/**
 * Composition root. `createApp()` wires config, repositories, services, Express routes
 * and the WebSocket server. Tests call it with a ManualClock, a MemoryMailer and fresh
 * in-memory repositories; `main.ts` calls it with the defaults.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ContractError, ERROR_COPY, type ApiError } from "@synan/contracts/errors";
import { endpoints, type EndpointDef } from "@synan/contracts/rest";
import { API_BASE_PATH } from "@synan/contracts/common";
import { loadConfig, validateConfig, type Config } from "./config.js";
import { AlertService } from "./domain/alerts.js";
import { AuditService } from "./domain/audit.js";
import { AuthService } from "./domain/auth-service.js";
import { CredentialService } from "./domain/credential-service.js";
import { KeyService } from "./domain/keys.js";
import { QrService } from "./domain/qr.js";
import { ScanService } from "./domain/scan-service.js";
import { RateLimiter } from "./http/rate-limit.js";
import { mountNotImplemented } from "./http/route.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { ConsoleMailer, MemoryMailer, type Mailer } from "./lib/mailer.js";
import { attachWebSockets } from "./realtime/ws-server.js";
import { TelemetryHub } from "./realtime/telemetry-hub.js";
import { createCipher, devKeyProvider, EnvKeyProvider, type Cipher } from "@synan/db";
import { createPgliteRepos, createPostgresRepos } from "./repo/drizzle.js";
import { createMemoryRepos } from "./repo/memory.js";
import type { Repos } from "./repo/types.js";
import { authRoutes } from "./routes/auth.js";
import { credentialRoutes } from "./routes/credentials.js";
import { eventRoutes } from "./routes/events.js";
import { scanRoutes } from "./routes/scans.js";
import { layoutRoutes } from "./routes/layout.js";
import { eventAdminRoutes } from "./routes/event-admin.js";
import { seedDev, type SeedResult } from "./seed.js";

export interface AppContext {
  config: Config;
  clock: Clock;
  repos: Repos;
  mailer: Mailer;
  keys: KeyService;
  qr: QrService;
  auth: AuthService;
  audit: AuditService;
  alerts: AlertService;
  credentials: CredentialService;
  scans: ScanService;
  telemetry: TelemetryHub;
  rateLimiter: RateLimiter;
  /** Contract endpoints that have a real handler (filled by `mount`). */
  mounted: Set<EndpointDef>;
}

export interface CreateAppOptions {
  config?: Partial<Config>;
  clock?: Clock;
  repos?: Repos;
  mailer?: Mailer;
  /** Seed the dev fixtures (default: config.seed === "dev"). */
  seed?: boolean;
}

export interface RunningApp {
  ctx: AppContext;
  express: Express;
  server: Server;
  seed: SeedResult | null;
  /** Endpoints that answer 501. */
  notImplemented: string[];
  listen(port?: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (res.getHeader("X-Request-Id") as string | undefined) ?? undefined;
  let body: ApiError;
  let status: number;
  if (err instanceof ContractError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}), request_id: requestId } };
  } else if (typeof err === "object" && err !== null && "type" in err && (err as { type: string }).type === "entity.parse.failed") {
    status = 400;
    body = { error: { code: "VALIDATION_FAILED", message: "Malformed JSON body.", request_id: requestId } };
  } else if (typeof err === "object" && err !== null && "type" in err && (err as { type: string }).type === "entity.too.large") {
    status = 413;
    body = { error: { code: "VALIDATION_FAILED", message: "Body too large.", request_id: requestId } };
  } else {
    console.error(`[api] ${req.method} ${req.path} failed`, err);
    status = 500;
    body = { error: { code: "INTERNAL", message: ERROR_COPY.INTERNAL.message, request_id: requestId } };
  }
  res.status(status).json(body);
}

const AUTH_CLEANUP_INTERVAL_MS = 10 * 60_000;

/**
 * The @synan/db field cipher, created once at startup. Real keys from DB_DATA_KEYS /
 * DB_BLIND_INDEX_KEYS when set (required in production); otherwise the fixed development keys,
 * which @synan/db refuses when NODE_ENV=production.
 */
export async function createAppCipher(env: NodeJS.ProcessEnv = process.env): Promise<Cipher> {
  return createCipher(env.DB_DATA_KEYS ? EnvKeyProvider.fromEnv(env) : devKeyProvider());
}

/** The repository the configuration asks for. SQL repositories encrypt; the in-memory one does not. */
export async function createRepos(config: Config): Promise<Repos> {
  if (config.repo === "memory") return createMemoryRepos();
  const cipher = await createAppCipher();
  if (config.repo === "pglite") return createPgliteRepos({ cipher, dataDir: config.pgliteDataDir ?? undefined });
  return createPostgresRepos({
    cipher,
    url: config.databaseUrl!,
    vaultUrl: config.databaseVaultUrl ?? undefined,
    scanUrl: config.databaseScanUrl ?? undefined,
    requireSeparateRoles: config.production,
  });
}

export async function createApp(opts: CreateAppOptions = {}): Promise<RunningApp> {
  const config: Config = validateConfig({ ...loadConfig(), ...opts.config });
  const clock = opts.clock ?? systemClock;
  const ownsRepos = !opts.repos;
  const repos = opts.repos ?? (await createRepos(config));
  const mailer = opts.mailer ?? (config.mailTransport === "memory" ? new MemoryMailer() : new ConsoleMailer());

  const keys = new KeyService(repos.signingKeys, clock);
  await keys.init();
  const qr = new QrService(keys, { codeTtlS: config.qrCodeTtlS, leewayS: config.qrLeewayS });
  const auth = new AuthService(repos, config, mailer, clock);
  await auth.init();
  const audit = new AuditService(repos.audit, clock);
  const alerts = new AlertService(repos.alerts, clock);
  const telemetry = new TelemetryHub(clock, { kAnon: config.kAnon });
  const credentials = new CredentialService(repos, qr, audit, mailer, config, clock);
  const scans = new ScanService(repos, qr, alerts, audit, telemetry, clock, { offlineSyncGraceMs: config.offlineSyncGraceS * 1000 });
  const rateLimiter = new RateLimiter(() => clock.now());

  const ctx: AppContext = {
    config, clock, repos, mailer, keys, qr, auth, audit, alerts, credentials, scans, telemetry, rateLimiter,
    mounted: new Set(),
  };

  const seed = (opts.seed ?? config.seed === "dev") ? await seedDev(ctx) : null;

  const x = express();
  x.disable("x-powered-by");
  x.set("trust proxy", config.trustProxy);
  x.use((req, res, next) => {
    res.setHeader("X-Request-Id", randomBytes(8).toString("hex"));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });
  x.use(`${API_BASE_PATH}/scans`, express.json({ limit: "2mb" }));
  x.use(express.json({ limit: "64kb" }));

  authRoutes(x, ctx);
  eventRoutes(x, ctx);
  credentialRoutes(x, ctx);
  scanRoutes(x, ctx);
  layoutRoutes(x, ctx);
  eventAdminRoutes(x, ctx);

  // Every contract endpoint without a real handler is mounted with full auth/RBAC, answering 501.
  const notImplemented: string[] = [];
  for (const def of Object.values(endpoints) as EndpointDef[]) {
    if (ctx.mounted.has(def)) continue;
    mountNotImplemented(x, ctx, def);
    notImplemented.push(`${def.method} ${def.path}`);
  }
  x.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: ERROR_COPY.NOT_FOUND.message } } satisfies ApiError);
  });
  x.use(errorHandler);

  const server = createServer(x);
  const ws = attachWebSockets(server, ctx);

  // Expired sign-in state is deleted on a schedule (@synan/db cleanupAuthState, every 10 minutes).
  const cleanupTimer = setInterval(() => {
    auth.cleanup().catch((e: unknown) => console.error("[auth] cleanup failed:", e instanceof Error ? e.message : String(e)));
  }, AUTH_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  return {
    ctx,
    express: x,
    server,
    seed,
    notImplemented,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const a = server.address() as AddressInfo;
          resolve(`http://${host}:${a.port}`);
        });
      });
    },
    async close() {
      clearInterval(cleanupTimer);
      telemetry.close();
      await ws.close();
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
      // Repositories passed in belong to the caller (e.g. a second app over the same database).
      if (ownsRepos) await repos.close?.();
    },
  };
}
