/**
 * Sign-in state: typed wrappers over the atomic SQL functions in migration 0004.
 * Hash tokens with `hashToken()` (base64url SHA-256) before calling; plaintext tokens never reach
 * the database. Every function accepts `now` so a controllable clock works; it defaults to the
 * database clock.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AnyDb, AnyTx } from "./client";
import { auth_links, ws_tickets } from "./schema/auth";

type Db = AnyDb | AnyTx;

async function rows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}
const ts = (d: Date | undefined) => (d ? sql`${d.toISOString()}::timestamptz` : sql`now()`);
const toDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

/** A new high-entropy token (base64url, 32 bytes by default). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
/** base64url SHA-256, 43 characters: the stored form of every sign-in token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export type RevokeReason = "logout" | "reuse_detected" | "mfa_step_up" | "operator" | "credential_change" | "erasure";
export type Holder = { userId: string; attendeeId?: never } | { attendeeId: string; userId?: never };

export interface SessionContext {
  /** Truncated to 200 characters by the database. */
  userAgent?: string | null;
  /** Full client IP; the database keeps only /24 (IPv4) or /48 (IPv6). */
  ip?: string | null;
}

/* ------------------------------------------------------------------- sessions */

export interface StartSessionInput extends SessionContext {
  holder: Holder;
  /** New family id (a login, email-link sign-in, or MFA step-up starts a new family). */
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  mfaAt?: Date | null;
  now?: Date;
}

export async function startSession(db: Db, i: StartSessionInput): Promise<{ id: string; family_id: string }> {
  const r = await rows<{ id: string; family_id: string }>(
    db,
    sql`select id::text, family_id::text from public.auth_start_session(
          ${i.familyId}::uuid, ${i.holder.userId ?? null}::uuid, ${i.holder.attendeeId ?? null}::uuid, ${i.tokenHash},
          ${i.expiresAt.toISOString()}::timestamptz, ${i.mfaAt ? i.mfaAt.toISOString() : null}::timestamptz,
          ${i.userAgent ?? null}, ${i.ip ?? null}::inet, ${ts(i.now)})`,
  );
  return r[0]!;
}

export type RotateStatus = "rotated" | "invalid" | "revoked" | "expired" | "reuse_detected";
export interface RotateResult {
  status: RotateStatus;
  /** The new row when rotated; otherwise the presented row (null when invalid). */
  session_id: string | null;
  family_id: string | null;
  user_id: string | null;
  attendee_id: string | null;
  mfa_at: Date | null;
  expires_at: Date | null;
}

/** New refresh lifetime by holder kind, chosen inside the database (operators/staff vs attendees). */
export interface RefreshTtl {
  userSeconds: number;
  attendeeSeconds: number;
}

/**
 * Exchanges a refresh token. Give either a fixed `expiresAt` or `ttl` (the lifetime is then picked
 * by the holder kind of the presented token, in the same locked step — no lookup first).
 * On `reuse_detected` the whole family has already been revoked (committed with your
 * transaction — do not roll it back).
 */
export async function rotateSession(
  db: Db,
  i: SessionContext & { tokenHash: string; newTokenHash: string; now?: Date } & (
      | { expiresAt: Date; ttl?: never }
      | { ttl: RefreshTtl; expiresAt?: never }
    ),
): Promise<RotateResult> {
  const r = await rows<Record<string, unknown>>(
    db,
    i.ttl
      ? sql`select * from public.auth_rotate_session_by_kind(${i.tokenHash}, ${i.newTokenHash},
          make_interval(secs => ${i.ttl.userSeconds}), make_interval(secs => ${i.ttl.attendeeSeconds}),
          ${i.userAgent ?? null}, ${i.ip ?? null}::inet, ${ts(i.now)})`
      : sql`select * from public.auth_rotate_session(${i.tokenHash}, ${i.newTokenHash}, ${i.expiresAt!.toISOString()}::timestamptz,
          ${i.userAgent ?? null}, ${i.ip ?? null}::inet, ${ts(i.now)})`,
  );
  const x = r[0]!;
  return {
    status: x.status as RotateStatus,
    session_id: (x.session_id as string | null) ?? null,
    family_id: (x.family_id as string | null) ?? null,
    user_id: (x.user_id as string | null) ?? null,
    attendee_id: (x.attendee_id as string | null) ?? null,
    mfa_at: toDate(x.mfa_at),
    expires_at: toDate(x.expires_at),
  };
}

export async function revokeFamily(db: Db, familyId: string, reason: RevokeReason, now?: Date): Promise<number> {
  const r = await rows<{ n: number }>(db, sql`select public.auth_revoke_family(${familyId}::uuid, ${reason}::auth_revoke_reason, ${ts(now)}) as n`);
  return Number(r[0]!.n);
}

export async function revokeHolderSessions(db: Db, holder: Holder, reason: RevokeReason, now?: Date): Promise<number> {
  const r = await rows<{ n: number }>(
    db,
    sql`select public.auth_revoke_holder(${holder.userId ?? null}::uuid, ${holder.attendeeId ?? null}::uuid, ${reason}::auth_revoke_reason, ${ts(now)}) as n`,
  );
  return Number(r[0]!.n);
}

/* ---------------------------------------------------------------------- links */

export interface CreateLinkInput {
  tokenHash: string;
  /** The attendee, when the address is known; otherwise give emailHash only (no account is created). */
  attendeeId?: string | null;
  /** Blind index of the address (secrets.emailBlindIndex). */
  emailHash?: string | null;
  purpose?: "sign_in" | "verify_email";
  expiresAt: Date;
  now?: Date;
}

