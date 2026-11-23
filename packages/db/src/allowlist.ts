/**
 * The offline allowlist (docs/01 §8): everything a scanner needs to decide offline for one event
 * and shift window, with no identity. The caller signs the result (D-12).
 *
 * Shape: `subjects` maps "tier:VIP" / "role:crew" to the rooms that subject may enter and the
 * exact permitted windows inside the shift (permits minus denies); `entries` lists every credential
 * with its subject, effective state and live band hashes. `revocation_epoch` and
 * `access_rules_version` are read in the same snapshot as the rows.
 */
import { sql } from "drizzle-orm";
import type { AnyDb } from "./client";
import { date, num, rows } from "./sqlrows";

export interface AllowlistRoom {
  room_id: string;
  /** Permitted intervals [from, to) inside the requested window, ISO strings. */
  windows: [string, string][];
}

export interface AllowlistEntry {
  /** credentials.token_hash: the 22-character credential reference carried by signed QR codes. */
  credential_ref: string;
  subject_kind: "tier" | "role";
  /** Tier, or role for a staff credential. */
  subject: string;
  /** Credential state; `revoked` when the registration is no longer confirmed or the staff user is disabled. */
  effective_state: "issued" | "active" | "suspended_review" | "revoked" | "replaced";
  /** Hashes of live bands (assigned, bound, active). */
  nfc_hashes: string[];
  /** Hashes of lost or retired bands: a gate answers these as `revoked`, not `unknown_token`. */
  dead_nfc_hashes: string[];
  qr_email_spent: boolean;
  /** Rooms with any permitted window in the requested window (convenience; `subjects` has the windows). */
  permitted_room_ids: string[];
}

export interface Allowlist {
  event_id: string;
  revocation_epoch: number;
  access_rules_version: number;
  window: { from: string; to: string };
  generated_at: string;
  subjects: Record<string, AllowlistRoom[]>;
  entries: AllowlistEntry[];
}

/**
 * Builds the allowlist for an event and a shift window, optionally limited to the rooms behind the
 * given checkpoints. Runs in one REPEATABLE READ transaction so the epoch matches the rows.
 */
export async function buildAllowlist(
  db: AnyDb,
  eventId: string,
  q: { from: Date; to: Date; checkpointIds?: readonly string[] | null },
): Promise<Allowlist> {
  return db.transaction(
    async (tx) => {
      const ev = (
        await rows(tx, sql`select revocation_epoch, access_rules_version, now() as now from public.events where id = ${eventId}::uuid`)
      )[0];
      if (!ev) throw new Error(`event ${eventId} does not exist`);
      const cps = q.checkpointIds && q.checkpointIds.length ? sql`${`{${q.checkpointIds.join(",")}}`}::uuid[]` : sql`NULL::uuid[]`;
      const roomRows = await rows(
        tx,
        sql`select * from public.allowlist_rooms(${eventId}::uuid, ${q.from.toISOString()}::timestamptz, ${q.to.toISOString()}::timestamptz, ${cps})`,
      );
      const subjects: Record<string, AllowlistRoom[]> = {};
      for (const r of roomRows) {
        const key = `${r.subject_kind}:${r.subject}`;
        const windows = ((typeof r.windows === "string" ? JSON.parse(r.windows) : r.windows) as [unknown, unknown][]).map(
          ([a, b]) => [date(a)!.toISOString(), date(b)!.toISOString()] as [string, string],
        );
        (subjects[key] ??= []).push({ room_id: String(r.room_id), windows });
      }
      const credRows = await rows(tx, sql`select * from public.allowlist_credentials(${eventId}::uuid)`);
      const entries: AllowlistEntry[] = credRows.map((c) => {
        const key = `${c.subject_kind}:${c.subject}`;
        return {
          credential_ref: String(c.credential_ref),
          subject_kind: c.subject_kind as AllowlistEntry["subject_kind"],
          subject: String(c.subject),
          effective_state: c.effective_state as AllowlistEntry["effective_state"],
          nfc_hashes: (c.nfc_hashes as string[]) ?? [],
          dead_nfc_hashes: (c.dead_nfc_hashes as string[]) ?? [],
          qr_email_spent: Boolean(c.qr_email_spent),
          permitted_room_ids: (subjects[key] ?? []).map((x) => x.room_id),
        };
      });
      return {
        event_id: eventId,
        revocation_epoch: num(ev.revocation_epoch),
        access_rules_version: num(ev.access_rules_version),
        window: { from: q.from.toISOString(), to: q.to.toISOString() },
        generated_at: date(ev.now)!.toISOString(),
        subjects,
        entries,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** The current revocation epoch: compare with a cached allowlist to tell it is out of date. */
export async function revocationEpoch(db: AnyDb, eventId: string): Promise<number> {
  const r = await rows(db, sql`select revocation_epoch from public.events where id = ${eventId}::uuid`);
  if (!r[0]) throw new Error(`event ${eventId} does not exist`);
  return num(r[0].revocation_epoch);
}

/** One entry in the API contract's shape (AllowlistEntry). */
export interface AllowlistContractEntry {
  credential_hash: string;
  nfc_hashes: string[];
  /** Null for staff credentials (their access comes from their role). */
  tier: string | null;
  permitted_room_ids: string[];
  /** True for revoked or replaced credentials, cancelled registrations, disabled staff. */
  revoked: boolean;
  /** The finer state, so an offline gate can still answer `suspended` rather than `revoked`. */
  state: AllowlistEntry["effective_state"];
  /** Lost or retired bands of this credential: answer `revoked`, not `unknown_token`. */
  dead_nfc_hashes: string[];
  qr_email_spent: boolean;
}

/**
 * The allowlist in the contract's flat shape, for one checkpoint (null = every room of the event).
 * Window defaults to the event's start and end. Use buildAllowlist() for exact per-room windows.
 */
export async function allowlistEntries(
  db: AnyDb,
  eventId: string,
  checkpointId: string | null,
  opts: { from?: Date; to?: Date } = {},
): Promise<{ revocation_epoch: number; access_rules_version: number; entries: AllowlistContractEntry[] }> {
  let { from, to } = opts;
  if (!from || !to) {
    const ev = (await rows(db, sql`select starts_at, ends_at from public.events where id = ${eventId}::uuid`))[0];
    if (!ev) throw new Error(`event ${eventId} does not exist`);
    from ??= date(ev.starts_at)!;
    to ??= date(ev.ends_at)!;
  }
  const al = await buildAllowlist(db, eventId, { from, to, checkpointIds: checkpointId ? [checkpointId] : null });
  return {
    revocation_epoch: al.revocation_epoch,
    access_rules_version: al.access_rules_version,
    entries: al.entries.map((e) => ({
      credential_hash: e.credential_ref,
      nfc_hashes: e.nfc_hashes,
      tier: e.subject_kind === "tier" ? e.subject : null,
      permitted_room_ids: e.permitted_room_ids,
      revoked: e.effective_state === "revoked" || e.effective_state === "replaced",
      state: e.effective_state,
      dead_nfc_hashes: e.dead_nfc_hashes,
      qr_email_spent: e.qr_email_spent,
    })),
  };
}
