/**
 * The end-to-end stack, in one process so one kill stops all of it:
 *
 * 1. ONE API on the in-memory backend with the dev seed (apps/api `createApp`, exactly as main.ts
 *    starts it, but with a recording mail transport, a clock the tests may move forward, and rate
 *    limits raised for a single test machine making every request from 127.0.0.1).
 * 2. The three apps built in real-API mode (VITE_API_URL = the API above) and served with
 *    `vite preview`.
 * 3. A test-only control server on its own port: what the API "emailed", the seed, the server
 *    clock, and running a background job now. It is not part of the product: it exists only in
 *    this file, listens on 127.0.0.1 only, and refuses to start under NODE_ENV=production.
 *
 * Playwright starts this as its `webServer` and stops it after the run, also on failure.
 * Run it by hand with `corepack pnpm --filter @synan/e2e stack` to keep it up between runs.
 * E2E_SKIP_BUILD=1 reuses the last builds in e2e/.stack (when nothing in the apps changed).
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";
import { createApp } from "../../apps/api/src/app.ts";
import { totp } from "../../apps/api/src/lib/crypto.ts";
import type { Clock } from "../../apps/api/src/lib/clock.ts";
import type { Mailer, MailMessage } from "../../apps/api/src/lib/mailer.ts";
import { HOST, ORIGINS, PORTS } from "../ports.ts";

if (process.env.NODE_ENV === "production") {
  console.error("[e2e] the end-to-end stack and its control server refuse to run with NODE_ENV=production");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const stackDir = path.resolve(here, "../.stack");
const t0 = Date.now();
const log = (msg: string) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

/** Real time plus an offset the tests may move forward (export retention) and back to zero. */
class OffsetClock implements Clock {
  offsetMs = 0;
  now() {
    return Date.now() + this.offsetMs;
  }
}

export interface SentMail extends MailMessage {
  seq: number;
  /** Server time when the transport was called. */
  at: number;
}

/** The dev mail transport, recording instead of printing, so tests can read links and codes. */
class RecordingMailer implements Mailer {
  readonly sent: SentMail[] = [];
  private seq = 0;
  constructor(private readonly clock: Clock) {}
  async send(msg: MailMessage) {
    this.sent.push({ ...msg, seq: ++this.seq, at: this.clock.now() });
  }
}

const clock = new OffsetClock();
const mailer = new RecordingMailer(clock);
const reportDir = path.join(stackDir, "reports");
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

const app = await createApp({
  clock,
  mailer,
  seed: true,
  config: {
    repo: "memory",
    port: PORTS.api,
    host: HOST,
    allowedOrigins: [ORIGINS.attendee, ORIGINS.admin, ORIGINS.scanner],
    attendeeAppOrigin: ORIGINS.attendee,
    // Staff invitations open the role's own app (activation links): the builds below.
    adminAppUrl: `${ORIGINS.admin}/admin`,
    scannerAppUrl: `${ORIGINS.scanner}/scan`,
    publicApiOrigin: ORIGINS.api,
    reportStorageDir: reportDir,
    mailTransport: "memory",
    seed: "dev",
    // One machine makes every request from 127.0.0.1: the per-address limits would refuse a full run.
    rateLimits: { authPerMin: 100_000, scanPerMin: 1_000_000, resendPerHour: 100_000 },
    publicReadsPerMin: 100_000,
    selfResendPerHour: 100,
  },
});
await app.listen(PORTS.api, HOST);
app.server.keepAliveTimeout = 120_000;
const seed = app.seed!;
log(`API on ${ORIGINS.api} (repo=${app.ctx.repos.kind}, seed: live event "${seed.eventSlug}")`);

/* ---------- the three apps, real-API mode ---------- */

const APPS = [
  { name: "attendee", port: PORTS.attendee },
  { name: "admin", port: PORTS.admin },
  { name: "scanner", port: PORTS.scanner },
] as const;

