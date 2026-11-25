/**
 * Desk codes (attendee self-binding of a band, 06 A5), staff activation invites, pending MFA
 * enrolment, and attendee search.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { hashToken, newToken } from "./auth";
import { bindCarrier } from "./carriers";
import type { AnyDb } from "./client";
import { setVaultScope } from "./client";
import type { Cipher } from "./crypto/index";
import { credentials } from "./schema/credentials";
import { registrations } from "./schema/entitlement";
import { user_invites } from "./schema/auth2";
import { users } from "./schema/people";
import { attendees } from "./schema/vault";
import { decryptAttendeeRow, type AttendeeIdentity } from "./secrets";
import { date, rows, tsOrNow, type DbOrTx } from "./sqlrows";

const arr = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::text[]`;
const DESK = "desk_code";

/* ----------------------------------------------------------------- desk codes */

/** Unambiguous alphabet (no 0/O, 1/I/L): 31^6 ≈ 8.9 × 10^8 codes. */
const DESK_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newDeskCode(): string {
  return Array.from({ length: 6 }, () => DESK_ALPHABET[randomInt(DESK_ALPHABET.length)]).join("");
}
const normaliseCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/** A desk code for a stock band, valid `ttlMinutes` (default 10). The code is returned to show to the attendee. */
export async function createDeskCode(
  db: DbOrTx,
  cipher: Cipher,
  i: { carrierIdentifier: string; createdBy?: string | null; ttlMinutes?: number; now?: Date },
): Promise<{ status: "created" | "unknown_carrier" | "not_in_stock"; code: string | null; expires_at: Date | null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newDeskCode();
    const x = (
      await rows(
        db,
        sql`select * from public.desk_code_create(${cipher.keyedDigest(DESK, code)}, ${i.carrierIdentifier}, ${i.createdBy ?? null}::uuid,
              make_interval(mins => ${i.ttlMinutes ?? 10}), ${tsOrNow(i.now)})`,
      )
    )[0]!;
    if (x.status === "collision") continue;
    return { status: x.status as "created" | "unknown_carrier" | "not_in_stock", code: x.status === "created" ? code : null, expires_at: date(x.expires_at) };
  }
  throw new Error("could not allocate a unique desk code");
}

export type DeskCodeStatus = "consumed" | "too_many_attempts" | "invalid" | "expired" | "already_used";

