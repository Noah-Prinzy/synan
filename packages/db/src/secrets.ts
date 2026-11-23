/**
 * The only supported way to write and read encrypted columns:
 *   pii_vault.attendees.email, .full_name, .profile_jsonb (+ email_hash blind index)
 *   users.mfa_secret_enc
 *   signing_keys.private_key_enc
 *
 * Identity helpers set the vault scope themselves. Reads need a vault-capable connection
 * (`databases.vault`); creating an attendee also works on the general connection (write-only).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb, AnyTx } from "./client";
import { setVaultScope, withVaultScope, type VaultScope } from "./client";
import type { Cipher, FieldContext } from "./crypto/index";
import { attendees } from "./schema/vault";
import { users } from "./schema/people";
import { signing_keys } from "./schema/credentials";

type Db = AnyDb | AnyTx;
const ENC = "$enc";

const ctx = (table: string, column: string, rowId: string): FieldContext => ({ table, column, rowId });

/* ------------------------------------------------------------------ attendees */

export interface AttendeeIdentityInput {
  id?: string;
  user_id?: string | null;
  email?: string | null;
  full_name?: string | null;
  profile?: Record<string, unknown>;
}

export interface AttendeeIdentity {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  profile: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  erased_at: Date | null;
}

/** Encrypted column values for one attendee row (pure; used by the helpers and by bulk seeding). */
export function encryptAttendeeColumns(cipher: Cipher, id: string, input: Omit<AttendeeIdentityInput, "id" | "user_id">) {
  const out: { email?: string | null; email_hash?: string | null; full_name?: string | null; profile_jsonb?: Record<string, unknown> } = {};
  if (input.email !== undefined) {
    out.email = input.email === null ? null : cipher.encrypt(input.email, ctx("pii_vault.attendees", "email", id));
    out.email_hash = input.email === null ? null : cipher.blindIndex(input.email);
  }
  if (input.full_name !== undefined) {
    out.full_name = input.full_name === null ? null : cipher.encrypt(input.full_name, ctx("pii_vault.attendees", "full_name", id));
  }
  if (input.profile !== undefined) {
    out.profile_jsonb =
      Object.keys(input.profile).length === 0
        ? {}
        : { [ENC]: cipher.encrypt(JSON.stringify(input.profile), ctx("pii_vault.attendees", "profile_jsonb", id)) };
  }
  return out;
}

/** Decrypts a raw attendees row. Legacy plaintext is returned as-is while the cipher allows it. */
export function decryptAttendeeRow(cipher: Cipher, row: typeof attendees.$inferSelect): AttendeeIdentity {
  const p = (row.profile_jsonb ?? {}) as Record<string, unknown>;
  let profile: Record<string, unknown>;
  if (typeof p[ENC] === "string") {
    profile = JSON.parse(cipher.decrypt(p[ENC] as string, ctx("pii_vault.attendees", "profile_jsonb", row.id))) as Record<string, unknown>;
  } else {
    if (Object.keys(p).length > 0 && !cipher.allowLegacyPlaintext) {
      cipher.decrypt("<plaintext profile>", ctx("pii_vault.attendees", "profile_jsonb", row.id)); // throws plaintext_rejected
    }
    profile = p;
  }
  return {
    id: row.id,
    user_id: row.user_id,
    email: row.email === null ? null : cipher.decrypt(row.email, ctx("pii_vault.attendees", "email", row.id)),
    full_name: row.full_name === null ? null : cipher.decrypt(row.full_name, ctx("pii_vault.attendees", "full_name", row.id)),
    profile,
    created_at: row.created_at,
    updated_at: row.updated_at,
    erased_at: row.erased_at,
  };
}

/**
 * Creates an attendee with encrypted identity and the email blind index. Returns the id.
 * Works on the general connection too: the general role may INSERT attendees but never read them.
 * Pass a transaction to make it atomic with the registration that follows.
 */
