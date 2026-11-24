import { randomBytes, randomUUID } from "node:crypto";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { ApiError } from "@synan/contracts/errors";
import type { Presented, ScanSubmission, TokenPair } from "@synan/contracts/rest";
import { createApp, type CreateAppOptions, type RunningApp } from "../src/app.js";
import { devEmail } from "../src/brand.js";
import { ManualClock } from "../src/lib/clock.js";
import { totp } from "../src/lib/crypto.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import type { SeedResult } from "../src/seed.js";

export { devEmail };

/** `REPO=pglite` runs the whole suite against PostgreSQL (PGlite) through the Drizzle repositories. */
export const REPO_UNDER_TEST: "memory" | "pglite" =
  process.env.REPO === "pglite" || (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "pglite" ? "pglite" : "memory";

export interface Harness {
  app: RunningApp;
  base: string;
  clock: ManualClock;
  mailer: MemoryMailer;
  seed: SeedResult;
  /**
   * One request. Afterwards the email queue is drained (deterministically, no sleeping) so tests can
   * read `mailer` at once; harnesses started with `autoDrainMail: false` drain only via `drainMail`.
   */
  call<T = unknown>(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T; headers: Headers }>;
  /** Wait for off-path work, then send every due outbox email through the transport now. */
  drainMail(): Promise<void>;
  login(email: string): Promise<TokenPair>;
  /** Access token of the security-staff user assigned to this checkpoint. */
  gateToken(checkpointId: string): Promise<string>;
  close(): Promise<void>;
}

export async function startHarness(opts: CreateAppOptions & { autoDrainMail?: boolean } = {}): Promise<Harness> {
  const clock = new ManualClock(Date.now());
  const mailer = new MemoryMailer();
  const { autoDrainMail = true, ...appOpts } = opts;
  const app = await createApp({
    clock,
    mailer,
    seed: true,
    ...appOpts,
    config: {
      repo: REPO_UNDER_TEST,
      rateLimits: { authPerMin: 10_000, scanPerMin: 100_000, resendPerHour: 10_000 },
      ...appOpts.config,
    },
  });
  const base = await app.listen(0, "127.0.0.1");
  // Idle sockets outlive the gaps a busy test machine leaves between requests (no ECONNRESET on reuse).
  app.server.keepAliveTimeout = 120_000;
  const seed = app.seed!;
  const drainMail = async () => void (await app.ctx.mail.drain());

  const call: Harness["call"] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers,
      body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body),
    });
    const text = await res.text();
    if (autoDrainMail) await drainMail();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers } as never;
  };

  const login = async (email: string) => {
    const r = await call<TokenPair>("POST", "/auth/login", { body: { email, password: seed.password } });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  // Tokens live 10 min on the (manual) clock; cache per checkpoint and re-login when near expiry.
  const cache = new Map<string, TokenPair>();
  const gateToken = async (checkpointId: string) => {
    const hit = cache.get(checkpointId);
    if (hit && Date.parse(hit.access_expires_at) - clock.now() > 60_000) return hit.access_token;
    const email = seed.gateEmailByCheckpoint[checkpointId];
    if (!email) throw new Error(`no gate user for checkpoint ${checkpointId}`);
    const t = await login(email);
    cache.set(checkpointId, t);
    return t.access_token;
  };

  return { app, base, clock, mailer, seed, call, drainMail, login, gateToken, close: () => app.close() };
}

export const errCode = (body: unknown) => (body as ApiError).error.code;

export function mfaCode(h: Harness) {
  return totp(h.seed.adminMfaSecret, h.clock.now());
}

let idem = 0;
export function scan(
  h: Harness,
  checkpointId: string,
  presented: Presented,
  over: Partial<ScanSubmission> = {},
): ScanSubmission {
  return {
    idem_key: `t${Date.now().toString(36)}${(idem++).toString(36)}${randomBytes(6).toString("hex")}`,
    checkpoint_id: checkpointId,
    presented,
    occurred_at: new Date(h.clock.now()).toISOString(),
    clock_offset_ms: 0,
    offline: false,
    ...over,
  };
}

export const band = (uid: string): Presented => ({ medium: "nfc", uid });
export const qr = (data: string): Presented => ({ medium: "qr", data });

/** POST /scans as the gate user of the first scan's checkpoint (or `token`). */
export async function postScans<T = unknown>(h: Harness, scans: ScanSubmission[], o: { token?: string; deviceId?: string; eventId?: string } = {}) {
  const token = o.token ?? (await h.gateToken(scans[0]!.checkpoint_id));
  return h.call<T>("POST", "/scans", { token, body: { event_id: o.eventId ?? h.seed.eventId, device_id: o.deviceId ?? "scanner-1", scans } });
}

/** Add an attendee with a confirmed registration, a credential and a bound band. */
export async function addAttendee(h: Harness, tier: AttendeeTier, eventId = h.seed.eventId) {
  const id = randomUUID();
  await h.app.ctx.repos.attendees.insert({ id, user_id: null, email: devEmail(`t-${id}`), full_name: "Test", profile_jsonb: {} });
  const registrationId = randomUUID();
  await h.app.ctx.repos.fixtures.registration({
    id: registrationId, event_id: eventId, attendee_id: id, tier, state: "confirmed",
    zone_presence_consent_at: new Date(h.clock.now()), checked_in_at: null, created_at: new Date(h.clock.now()),
  });
  const cred = await h.app.ctx.credentials.issueForRegistration(registrationId);
  const uid = randomBytes(7).toString("hex").toUpperCase();
  await h.app.ctx.repos.carriers.insert({
    id: randomUUID(), credential_id: cred.id, kind: "nfc", identifier: nfcIdentifier(uid), identifier_hint: uid.slice(-4),
    chip_profile: "ntag_uid", state: "bound", bound_at: new Date(h.clock.now()), redeemed_at: null,
  });
  return { id, registrationId, credentialId: cred.id, uid };
}