/** Consumes a desk code exactly once; failed attempts count against the attendee (default 5 per 10 minutes). */
export async function consumeDeskCode(
  db: DbOrTx,
  cipher: Cipher,
  i: { code: string; attendeeId: string; maxFailures?: number; windowMinutes?: number; now?: Date },
): Promise<{ status: DeskCodeStatus; carrier_identifier: string | null }> {
  const x = (
    await rows(
      db,
      sql`select * from public.desk_code_consume(${arr(cipher.keyedDigestCandidates(DESK, normaliseCode(i.code)))}, ${i.attendeeId}::uuid,
            ${i.maxFailures ?? 5}::integer, make_interval(mins => ${i.windowMinutes ?? 10}), ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return { status: x.status as DeskCodeStatus, carrier_identifier: (x.carrier_identifier as string | null) ?? null };
}

/**
 * The self-binding flow in one transaction: consumes the code and binds its band to the attendee's
 * credential. If the binding fails the code is not spent; a wrong code is still counted.
 */
export async function bindBandWithDeskCode(
  db: AnyDb,
  cipher: Cipher,
  i: { code: string; attendeeId: string; credentialId: string; maxFailures?: number; now?: Date },
): Promise<{ status: DeskCodeStatus | "not_your_credential" | "bind_failed"; bind_status: string | null; carrier_id: string | null }> {
  class Undo extends Error {
    constructor(readonly result: { status: "not_your_credential" | "bind_failed"; bind_status: string | null }) {
      super("undo");
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const own = await tx
        .select({ id: credentials.id })
        .from(credentials)
        .innerJoin(registrations, eq(registrations.id, credentials.registration_id))
        .where(and(eq(credentials.id, i.credentialId), eq(registrations.attendee_id, i.attendeeId)))
        .limit(1);
      if (!own[0]) throw new Undo({ status: "not_your_credential", bind_status: null });
      const c = await consumeDeskCode(tx, cipher, i);
      if (c.status !== "consumed") return { status: c.status, bind_status: null, carrier_id: null };
      const b = await bindCarrier(tx, { identifier: c.carrier_identifier!, credentialId: i.credentialId, now: i.now });
      if (b.status !== "bound") throw new Undo({ status: "bind_failed", bind_status: b.status });
      return { status: "consumed" as const, bind_status: b.status, carrier_id: b.carrier_id };
    });
  } catch (e) {
    if (e instanceof Undo) return { ...e.result, carrier_id: null };
    throw e;
  }
}

/* -------------------------------------------------------------- staff invites */

/** A single-use activation token for a staff user (default 72 h); revokes their older open invites. */
export async function createUserInvite(
  db: DbOrTx,
  i: { userId: string; createdBy?: string | null; ttlHours?: number; now?: Date },
): Promise<{ status: "created" | "unknown_user"; token: string | null; expires_at: Date | null; revoked: number }> {
  const token = newToken();
  const now = i.now ?? new Date();
  const expires = new Date(now.getTime() + (i.ttlHours ?? 72) * 3600_000);
  const x = (
    await rows(
      db,
      sql`select * from public.user_invite_create(${hashToken(token)}, ${i.userId}::uuid, ${expires.toISOString()}::timestamptz,
            ${i.createdBy ?? null}::uuid, ${now.toISOString()}::timestamptz)`,
    )
  )[0]!;
  const created = x.status === "created";
  return { status: x.status as "created" | "unknown_user", token: created ? token : null, expires_at: created ? expires : null, revoked: Number(x.revoked) };
}

/**
 * Reads an activation token's state without consuming it (the activation screen, before a password
 * is chosen): the status `consumeUserInvite` would answer, with `valid` for one it would consume.
 */
export async function peekUserInvite(
  db: DbOrTx,
  token: string,
  now?: Date,
): Promise<{ status: "valid" | "invalid" | "expired" | "already_used" | "revoked"; user_id: string | null; expires_at: Date | null }> {
  const at = now ?? new Date();
  const r = (await db.select().from(user_invites).where(eq(user_invites.token_hash, hashToken(token))).limit(1))[0];
  if (!r) return { status: "invalid", user_id: null, expires_at: null };
  const status = r.used_at ? "already_used" : r.revoked_at ? "revoked" : r.expires_at.getTime() <= at.getTime() ? "expired" : "valid";
  return { status, user_id: r.user_id, expires_at: r.expires_at };
}

/** Consumes an activation token exactly once. */
export async function consumeUserInvite(
  db: DbOrTx,
  token: string,
  now?: Date,
): Promise<{ status: "consumed" | "invalid" | "expired" | "already_used" | "revoked"; user_id: string | null }> {
  const x = (await rows(db, sql`select * from public.user_invite_consume(${hashToken(token)}, ${tsOrNow(now)})`))[0]!;
  return { status: x.status as "consumed" | "invalid" | "expired" | "already_used" | "revoked", user_id: (x.user_id as string | null) ?? null };
}

/* ---------------------------------------------------------- MFA enrolment */

const pendingCtx = (id: string) => ({ table: "users", column: "mfa_pending_secret_enc", rowId: id });
const activeCtx = (id: string) => ({ table: "users", column: "mfa_secret_enc", rowId: id });

/** Starts (or restarts) an MFA enrolment: stores the new secret encrypted as pending for `ttlMinutes` (default 10). */
export async function startMfaEnrolment(db: DbOrTx, cipher: Cipher, userId: string, secret: string, opts: { ttlMinutes?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  await db
    .update(users)
    .set({ mfa_pending_secret_enc: cipher.encrypt(secret, pendingCtx(userId)), mfa_pending_expires_at: new Date(now.getTime() + (opts.ttlMinutes ?? 10) * 60_000) })
    .where(eq(users.id, userId));
}

/** The pending secret while it is still valid (to verify the first code), else null. */
export async function readPendingMfaSecret(db: DbOrTx, cipher: Cipher, userId: string, now?: Date): Promise<string | null> {
  const r = await db
    .select({ s: users.mfa_pending_secret_enc })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.mfa_pending_secret_enc), gt(users.mfa_pending_expires_at, now ?? new Date())))
    .limit(1);
  return r[0]?.s ? cipher.decrypt(r[0].s, pendingCtx(userId)) : null;
}

/**
 * Confirms the enrolment after the first code was verified: the pending secret becomes the active
 * one (re-encrypted for its own column) in a single compare-and-swap. False if expired or replaced.
 */
export async function confirmMfaEnrolment(db: DbOrTx, cipher: Cipher, userId: string, now?: Date): Promise<boolean> {
  const at = now ?? new Date();
  const r = await db
    .select({ s: users.mfa_pending_secret_enc })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.mfa_pending_secret_enc), gt(users.mfa_pending_expires_at, at)))
    .limit(1);
  if (!r[0]?.s) return false;
  const secret = cipher.decrypt(r[0].s, pendingCtx(userId));
  const done = await db
    .update(users)
    .set({ mfa_secret_enc: cipher.encrypt(secret, activeCtx(userId)), mfa_enrolled_at: at, mfa_pending_secret_enc: null, mfa_pending_expires_at: null })
    .where(and(eq(users.id, userId), eq(users.mfa_pending_secret_enc, r[0].s)))
    .returning({ id: users.id });
  return done.length === 1;
}

/** Abandons a pending enrolment. */
export async function cancelMfaEnrolment(db: DbOrTx, userId: string): Promise<void> {
  await db.update(users).set({ mfa_pending_secret_enc: null, mfa_pending_expires_at: null }).where(eq(users.id, userId));
}

/* ------------------------------------------------------------------ search */

/** Attendee ids with exactly this email (normalised; any blind-index key). No identity is read. */
export async function findAttendeeIdsByEmail(db: DbOrTx, cipher: Cipher, email: string): Promise<string[]> {
  const r = await rows<{ id: string }>(db, sql`select id::text from pii_vault.attendee_ids_by_email_hash(${arr(cipher.blindIndexCandidates(email))}) as id`);
  return r.map((x) => x.id);
}

/**
 * Case-insensitive substring search over decrypted name and email, on the vault connection, in
 * batches; stops at `limit`. Pass `attendeeIds` (e.g. one event's registrations) to bound the work.
 * Nothing searchable is stored: the cost is decrypting the candidates (≈10,000 per few tens of ms).
 */
export async function searchAttendeesDecrypted(
  vault: AnyDb,
  cipher: Cipher,
  i: { q: string; attendeeIds?: readonly string[]; limit?: number; batch?: number },
): Promise<AttendeeIdentity[]> {
  const needle = i.q.normalize("NFKC").trim().toLowerCase();
  const limit = i.limit ?? 50;
  const batch = i.batch ?? 1000;
  const out: AttendeeIdentity[] = [];
  if (!needle) return out;
  const matches = (a: AttendeeIdentity) =>
    (a.email ?? "").toLowerCase().includes(needle) || (a.full_name ?? "").normalize("NFKC").toLowerCase().includes(needle);
  if (i.attendeeIds) {
    for (let k = 0; k < i.attendeeIds.length && out.length < limit; k += batch) {
      const ids = i.attendeeIds.slice(k, k + batch);
      const found = await vault.transaction(async (tx) => {
        await setVaultScope(tx, "operator");
        return tx.select().from(attendees).where(inArray(attendees.id, [...ids]));
      });
      for (const row of found) {
        const a = decryptAttendeeRow(cipher, row);
        if (matches(a)) out.push(a);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = await vault.transaction(async (tx) => {
      await setVaultScope(tx, "operator");
      return tx.select().from(attendees).where(sql`${attendees.id} > ${after}::uuid`).orderBy(asc(attendees.id)).limit(batch);
    });
    for (const row of page) {
      const a = decryptAttendeeRow(cipher, row);
      if (matches(a)) out.push(a);
      if (out.length >= limit) return out;
    }
    if (page.length < batch) return out;
    after = page.at(-1)!.id;
  }
}