export async function createAttendee(db: Db, cipher: Cipher, input: AttendeeIdentityInput): Promise<string> {
  const id = input.id ?? randomUUID();
  const values = {
    id,
    user_id: input.user_id ?? null,
    ...encryptAttendeeColumns(cipher, id, { email: input.email ?? null, full_name: input.full_name ?? null, profile: input.profile ?? {} }),
  };
  const run = async (tx: Db) => {
    await setVaultScope(tx, "system");
    await tx.insert(attendees).values(values); // no RETURNING: the general role has no SELECT
  };
  if ("rollback" in db) await run(db);
  else await db.transaction(run);
  return id;
}

/** Updates identity fields (vault connection). Fields left undefined are unchanged. */
export async function updateAttendeeIdentity(
  vault: AnyDb,
  cipher: Cipher,
  id: string,
  patch: Omit<AttendeeIdentityInput, "id">,
  scope: Extract<VaultScope, "system" | "operator" | "attendee"> = "operator",
): Promise<boolean> {
  const set = { ...encryptAttendeeColumns(cipher, id, patch), ...(patch.user_id !== undefined ? { user_id: patch.user_id } : {}) };
  if (Object.keys(set).length === 0) return true;
  const rows = await withVaultScope(
    vault,
    scope,
    (tx) => tx.update(attendees).set(set).where(eq(attendees.id, id)).returning({ id: attendees.id }),
    scope === "attendee" ? { attendeeId: id } : {},
  );
  return rows.length === 1;
}

/** Reads and decrypts one attendee (vault connection). `attendee` scope reads only that attendee. */
export async function readAttendee(
  vault: AnyDb,
  cipher: Cipher,
  id: string,
  scope: Extract<VaultScope, "system" | "operator" | "attendee"> = "operator",
): Promise<AttendeeIdentity | null> {
  const rows = await withVaultScope(vault, scope, (tx) => tx.select().from(attendees).where(eq(attendees.id, id)).limit(1), scope === "attendee" ? { attendeeId: id } : {});
  return rows[0] ? decryptAttendeeRow(cipher, rows[0]) : null;
}

/** Reads and decrypts several attendees (vault connection, operator scope). */
export async function readAttendees(vault: AnyDb, cipher: Cipher, ids: readonly string[]): Promise<AttendeeIdentity[]> {
  if (ids.length === 0) return [];
  const rows = await withVaultScope(vault, "operator", (tx) => tx.select().from(attendees).where(inArray(attendees.id, [...ids])));
  return rows.map((r) => decryptAttendeeRow(cipher, r));
}

/**
 * Finds an attendee by email through the blind index, trying every configured blind-index key so
 * lookups keep working during a blind-index rotation (vault connection, system scope).
 */
export async function findAttendeeByEmail(vault: AnyDb, cipher: Cipher, email: string): Promise<AttendeeIdentity | null> {
  const rows = await withVaultScope(vault, "system", (tx) =>
    tx.select().from(attendees).where(inArray(attendees.email_hash, cipher.blindIndexCandidates(email))).limit(1),
  );
  return rows[0] ? decryptAttendeeRow(cipher, rows[0]) : null;
}

/** Blind index for columns that store only the hash (invitations.email_hash, auth_links.email_hash). */
export function emailBlindIndex(cipher: Cipher, email: string): string {
  return cipher.blindIndex(email);
}

/* ------------------------------------------------------------------ operator email */

export type NewUserInput = Omit<typeof users.$inferInsert, "email" | "email_hash"> & { email: string };

/** Encrypted users.email and its blind index ("user" domain) for one row. */
export function encryptUserEmail(cipher: Cipher, userId: string, email: string): { email: string; email_hash: string } {
  return { email: cipher.encrypt(email, ctx("users", "email", userId)), email_hash: cipher.blindIndex(email, "user") };
}

/** Inserts an operator or staff user with the address encrypted and blind-indexed. Returns the id. */
export async function insertUser(db: Db, cipher: Cipher, u: NewUserInput): Promise<string> {
  const id = u.id ?? randomUUID();
  await db.insert(users).values({ ...u, id, ...encryptUserEmail(cipher, id, u.email) });
  return id;
}

export async function setUserEmail(db: Db, cipher: Cipher, userId: string, email: string): Promise<void> {
  await db.update(users).set(encryptUserEmail(cipher, userId, email)).where(eq(users.id, userId));
}