export async function createLink(db: Db, i: CreateLinkInput): Promise<string> {
  const r = await db
    .insert(auth_links)
    .values({
      token_hash: i.tokenHash,
      attendee_id: i.attendeeId ?? null,
      email_hash: i.emailHash ?? null,
      purpose: i.purpose ?? "sign_in",
      expires_at: i.expiresAt,
      ...(i.now ? { created_at: i.now } : {}),
    })
    .returning({ id: auth_links.id });
  return r[0]!.id;
}

export type RedeemStatus = "redeemed" | "invalid" | "already_redeemed" | "expired";
export interface RedeemResult {
  status: RedeemStatus;
  link_id: string | null;
  attendee_id: string | null;
  email_hash: string | null;
  purpose: "sign_in" | "verify_email" | null;
}

/** Redeems a link exactly once, even under concurrent requests. Only `redeemed` grants anything. */
export async function redeemLink(db: Db, tokenHash: string, now?: Date): Promise<RedeemResult> {
  const r = await rows<Record<string, unknown>>(db, sql`select * from public.auth_redeem_link(${tokenHash}, ${ts(now)})`);
  const x = r[0]!;
  return {
    status: x.status as RedeemStatus,
    link_id: (x.link_id as string | null) ?? null,
    attendee_id: (x.attendee_id as string | null) ?? null,
    email_hash: (x.email_hash as string | null) ?? null,
    purpose: (x.purpose as RedeemResult["purpose"]) ?? null,
  };
}

/* -------------------------------------------------------------------- tickets */

export type WsChannelPath = "/stream/scans" | "/stream/telemetry" | "/stream/alerts" | "/stream/me";

export interface MintTicketInput {
  ticketHash: string;
  holder: Holder;
  sessionFamilyId?: string | null;
  channel: WsChannelPath;
  eventId?: string | null;
  checkpointId?: string | null;
  /** At most 5 minutes after `now` (CHECK); the spec's ticket lives 30 seconds. */
  expiresAt: Date;
  now?: Date;
}

export async function mintWsTicket(db: Db, i: MintTicketInput): Promise<void> {
  await db.insert(ws_tickets).values({
    ticket_hash: i.ticketHash,
    user_id: i.holder.userId ?? null,
    attendee_id: i.holder.attendeeId ?? null,
    session_family_id: i.sessionFamilyId ?? null,
    channel: i.channel,
    event_id: i.eventId ?? null,
    checkpoint_id: i.checkpointId ?? null,
    expires_at: i.expiresAt,
    ...(i.now ? { created_at: i.now } : {}),
  });
}

export type ConsumeStatus = "valid" | "invalid" | "already_consumed" | "expired" | "revoked";
export interface ConsumeResult {
  status: ConsumeStatus;
  user_id: string | null;
  attendee_id: string | null;
  session_family_id: string | null;
  channel: WsChannelPath | null;
  event_id: string | null;
  checkpoint_id: string | null;
  expires_at: Date | null;
}

/** Consumes a ticket on first presentation, valid or not. Only `valid` admits the socket. */
export async function consumeWsTicket(db: Db, ticketHash: string, now?: Date): Promise<ConsumeResult> {
  const r = await rows<Record<string, unknown>>(db, sql`select * from public.ws_consume_ticket(${ticketHash}, ${ts(now)})`);
  const x = r[0]!;
  return {
    status: x.status as ConsumeStatus,
    user_id: (x.user_id as string | null) ?? null,
    attendee_id: (x.attendee_id as string | null) ?? null,
    session_family_id: (x.session_family_id as string | null) ?? null,
    channel: (x.channel as WsChannelPath | null) ?? null,
    event_id: (x.event_id as string | null) ?? null,
    checkpoint_id: (x.checkpoint_id as string | null) ?? null,
    expires_at: toDate(x.expires_at),
  };
}

/* -------------------------------------------------------------------- cleanup */

/**
 * Deletes expired sign-in state; run on a schedule (e.g. pg-boss every 10 minutes). Loops until a
 * pass deletes fewer than `batch` rows of every kind.
 */
export async function cleanupAuthState(
  db: Db,
  opts: { now?: Date; keep?: string; batch?: number } = {},
): Promise<{ sessions: number; links: number; tickets: number; desk_codes: number; desk_code_failures: number; user_invites: number }> {
  const total = { sessions: 0, links: 0, tickets: 0, desk_codes: 0, desk_code_failures: 0, user_invites: 0 };
  const batch = opts.batch ?? 10_000;
  for (;;) {
    const r = await rows<{ sessions: number; links: number; tickets: number }>(
      db,
      sql`select * from public.auth_cleanup(${ts(opts.now)}, ${opts.keep ?? "30 days"}::interval, ${batch})`,
    );
    const x = r[0]!;
    const s = Number(x.sessions);
    const l = Number(x.links);
    const t = Number(x.tickets);
    total.sessions += s;
    total.links += l;
    total.tickets += t;
    const y = (
      await rows<{ desk_codes: number; desk_code_failures: number; user_invites: number }>(
        db,
        sql`select * from public.short_code_cleanup(${ts(opts.now)}, ${opts.keep ?? "30 days"}::interval, ${batch})`,
      )
    )[0]!;
    total.desk_codes += Number(y.desk_codes);
    total.desk_code_failures += Number(y.desk_code_failures);
    total.user_invites += Number(y.user_invites);
    if (s < batch && l < batch && t < batch && Number(y.desk_codes) < batch && Number(y.desk_code_failures) < batch && Number(y.user_invites) < batch) return total;
  }
}