process.env.VITE_API_URL = ORIGINS.api;
// The apps hand an activation link to one another (and old /staff/activate links to the console).
process.env.VITE_ADMIN_URL = `${ORIGINS.admin}/admin`;
process.env.VITE_SCANNER_URL = `${ORIGINS.scanner}/scan`;
const previews: PreviewServer[] = [];
for (const a of APPS) {
  const root = path.join(repoRoot, "apps", a.name);
  const configFile = path.join(root, "vite.config.ts");
  const outDir = path.join(stackDir, "apps", a.name);
  if (process.env.E2E_SKIP_BUILD === "1" && existsSync(path.join(outDir, "index.html"))) {
    log(`${a.name}: reusing the build in ${path.relative(repoRoot, outDir)}`);
  } else {
    const started = Date.now();
    await build({ root, configFile, mode: "production", logLevel: "warn", build: { outDir, emptyOutDir: true } });
    log(`${a.name}: built in real-API mode in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const server = await preview({
    root,
    configFile,
    logLevel: "warn",
    build: { outDir },
    preview: { port: a.port, host: HOST, strictPort: true, open: false },
  });
  previews.push(server);
  log(`${a.name} on ${ORIGINS[a.name]}`);
}

/* ---------- the control server (test only) ---------- */

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  const text = Buffer.concat(parts).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
};

/** Steps already handed out, per secret. The API accepts the steps before, at and after now. */
const lastStep = new Map<string, number>();
let totpQueue: Promise<unknown> = Promise.resolve();
const nextTotp = (secret: string) => {
  const run = async () => {
    for (;;) {
      const cur = Math.floor(clock.now() / 30_000);
      const step = Math.max(cur, (lastStep.get(secret) ?? -Infinity) + 1);
      if (step <= cur + 1) {
        lastStep.set(secret, step);
        // Good for 30 to 60 seconds: the API accepts the step before now, now, and the next one.
        return { code: totp(secret, step * 30_000), step };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const p = totpQueue.then(run, run);
  totpQueue = p;
  return p;
};

const control = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", ORIGINS.control);
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /health") return json(res, 200, { ok: true, api: ORIGINS.api });
    if (route === "GET /seed") return json(res, 200, seed);
    if (route === "GET /totp") {
      // A code for the seeded admin (or any secret the test enrolled), at the server's clock. The API
      // refuses a code from a time step already used, so every caller (API helpers and the browser
      // alike) gets its code here: each one from a step not handed out before, waiting when needed.
      const secret = url.searchParams.get("secret") ?? seed.adminMfaSecret;
      return json(res, 200, await nextTotp(secret));
    }
    if (route === "GET /mail") {
      // Drain the outbox first: what was queued is sent now, deterministically.
      await app.ctx.mail.drain();
      const to = url.searchParams.get("to")?.toLowerCase();
      const tag = url.searchParams.get("tag");
      const after = Number(url.searchParams.get("after") ?? 0);
      return json(res, 200, { items: mailer.sent.filter((m) => (!to || m.to.toLowerCase() === to) && (!tag || m.tag === tag) && m.seq > after) });
    }
    if (route === "GET /clock") return json(res, 200, { now: clock.now(), offset_ms: clock.offsetMs });
    if (route === "POST /clock") {
      const body = await readBody(req);
      const offset = Number(body.offset_ms);
      if (!Number.isFinite(offset) || offset < 0) return json(res, 400, { error: "offset_ms must be a number >= 0" });
      clock.offsetMs = offset;
      return json(res, 200, { now: clock.now(), offset_ms: clock.offsetMs });
    }
    const job = /^POST \/jobs\/([a-z_.]+)$/.exec(route);
    if (job) {
      await app.ctx.jobs.runNow(job[1]!);
      return json(res, 200, { ran: job[1] });
    }
    return json(res, 404, { error: `no control route ${route}` });
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});
await new Promise<void>((resolve) => control.listen(PORTS.control, HOST, resolve));
log(`control server on ${ORIGINS.control}: the stack is ready`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  log("stopping");
  control.close();
  await Promise.allSettled(previews.map((p) => p.close()));
  await app.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