/** A users row with `email` decrypted. */
export function decryptUserRow(cipher: Cipher, row: typeof users.$inferSelect): typeof users.$inferSelect {
  return { ...row, email: cipher.decrypt(row.email, ctx("users", "email", row.id)) };
}

/** Sign-in lookup by blind index, trying every configured key (case-insensitive by normalisation). */
export async function findUserByEmail(db: Db, cipher: Cipher, email: string): Promise<typeof users.$inferSelect | null> {
  const rows = await db.select().from(users).where(inArray(users.email_hash, cipher.blindIndexCandidates(email, "user"))).limit(1);
  return rows[0] ? decryptUserRow(cipher, rows[0]) : null;
}

export async function readUserEmail(db: Db, cipher: Cipher, userId: string): Promise<string | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ? decryptUserRow(cipher, rows[0]).email : null;
}

/* ------------------------------------------------------------------ MFA secret */

/** Stores (or clears, with null) a user's MFA secret, encrypted and bound to the user row. */
export async function setMfaSecret(db: Db, cipher: Cipher, userId: string, secret: string | null, enrolledAt: Date | null): Promise<void> {
  await db
    .update(users)
    .set({
      mfa_secret_enc: secret === null ? null : cipher.encrypt(secret, ctx("users", "mfa_secret_enc", userId)),
      mfa_enrolled_at: enrolledAt,
    })
    .where(eq(users.id, userId));
}

export function encryptMfaSecret(cipher: Cipher, userId: string, secret: string): string {
  return cipher.encrypt(secret, ctx("users", "mfa_secret_enc", userId));
}

export async function readMfaSecret(db: Db, cipher: Cipher, userId: string): Promise<string | null> {
  const rows = await db.select({ s: users.mfa_secret_enc }).from(users).where(eq(users.id, userId)).limit(1);
  const s = rows[0]?.s;
  return s == null ? null : cipher.decrypt(s, ctx("users", "mfa_secret_enc", userId));
}

/* ------------------------------------------------------------- signing keys */

export interface NewSigningKeyInput {
  id?: string;
  purpose: "qr" | "allowlist";
  algorithm?: string;
  qr_kid?: string | null;
  /** Public JWK (JSON text). */
  public_key: string;
  /** Private JWK (JSON text). Encrypted before it reaches the database. */
  private_key: string;
  active_from?: Date;
  retired_at?: Date | null;
}

export function encryptSigningPrivateKey(cipher: Cipher, keyId: string, privateKey: string): string {
  return cipher.encrypt(privateKey, ctx("signing_keys", "private_key_enc", keyId));
}

/** Inserts a signing key with its private half encrypted. Returns the id. */
export async function insertSigningKey(db: Db, cipher: Cipher, k: NewSigningKeyInput): Promise<string> {
  const id = k.id ?? randomUUID();
  await db.insert(signing_keys).values({
    id,
    purpose: k.purpose,
    algorithm: k.algorithm ?? "EdDSA",
    qr_kid: k.qr_kid ?? null,
    public_key: k.public_key,
    private_key_enc: encryptSigningPrivateKey(cipher, id, k.private_key),
    ...(k.active_from ? { active_from: k.active_from } : {}),
    retired_at: k.retired_at ?? null,
  });
  return id;
}

export async function readSigningPrivateKey(db: Db, cipher: Cipher, keyId: string): Promise<string | null> {
  const rows = await db.select({ p: signing_keys.private_key_enc }).from(signing_keys).where(eq(signing_keys.id, keyId)).limit(1);
  return rows[0] ? cipher.decrypt(rows[0].p, ctx("signing_keys", "private_key_enc", keyId)) : null;
}

/* ------------------------------------------------------- rotation / re-encryption */

