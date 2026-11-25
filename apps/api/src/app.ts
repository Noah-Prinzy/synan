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
import { CredentialStates } from "./domain/credential-state.js";
import { KeyService } from "./domain/keys.js";
import { QrService } from "./domain/qr.js";
import { ScanService } from "./domain/scan-service.js";
import { WebhookService, type HostResolver, type WebhookTransport } from "./domain/webhooks.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { ReportExporter } from "./domain/report-export.js";
import { ReportScheduler } from "./domain/report-schedules.js";
import { MailService } from "./domain/mail.js";
import { NotificationService } from "./domain/notifications.js";
import { GateService } from "./domain/gates.js";
import { ScannerTrust } from "./domain/scanner-trust.js";
import { EncryptedStorage, LocalDiskStorage, type ObjectStorage } from "./lib/storage.js";
import { InProcessJobs, type Jobs } from "./lib/jobs.js";
import { PgBossJobs } from "./lib/pgboss-jobs.js";
import { registerJobs } from "./jobs.js";
import { reportRoutes } from "./routes/reports.js";
import { meRoutes } from "./routes/me.js";
import { attendeeSelfRoutes } from "./routes/attendee-self.js";
import { RateLimiter } from "./http/rate-limit.js";
import { mountNotImplemented } from "./http/route.js";
import { systemClock, type Clock } from "./lib/clock.js";
import { ConsoleMailer, MemoryMailer, type Mailer } from "./lib/mailer.js";
import { attachWebSockets } from "./realtime/ws-server.js";
import { TelemetryHub } from "./realtime/telemetry-hub.js";
import { createCipher, createJobs, devKeyProvider, EnvKeyProvider, type Cipher } from "@synan/db";
import { createPgliteRepos, createPostgresRepos } from "./repo/drizzle.js";
import { createMemoryRepos } from "./repo/memory.js";
import type { Repos } from "./repo/types.js";
import { authRoutes } from "./routes/auth.js";
import { credentialRoutes } from "./routes/credentials.js";
import { eventRoutes } from "./routes/events.js";
import { scanRoutes } from "./routes/scans.js";
import { layoutRoutes } from "./routes/layout.js";
import { eventAdminRoutes } from "./routes/event-admin.js";
import { registrationRoutes } from "./routes/registration.js";
import { carrierRoutes } from "./routes/carriers.js";
import { allowlistRoutes } from "./routes/allowlist.js";
import { staffRoutes } from "./routes/staff.js";
import { deviceRoutes } from "./routes/devices.js";
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
  webhooks: WebhookService;
  reportExports: ReportExporter;
  reportSchedules: ReportScheduler;
  /** Outbound email: every send goes through it. */
  mail: MailService;
  notifications: NotificationService;
  /** Gate health from the devices table (phones register as scanner devices). */
  gates: GateService;
  /** Refused scanner/device connections → deduplicated `rogue_scanner` alerts, audited (03 §8.2). */
  scannerTrust: ScannerTrust;
  reportStorage: EncryptedStorage;
  jobs: Jobs;
  /** Contract endpoints that have a real handler (filled by `mount`). */
  mounted: Set<EndpointDef>;
}

