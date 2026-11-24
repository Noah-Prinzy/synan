/**
 * Talking to the stack from a test: the real API (as each role, through its own endpoints) and the
 * test-only control server (mail, seed, clock, jobs). Node `fetch`, no browser involved.
 */
import type { TokenPair } from "@synan/contracts/rest";
import { ORIGINS } from "../ports.ts";

export interface Seed {
  orgId: string;
  venueId: string;
  eventId: string;
  eventSlug: string;
  checkpoints: Record<"mainIn" | "mainOut" | "eastIn" | "auditorium" | "expo" | "vip" | "boardroom" | "press", string>;
  rooms: Record<"auditorium" | "expo" | "vip" | "boardroom" | "press", string>;
  password: string;
  emails: { admin: string; organiser: string; gate: string; gate2: string };
  adminMfaSecret: string;
}

export interface SentMail {
  seq: number;
  at: number;
  to: string;
  subject: string;
  text: string;
  tag: string;
}

export class ApiError extends Error {
  constructor(readonly method: string, readonly path: string, readonly status: number, readonly body: unknown) {
    super(`${method} ${path} → ${status} ${JSON.stringify(body)}`);
  }
  get code(): string | undefined {
    return (this.body as { error?: { code?: string } } | undefined)?.error?.code;
  }
}

/* ---------- control server ---------- */

async function control<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ORIGINS.control}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`control ${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

let seedCache: Seed | null = null;
export const ctl = {
  seed: async () => (seedCache ??= await control<Seed>("GET", "/seed")),
  /** A TOTP code at the server's clock (the seeded admin's secret unless another is given). */
  totp: async (secret?: string) => (await control<{ code: string }>("GET", `/totp${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`)).code,
  /** Every email the API has sent so far that matches (the outbox is drained first). */
  mail: async (q: { to?: string; tag?: string; after?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.to) p.set("to", q.to);
    if (q.tag) p.set("tag", q.tag);
    if (q.after) p.set("after", String(q.after));
    return (await control<{ items: SentMail[] }>("GET", `/mail?${p}`)).items;
  },
  clock: () => control<{ now: number; offset_ms: number }>("GET", "/clock"),
  setClockOffset: (offsetMs: number) => control<{ now: number; offset_ms: number }>("POST", "/clock", { offset_ms: offsetMs }),
  runJob: (name: string) => control<{ ran: string }>("POST", `/jobs/${name}`),
};

/** Wait for the newest matching email (polling the sink). */
export async function waitForMail(q: { to: string; tag?: string; after?: number }, timeoutMs = 10_000): Promise<SentMail> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const items = await ctl.mail(q);
    if (items.length) return items[items.length - 1]!;
    if (Date.now() > until) throw new Error(`no email to ${q.to}${q.tag ? ` tagged ${q.tag}` : ""} within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** The highest mail sequence number so far: pass as `after` to wait for a newer email only. */
export async function mailMark(): Promise<number> {
  const items = await ctl.mail();
  return items.at(-1)?.seq ?? 0;
}

export const linkIn = (mail: SentMail): string => {
  const m = /https?:\/\/\S+/.exec(mail.text);
  if (!m) throw new Error(`no link in email "${mail.subject}": ${mail.text}`);
  return m[0];
};

/* ---------- the API ---------- */

export interface Caller {
  token: string;
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Same, but resolves with status and body instead of throwing on an error status. */
  raw<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

export async function apiRaw<T = unknown>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${ORIGINS.api}/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

export async function api<T = unknown>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
  const r = await apiRaw<T>(method, path, opts);
  if (r.status >= 400) throw new ApiError(method, path, r.status, r.body);
  return r.body;
}

export function caller(token: string): Caller {
  return {
    token,
    call: (method, path, body) => api(method, path, { token, body }),
    raw: (method, path, body) => apiRaw(method, path, { token, body }),
  };
}

/** Operator or staff sign-in by password (POST /auth/login). */
export async function loginAs(email: string, password?: string): Promise<Caller> {
  const pw = password ?? (await ctl.seed()).password;
  const pair = await api<TokenPair>("POST", "/auth/login", { body: { email, password: pw } });
  return caller(pair.access_token);
}

let adminCache: { caller: Caller; until: number } | null = null;
/**
 * The seeded admin, stepped up with a TOTP code (needed by every `mfa: true` endpoint). Cached per
 * test process well inside the access token's 10 minutes and the step-up's 15.
 */
export async function adminApi(): Promise<Caller> {
  if (adminCache && adminCache.until > Date.now()) return adminCache.caller;
  const seed = await ctl.seed();
  const plain = await loginAs(seed.emails.admin);
  const pair = await api<TokenPair>("POST", "/auth/mfa/verify", { token: plain.token, body: { code: await ctl.totp() } });
  adminCache = { caller: caller(pair.access_token), until: Date.now() + 7 * 60_000 };
  return adminCache.caller;
}

/** An attendee's API session through the emailed sign-in link (POST /auth/email-link, then /auth/verify). */
export async function attendeeApi(email: string): Promise<Caller> {
  const mark = await mailMark();
  await api("POST", "/auth/email-link", { body: { email } });
  const mail = await waitForMail({ to: email, tag: "auth.link", after: mark });
  const token = new URL(linkIn(mail)).hash.replace(/^#/, "").split("&").map((kv) => kv.split("=")).find(([k]) => k === "token")?.[1];
  if (!token) throw new Error(`no token in ${linkIn(mail)}`);
  const pair = await api<TokenPair>("POST", "/auth/verify", { body: { token: decodeURIComponent(token) } });
  return caller(pair.access_token);
}

export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Presented = { medium: "qr"; data: string } | { medium: "nfc"; uid: string };
export interface ScanOutcome {
  idem_key: string;
  scan_id: string;
  result: string;
  tier: string | null;
  room_id: string | null;
  alert_ids: string[];
}

/** One online scan through POST /scans, as the gate's own staff member (a second, API-only device). */
export async function scanAt(gate: { id: string; staff: { email: string; password: string } }, eventId: string, presented: Presented): Promise<ScanOutcome> {
  const pair = await api<TokenPair>("POST", "/auth/login", { body: { email: gate.staff.email, password: gate.staff.password } });
  const { now } = await ctl.clock();
  const idem = `e2e-${uniq("scan")}`;
  const r = await api<{ results: ScanOutcome[]; rejected?: unknown[] }>("POST", "/scans", {
    token: pair.access_token,
    body: { event_id: eventId, device_id: `e2e-api-${gate.id.slice(0, 8)}`, scans: [{ idem_key: idem, checkpoint_id: gate.id, presented, occurred_at: new Date(now).toISOString(), clock_offset_ms: 0, offline: false }] },
  });
  if (!r.results[0]) throw new Error(`scan rejected: ${JSON.stringify(r.rejected)}`);
  return r.results[0];
}