interface Target {
  name: string;
  table: string;
  column: string;
  jsonb: boolean;
  vault: boolean;
  /** users.email: also (re)write email_hash in the same statement. */
  userEmail?: boolean;
}
const TARGETS: Target[] = [
  { name: "attendees.email", table: "pii_vault.attendees", column: "email", jsonb: false, vault: true },
  { name: "attendees.full_name", table: "pii_vault.attendees", column: "full_name", jsonb: false, vault: true },
  { name: "attendees.profile_jsonb", table: "pii_vault.attendees", column: "profile_jsonb", jsonb: true, vault: true },
  { name: "users.email", table: "users", column: "email", jsonb: false, vault: false, userEmail: true },
  { name: "users.mfa_secret_enc", table: "users", column: "mfa_secret_enc", jsonb: false, vault: false },
  { name: "users.mfa_pending_secret_enc", table: "users", column: "mfa_pending_secret_enc", jsonb: false, vault: false },
  { name: "signing_keys.private_key_enc", table: "signing_keys", column: "private_key_enc", jsonb: false, vault: false },
  { name: "webhook_endpoints.secret", table: "webhook_endpoints", column: "secret", jsonb: false, vault: false },
  { name: "report_schedules.recipients_enc", table: "report_schedules", column: "recipients_enc", jsonb: false, vault: false },
  { name: "email_outbox.to_enc", table: "email_outbox", column: "to_enc", jsonb: false, vault: false },
  { name: "email_outbox.content_enc", table: "email_outbox", column: "content_enc", jsonb: false, vault: false },
];

export interface ReencryptProgress {
  target: string;
  /** Rows rewritten in this batch. */
  updated: number;
  /** Rows changed concurrently by the application during this batch and left for a later run. */
  raced: number;
  lastId: string;
}

export interface ReencryptOptions {
  /** General connection (users, signing_keys). */
  db: AnyDb;
  /** Vault connection (attendees). Defaults to `db` for single-role deployments. */
  vault?: AnyDb;
  cipher: Cipher;
  batchSize?: number;
  /** Re-encrypt users.email (and rewrite users.email_hash). Default true; enforced since migration 0009. */
  includeUserEmail?: boolean;
  /** Called after each committed batch. Throwing stops the run; committed batches stay done. */
  onBatch?: (p: ReencryptProgress) => void | Promise<void>;
}

/**
 * Rewrites every encrypted column so it is encrypted under the cipher's active data key. Also
 * encrypts legacy plaintext found in those columns (this is how existing plaintext is migrated).
 *
 * - Resumable: each batch commits on its own and finished rows no longer match, so re-running after
 *   an interruption continues where it stopped.
 * - Safe while live: each row is written with compare-and-swap (`WHERE col = old`), so a concurrent
 *   application write is never overwritten; such rows are counted as `raced` and picked up next run.
 */
export async function reencryptSecrets(opts: ReencryptOptions): Promise<Record<string, { updated: number; raced: number }>> {
  const batch = opts.batchSize ?? 200;
  const { cipher } = opts;
  const prefix = `ev1.${cipher.activeDataKeyId}.`;
  const summary: Record<string, { updated: number; raced: number }> = {};

  for (const t of TARGETS) {
    if (t.userEmail && opts.includeUserEmail === false) continue;
    const conn = t.vault ? (opts.vault ?? opts.db) : opts.db;
    const col = sql.identifier(t.column);
    const table = sql.raw(t.table.split(".").map((p) => `"${p}"`).join("."));
    const needsWork = t.jsonb
      ? sql`${col} <> '{}'::jsonb AND (NOT jsonb_exists(${col}, '$enc') OR left(${col} ->> '$enc', ${prefix.length}) <> ${prefix})`
      : sql`${col} IS NOT NULL AND left(${col}, ${prefix.length}) <> ${prefix}`;
    summary[t.name] = { updated: 0, raced: 0 };
    let after = "00000000-0000-0000-0000-000000000000";

    for (;;) {
      const progress = await conn.transaction(async (tx) => {
        if (t.vault) await setVaultScope(tx, "system");
        const res = (await tx.execute(
          sql`select id::text as id, ${col} as v from ${table} where id > ${after}::uuid and ${needsWork} order by id limit ${batch}`,
        )) as unknown as { rows: { id: string; v: unknown }[] };
        let updated = 0;
        let raced = 0;
        for (const r of res.rows) {
          const where = ctx(t.table, t.column, r.id);
          let next: string | Record<string, unknown>;
          let oldParam: string;
          if (t.jsonb) {
            const v = (typeof r.v === "string" ? JSON.parse(r.v) : r.v) as Record<string, unknown>;
            const plain = typeof v[ENC] === "string" ? cipher.decrypt(v[ENC] as string, where) : JSON.stringify(v);
            next = { [ENC]: cipher.encrypt(plain, where) };
            oldParam = JSON.stringify(v);
          } else {
            const v = String(r.v);
            const plain = cipher.isEnvelope(v) ? cipher.decrypt(v, where) : v; // non-envelope = legacy plaintext to encrypt
            next = cipher.encrypt(plain, where);
            oldParam = v;
          }
          const upd = (await tx.execute(
            t.jsonb
              ? sql`update ${table} set ${col} = ${JSON.stringify(next)}::jsonb where id = ${r.id}::uuid and ${col} = ${oldParam}::jsonb`
              : t.userEmail
                ? sql`update ${table} set ${col} = ${next as string}, email_hash = ${cipher.blindIndex(cipher.decrypt(next as string, where), "user")}
                       where id = ${r.id}::uuid and ${col} = ${oldParam}`
                : sql`update ${table} set ${col} = ${next as string} where id = ${r.id}::uuid and ${col} = ${oldParam}`,
          )) as unknown as { rowCount?: number | null; affectedRows?: number };
          const n = upd.rowCount ?? upd.affectedRows ?? 0;
          if (n === 1) updated++;
          else raced++;
        }
        return { target: t.name, updated, raced, lastId: res.rows.at(-1)?.id ?? after, done: res.rows.length < batch };
      });
      summary[t.name]!.updated += progress.updated;
      summary[t.name]!.raced += progress.raced;
      after = progress.lastId;
      await opts.onBatch?.({ target: progress.target, updated: progress.updated, raced: progress.raced, lastId: progress.lastId });
      if (progress.done) break;
    }
  }
  return summary;
}

