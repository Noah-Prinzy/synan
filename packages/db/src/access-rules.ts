/**
 * The tier × room access matrix (docs/01 §4, 02 §4.2). `access_rules` is the only authority; no
 * derived bitmask is stored. A caller that caches permissions keys its cache by
 * (event_id, access_rules_version) and drops it when the version changes.
 */
import { asc, eq, sql } from "drizzle-orm";
import { access_rules } from "./schema/entitlement";
import { events } from "./schema/venue";
import { date, num, rows, tsOrNow, type DbOrTx } from "./sqlrows";

export interface AccessRuleInput {
  subject_kind: "tier" | "role";
  /** A tier (VIP, ORDINARY, PRIVATE_INVITE, PUBLIC) or a role (admin, organiser, security_staff, speaker, crew). */
  subject: string;
  room_id: string;
  window_start?: Date | string | null;
  window_end?: Date | string | null;
  effect: "permit" | "deny";
}

export interface AccessRuleSet {
  version: number;
  rules: (typeof access_rules.$inferSelect)[];
}

const toJson = (rules: readonly AccessRuleInput[]) =>
  JSON.stringify(
    rules.map((r) => ({
      subject_kind: r.subject_kind,
      subject: r.subject,
      room_id: r.room_id,
      window_start: r.window_start ? new Date(r.window_start).toISOString() : null,
      window_end: r.window_end ? new Date(r.window_end).toISOString() : null,
      effect: r.effect,
    })),
  );

/** The current rules and their version (GET /events/:id/access-rules). */
export async function readAccessRules(db: DbOrTx, eventId: string): Promise<AccessRuleSet> {
  const ev = await db.select({ v: events.access_rules_version }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev[0]) throw new Error(`event ${eventId} does not exist`);
  const rules = await db
    .select()
    .from(access_rules)
    .where(eq(access_rules.event_id, eventId))
    .orderBy(asc(access_rules.room_id), asc(access_rules.subject_kind), asc(access_rules.subject));
  return { version: ev[0].v, rules };
}

export interface ReplaceRulesResult {
  status: "ok" | "version_conflict";
  /** The new version when ok; the current version on conflict. */
  version: number;
  added: number;
  removed: number;
  /** The audit entry written (ok only). */
  audit_id: number | null;
}

/**
 * Replaces the whole rule set atomically if `expectedVersion` is current (PUT /events/:id/access-rules).
 * Bumps the version (and the revocation epoch), snapshots both versions for diffing, and writes the
 * audit entry. Invalid rules throw (the constraint name says which rule is wrong).
 */
export async function replaceAccessRules(
  db: DbOrTx,
  eventId: string,
  expectedVersion: number,
  rules: readonly AccessRuleInput[],
  opts: { actorId?: string | null; now?: Date } = {},
): Promise<ReplaceRulesResult> {
  const x = (
    await rows(
      db,
      sql`select * from public.access_rules_replace(${eventId}::uuid, ${expectedVersion}::integer, ${toJson(rules)}::jsonb,
            ${opts.actorId ?? null}::uuid, ${tsOrNow(opts.now)})`,
    )
  )[0]!;
  return {
    status: x.status as ReplaceRulesResult["status"],
    version: num(x.version),
    added: num(x.added),
    removed: num(x.removed),
    audit_id: x.audit_id == null ? null : num(x.audit_id),
  };
}

export interface RuleChange {
  change: "added" | "removed";
  subject_kind: "tier" | "role";
  subject: string;
  room_id: string;
  window_start: Date | null;
  window_end: Date | null;
  effect: "permit" | "deny";
}
const toChange = (x: Record<string, unknown>): RuleChange => ({
  change: x.change as RuleChange["change"],
  subject_kind: x.subject_kind as RuleChange["subject_kind"],
  subject: String(x.subject),
  room_id: String(x.room_id),
  window_start: date(x.window_start),
  window_end: date(x.window_end),
  effect: x.effect as RuleChange["effect"],
});

/** Differences between two published versions (`toVersion` omitted = the current rules). */
export async function diffAccessRuleVersions(db: DbOrTx, eventId: string, fromVersion: number, toVersion?: number): Promise<RuleChange[]> {
  return (
    await rows(db, sql`select * from public.access_rules_diff(${eventId}::uuid, ${fromVersion}::integer, ${toVersion ?? null}::integer)`)
  ).map(toChange);
}

/** What republishing `proposed` would change — the diff shown before "republish rules". */
export async function diffProposedAccessRules(db: DbOrTx, eventId: string, proposed: readonly AccessRuleInput[]): Promise<RuleChange[]> {
  return (await rows(db, sql`select * from public.access_rules_diff_proposed(${eventId}::uuid, ${toJson(proposed)}::jsonb)`)).map(toChange);
}

/** May this tier or role enter this room at this time? A permit must cover the time; a deny wins. */
export async function accessPermits(
  db: DbOrTx,
  eventId: string,
  subject: { kind: "tier" | "role"; value: string },
  roomId: string,
  at?: Date,
): Promise<boolean> {
  const r = await rows<{ ok: boolean }>(
    db,
    sql`select public.access_permits(${eventId}::uuid, ${subject.kind}, ${subject.value}, ${roomId}::uuid, ${tsOrNow(at)}) as ok`,
  );
  return Boolean(r[0]!.ok);
}

export type MayEnterReason = "ok" | "not_permitted" | "room_not_in_event" | "not_in_event" | "credential_not_usable" | "unknown_credential";
export interface MayEnterResult {
  allowed: boolean;
  reason: MayEnterReason;
  subject_kind: "tier" | "role" | null;
  subject: string | null;
}
/** Resolves a credential's tier or role and checks the rules (entitlement only; not capacity or passback). */
export async function credentialMayEnter(db: DbOrTx, eventId: string, credentialId: string, roomId: string, at?: Date): Promise<MayEnterResult> {
  const x = (
    await rows(db, sql`select * from public.credential_may_enter(${eventId}::uuid, ${credentialId}::uuid, ${roomId}::uuid, ${tsOrNow(at)})`)
  )[0]!;
  return {
    allowed: Boolean(x.allowed),
    reason: x.reason as MayEnterReason,
    subject_kind: (x.subject_kind as MayEnterResult["subject_kind"]) ?? null,
    subject: (x.subject as string | null) ?? null,
  };
}