export interface CreateAppOptions {
  config?: Partial<Config>;
  clock?: Clock;
  repos?: Repos;
  mailer?: Mailer;
  /** Outbound webhook transport (tests inject a fake; default: fetch). */
  webhookTransport?: WebhookTransport;
  /** Host resolver for webhook URLs (tests inject one; default: DNS). */
  webhookResolver?: HostResolver;
  /** Report export storage (default: local disk under config.reportStorageDir). */
  storage?: ObjectStorage;
  /** Background job runner (default: in process). */
  jobs?: Jobs;
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

/**
 * A request path fit for a log line: the invitation token of the deprecated
 * `POST /invitations/:token/rsvp` is replaced, so a link's secret never reaches the logs.
 */
export const loggablePath = (path: string) => path.replace(/\/invitations\/[^/]+\/rsvp/, "/invitations/:token/rsvp");

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
    console.error(`[api] ${req.method} ${loggablePath(req.path)} failed`, err);
    status = 500;
    body = { error: { code: "INTERNAL", message: ERROR_COPY.INTERNAL.message, request_id: requestId } };
  }
  res.status(status).json(body);
}


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
  // pg-boss on PostgreSQL (D-17); in process for the memory and PGlite backends.
  const jobs = opts.jobs ?? (config.repo === "postgres" ? new PgBossJobs(createJobs({ connectionString: config.databaseUrl!, mode: "worker" })) : new InProcessJobs());
  // Every email goes through the outbox and the job queue; nothing sends inline.
  const mail = new MailService({ repos, jobs, clock, mailer, sendTimeoutMs: config.mailSendTimeoutMs });
  const auth = new AuthService(repos, config, mail, clock);
  await auth.init();
  const audit = new AuditService(repos.audit, clock);
  const alerts = new AlertService(repos.alerts, clock);
  const telemetry = new TelemetryHub(clock, { kAnon: config.kAnon });
  const notifications = new NotificationService({ repos, clock });
  // The one path that writes a credential's state and tells its holder (/stream/me, notifications).
  const credentialStates = new CredentialStates(repos, clock, notifications);
  const credentials = new CredentialService(repos, qr, audit, mail, config, clock, notifications, credentialStates);
  const scans = new ScanService(repos, qr, alerts, audit, telemetry, clock, { offlineSyncGraceMs: config.offlineSyncGraceS * 1000, checkpointScansPerMin: config.checkpointScansPerMin, offlineLateSyncMs: config.offlineLateSyncS * 1000, undoWindowMs: config.scanUndoWindowS * 1000 }, notifications, credentialStates);
  const rateLimiter = new RateLimiter(() => clock.now());
  const webhooks = new WebhookService(repos, clock, opts.webhookTransport, opts.webhookResolver);
  webhooks.attach(alerts);
  // Exports are encrypted at rest under the database package's data keys (dev keys in development).
  const cipher = await createAppCipher();
  const reportStorage = new EncryptedStorage(opts.storage ?? new LocalDiskStorage(config.reportStorageDir), cipher);
  const reportExports = new ReportExporter(repos, reportStorage, config, clock, cipher);

  const ctx: AppContext = {
    config, clock, repos, mailer, mail, notifications, scannerTrust: new ScannerTrust({ repos, alerts, audit, clock }), gates: new GateService({ repos, clock, alerts, audit, rateLimited: (cp, now) => scans.rateLimitedRecently(cp, now) }), keys, qr, auth, audit, alerts, credentials, scans, telemetry, rateLimiter, webhooks, reportExports, reportStorage, jobs,
    reportSchedules: null as unknown as ReportScheduler,
    mounted: new Set(),
  };
  reportExports.app = ctx;
  ctx.reportSchedules = new ReportScheduler(ctx);

  const seed = (opts.seed ?? config.seed === "dev") ? await seedDev(ctx) : null;

  const x = express();
  x.disable("x-powered-by");
  x.set("trust proxy", config.trustProxy);
  x.use((req, res, next) => {
    res.setHeader("X-Request-Id", randomBytes(8).toString("hex"));
    // Response hardening (03 §3). The API serves JSON and attachment downloads only, never a page, so
    // nothing it returns may run, load, or be framed: CSP `default-src 'none'` with frame-ancestors
    // (and X-Frame-Options for older browsers); no MIME sniffing; no Referer (signed download links
    // carry their signature in the query); nothing stored by browsers or shared caches.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    // HTTPS only, in production only: on a development http:// origin the header is ignored at best and,
    // on a shared hostname, would pin other local services to HTTPS. No `preload` (an owner decision).
    if (config.production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
  x.use(`${API_BASE_PATH}/carriers/import`, express.json({ limit: "1mb" })); // up to 10,000 identifiers
  x.use(`${API_BASE_PATH}/venues/:id/layout`, express.json({ limit: "1mb" })); // a whole layout: up to 500 zones, 2,000 rooms
  x.use(express.json({ limit: "64kb" }));

  authRoutes(x, ctx);
  eventRoutes(x, ctx);
  credentialRoutes(x, ctx);
  scanRoutes(x, ctx);
  layoutRoutes(x, ctx);
  eventAdminRoutes(x, ctx);
  registrationRoutes(x, ctx);
  carrierRoutes(x, ctx);
  allowlistRoutes(x, ctx);
  staffRoutes(x, ctx);
  deviceRoutes(x, ctx);
  reportRoutes(x, ctx);
  meRoutes(x, ctx);
  attendeeSelfRoutes(x, ctx);
  webhookRoutes(x, ctx);

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

  registerJobs(ctx);
  jobs.start();

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
      await mail.settle(); // off-path work (outbox writes) finishes before the database goes away
      await jobs.stop();
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