/**
 * Recomputes attendees.email_hash under the active blind-index key (after adding a new one).
 * Decrypts every email — the cost of rotating the blind index. Resumable via `after` (the last id
 * processed is returned). invitations.email_hash and auth_links.email_hash cannot be recomputed
 * (no email is stored there); lookups keep matching them through blindIndexCandidates() until they
 * expire, after which the old blind-index key can be removed.
 */
export async function reindexEmailBlindIndex(opts: {
  vault: AnyDb;
  /** General connection: when given, users.email_hash is re-indexed too (all rows, in one pass). */
  db?: AnyDb;
  cipher: Cipher;
  batchSize?: number;
  after?: string;
}): Promise<{ updated: number; scanned: number; lastId: string; usersUpdated: number }> {
  let usersUpdated = 0;
  if (opts.db) {
    const all = await opts.db.select({ id: users.id, email: users.email, email_hash: users.email_hash }).from(users);
    for (const u of all) {
      const want = opts.cipher.blindIndex(opts.cipher.decrypt(u.email, ctx("users", "email", u.id)), "user");
      if (want !== u.email_hash) {
        const res = await opts.db.update(users).set({ email_hash: want }).where(and(eq(users.id, u.id), eq(users.email, u.email))).returning({ id: users.id });
        usersUpdated += res.length;
      }
    }
  }
  const batch = opts.batchSize ?? 200;
  let after = opts.after ?? "00000000-0000-0000-0000-000000000000";
  let updated = 0;
  let scanned = 0;
  for (;;) {
    const n = await opts.vault.transaction(async (tx) => {
      await setVaultScope(tx, "system");
      const rows = await tx
        .select({ id: attendees.id, email: attendees.email, email_hash: attendees.email_hash })
        .from(attendees)
        .where(and(sql`${attendees.id} > ${after}::uuid`, sql`${attendees.email} IS NOT NULL`))
        .orderBy(attendees.id)
        .limit(batch);
      for (const r of rows) {
        const want = opts.cipher.blindIndex(opts.cipher.decrypt(r.email!, ctx("pii_vault.attendees", "email", r.id)));
        if (want !== r.email_hash) {
          const res = await tx
            .update(attendees)
            .set({ email_hash: want })
            .where(and(eq(attendees.id, r.id), eq(attendees.email, r.email!)))
            .returning({ id: attendees.id });
          updated += res.length;
        }
      }
      scanned += rows.length;
      if (rows.length) after = rows.at(-1)!.id;
      return rows.length;
    });
    if (n < batch) break;
  }
  return { updated, scanned, lastId: after, usersUpdated };
}
