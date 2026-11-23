/**
 * Registration flows (docs/01 §4): invitations and single-use RSVP, self-service and operator
 * registration, kiosk (Public tier, anonymous), credential issue, tier and state changes, and the
 * attendee data-request queue (03 §5). All run on the general connection: identity is written
 * write-only through createAttendee(), and an existing person is found by blind index without
 * reading identity.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { hashToken, newToken } from "./auth";
import type { AnyDb } from "./client";
import { eraseAttendee } from "./functions";
import type { Cipher } from "./crypto/index";
import { bindCarrier } from "./carriers";
import { registrations } from "./schema/entitlement";
import { data_requests } from "./schema/operations2";
import { credentials } from "./schema/credentials";
import { createAttendee, readAttendee, type AttendeeIdentity } from "./secrets";
import { num, rows, tsOrNow, type DbOrTx, type Page } from "./sqlrows";

type Tier = "VIP" | "ORDINARY" | "PRIVATE_INVITE" | "PUBLIC";
type RegState = "pending_approval" | "confirmed" | "cancelled";

const arr = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::text[]`;

/** Existing attendee id for an email (any blind-index key), without reading identity. */
export async function findAttendeeIdByEmail(db: DbOrTx, cipher: Cipher, email: string): Promise<string | null> {
  const r = await rows<{ id: string | null }>(db, sql`select pii_vault.attendee_id_by_email_hash(${arr(cipher.blindIndexCandidates(email))}) as id`);
  return r[0]?.id ?? null;
}

/** Issues a credential (reference `ref`, 22 base64url) with a portal-QR carrier. */
export async function issueCredential(
  db: DbOrTx,
  i: { registrationId?: string | null; staffUserId?: string | null; ref: string; now?: Date },
): Promise<{ status: "issued" | "already_has_credential"; credential_id: string }> {
  const x = (
    await rows(db, sql`select * from public.credential_issue(${i.registrationId ?? null}::uuid, ${i.staffUserId ?? null}::uuid, ${i.ref}, ${tsOrNow(i.now)})`)
  )[0]!;
  return { status: x.status as "issued" | "already_has_credential", credential_id: String(x.credential_id) };
}

/* --------------------------------------------------------------- invitations */

/** Sends a Private Invitation: returns the plaintext token (for the email) only when one was created. */
export async function createInvitation(
  db: DbOrTx,
  cipher: Cipher,
  i: { eventId: string; email: string; expiresAt: Date; actorId?: string | null; now?: Date },
): Promise<{ status: "created" | "already_open"; invitation_id: string; token: string | null }> {
  const token = newToken();
  const x = (
    await rows(
      db,
      sql`select * from public.invitation_create(${i.eventId}::uuid, ${cipher.blindIndex(i.email)}, ${hashToken(token)},
            ${i.expiresAt.toISOString()}::timestamptz, ${i.actorId ?? null}::uuid, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  const status = x.status as "created" | "already_open";
  return { status, invitation_id: String(x.invitation_id), token: status === "created" ? token : null };
}

export type RsvpStatus = "registered" | "invalid" | "wrong_recipient" | "expired" | "already_redeemed" | "revoked" | "already_registered";

/**
 * RSVP to a Private Invitation, atomically: redeems the invitation (single use, only for the
 * address it was sent to), links or creates the attendee (identity encrypted, write-only),
 * registers them as PRIVATE_INVITE / confirmed, and issues the credential when `credentialRef` is
 * given. If they are already registered for the event nothing changes and the invitation stays open.
 */
export async function rsvpInvitation(
  db: AnyDb,
  cipher: Cipher,
  i: {
    token: string;
    email: string;
    fullName?: string | null;
    profile?: Record<string, unknown>;
    zonePresenceConsent: boolean;
    credentialRef?: string;
    now?: Date;
  },
): Promise<{ status: RsvpStatus; event_id: string | null; attendee_id: string | null; registration_id: string | null; credential_id: string | null }> {
  const none = { event_id: null, attendee_id: null, registration_id: null, credential_id: null };
  class AlreadyRegistered extends Error {}
  try {
    return await db.transaction(async (tx) => {
      const inv = (
        await rows(tx, sql`select * from public.invitation_redeem(${hashToken(i.token)}, ${arr(cipher.blindIndexCandidates(i.email))}, ${tsOrNow(i.now)})`)
      )[0]!;
      if (inv.status !== "redeemed") return { status: inv.status as RsvpStatus, ...none, event_id: (inv.event_id as string | null) ?? null };
      const eventId = String(inv.event_id);
      let attendeeId = await findAttendeeIdByEmail(tx, cipher, i.email);
      if (attendeeId) {
        const dup = await tx.select({ id: registrations.id }).from(registrations)
          .where(and(eq(registrations.event_id, eventId), eq(registrations.attendee_id, attendeeId))).limit(1);
        if (dup[0]) throw new AlreadyRegistered();
      } else {
        attendeeId = await createAttendee(tx, cipher, { email: i.email, full_name: i.fullName ?? null, profile: i.profile ?? {} });
      }
      const now = i.now ?? new Date();
      const [reg] = await tx
        .insert(registrations)
        .values({
          event_id: eventId, attendee_id: attendeeId, tier: "PRIVATE_INVITE", state: "confirmed",
          invitation_id: String(inv.invitation_id), zone_presence_consent_at: i.zonePresenceConsent ? now : null, created_at: now,
        })
        .returning({ id: registrations.id });
      const cred = i.credentialRef ? await issueCredential(tx, { registrationId: reg!.id, ref: i.credentialRef, now }) : null;
      return { status: "registered" as const, event_id: eventId, attendee_id: attendeeId, registration_id: reg!.id, credential_id: cred?.credential_id ?? null };
    });
  } catch (e) {
    if (e instanceof AlreadyRegistered) return { status: "already_registered", ...none };
    throw e;
  }
}

/** Marks outstanding invitations past expiry as expired (scheduled job). */
export async function expireInvitations(db: DbOrTx, now?: Date): Promise<number> {
  return num((await rows(db, sql`select public.invitations_expire(${tsOrNow(now)}) as n`))[0]!.n);
}

/* -------------------------------------------------------------- registrations */

/**
 * Registers a person for an event (self-service Ordinary, operator-added VIP, …). Reuses the
 * attendee with the same email when there is one. The tier comes from the path, never the client.
 * Status `already_registered` when they already have a registration for the event.
 */
export async function registerAttendee(
  db: AnyDb,
  cipher: Cipher,
  i: {
    eventId: string;
    tier: Exclude<Tier, "PUBLIC">;
    state: Exclude<RegState, "cancelled">;
    email: string;
    fullName?: string | null;
    profile?: Record<string, unknown>;
    zonePresenceConsent: boolean;
    credentialRef?: string;
    now?: Date;
  },
): Promise<{ status: "registered" | "already_registered"; attendee_id: string; registration_id: string; credential_id: string | null }> {
  return db.transaction(async (tx) => {
    const now = i.now ?? new Date();
    let attendeeId = await findAttendeeIdByEmail(tx, cipher, i.email);
    if (attendeeId) {
      const dup = await tx.select({ id: registrations.id }).from(registrations)
        .where(and(eq(registrations.event_id, i.eventId), eq(registrations.attendee_id, attendeeId))).limit(1);
      if (dup[0]) return { status: "already_registered" as const, attendee_id: attendeeId, registration_id: dup[0].id, credential_id: null };
    } else {
      attendeeId = await createAttendee(tx, cipher, { email: i.email, full_name: i.fullName ?? null, profile: i.profile ?? {} });
    }
    const [reg] = await tx
      .insert(registrations)
      .values({ event_id: i.eventId, attendee_id: attendeeId, tier: i.tier, state: i.state, zone_presence_consent_at: i.zonePresenceConsent ? now : null, created_at: now })
      .returning({ id: registrations.id });
    const cred = i.credentialRef && i.state === "confirmed" ? await issueCredential(tx, { registrationId: reg!.id, ref: i.credentialRef, now }) : null;
    return { status: "registered" as const, attendee_id: attendeeId, registration_id: reg!.id, credential_id: cred?.credential_id ?? null };
  });
}

/**
 * Kiosk / Public tier: an anonymous attendee (no personal data), a confirmed PUBLIC registration,
 * a credential, and optionally a reusable band bound on the spot. One transaction.
 */
export async function registerPublicAttendee(
  db: AnyDb,
  cipher: Cipher,
  i: { eventId: string; zonePresenceConsent: boolean; credentialRef: string; bandIdentifier?: string | null; actorId?: string | null; now?: Date },
): Promise<{ status: "registered" | "band_not_bound"; attendee_id: string; registration_id: string; credential_id: string; band_status: string | null }> {
  return db.transaction(async (tx) => {
    const now = i.now ?? new Date();
    const attendeeId = await createAttendee(tx, cipher, {});
    const [reg] = await tx
      .insert(registrations)
      .values({ event_id: i.eventId, attendee_id: attendeeId, tier: "PUBLIC", state: "confirmed", zone_presence_consent_at: i.zonePresenceConsent ? now : null, created_at: now, checked_in_at: null })
      .returning({ id: registrations.id });
    const cred = await issueCredential(tx, { registrationId: reg!.id, ref: i.credentialRef, now });
    let band: string | null = null;
    if (i.bandIdentifier) band = (await bindCarrier(tx, { identifier: i.bandIdentifier, credentialId: cred.credential_id, actorId: i.actorId, now })).status;
    return {
      status: band && band !== "bound" ? ("band_not_bound" as const) : ("registered" as const),
      attendee_id: attendeeId, registration_id: reg!.id, credential_id: cred.credential_id, band_status: band,
    };
  });
}

/** Operator tier change (MFA checked by the API). Audited with reason; advances the revocation epoch. */
export async function changeRegistrationTier(
  db: DbOrTx,
  i: { registrationId: string; tier: Tier; actorId: string; reason: string; mfaAt?: Date | null },
): Promise<{ status: "changed" | "unchanged" | "not_found"; from_tier: string | null; audit_id: number | null }> {
  const x = (
    await rows(
      db,
      sql`select * from public.registration_change_tier(${i.registrationId}::uuid, ${i.tier}::attendee_tier, ${i.actorId}::uuid,
            ${i.reason}, ${i.mfaAt ? i.mfaAt.toISOString() : null}::timestamptz)`,
    )
  )[0]!;
  return { status: x.status as "changed" | "unchanged" | "not_found", from_tier: (x.from_tier as string | null) ?? null, audit_id: x.audit_id == null ? null : num(x.audit_id) };
}

/** Approve (pending_approval → confirmed) or cancel a registration; cancelling revokes its credential. Audited. */
export async function setRegistrationState(
  db: DbOrTx,
  i: { registrationId: string; state: RegState; actorId?: string | null; now?: Date },
): Promise<{ status: "changed" | "unchanged" | "not_found" | "not_allowed"; from_state: string | null; audit_id: number | null }> {
  const x = (
    await rows(db, sql`select * from public.registration_set_state(${i.registrationId}::uuid, ${i.state}::registration_state, ${i.actorId ?? null}::uuid, ${tsOrNow(i.now)})`)
  )[0]!;
  return {
    status: x.status as "changed" | "unchanged" | "not_found" | "not_allowed",
    from_state: (x.from_state as string | null) ?? null,
    audit_id: x.audit_id == null ? null : num(x.audit_id),
  };
}

/* -------------------------------------------------------------- data requests */

export type DataRequest = typeof data_requests.$inferSelect;

/** Opens an export or erasure request (or returns the open one). */
export async function openDataRequest(db: DbOrTx, attendeeId: string, kind: "export" | "erasure", now?: Date) {
  const x = (await rows(db, sql`select * from public.data_request_open(${attendeeId}::uuid, ${kind}::data_request_kind, ${tsOrNow(now)})`))[0]!;
  return { status: x.status as "opened" | "already_open", request_id: String(x.request_id) };
}

/** Claims the oldest waiting request for processing (safe with concurrent workers). */
export async function claimDataRequest(db: DbOrTx, opts: { kind?: "export" | "erasure"; handlerId?: string | null; now?: Date } = {}): Promise<DataRequest | null> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select * from public.data_request_claim(${opts.kind ?? null}::data_request_kind, ${opts.handlerId ?? null}::uuid, ${tsOrNow(opts.now)})`,
  );
  if (!r[0]) return null;
  const x = r[0];
  const d = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  return {
    id: String(x.id), attendee_id: String(x.attendee_id), kind: x.kind as DataRequest["kind"], state: x.state as DataRequest["state"],
    requested_at: d(x.requested_at)!, started_at: d(x.started_at), completed_at: d(x.completed_at),
    handled_by: (x.handled_by as string | null) ?? null, object_key: (x.object_key as string | null) ?? null, note: (x.note as string | null) ?? null,
  };
}

/** Completes (with the export's object key) or rejects (with a note) a request. Erasure also ends sessions. */
export async function finishDataRequest(
  db: DbOrTx,
  requestId: string,
  i: { state: "completed" | "rejected"; objectKey?: string | null; note?: string | null; actorId?: string | null; now?: Date },
): Promise<"completed" | "rejected" | "not_open"> {
  const x = (
    await rows(
      db,
      sql`select * from public.data_request_finish(${requestId}::uuid, ${i.state}::data_request_state, ${i.objectKey ?? null}, ${i.note ?? null},
            ${i.actorId ?? null}::uuid, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return x.status as "completed" | "rejected" | "not_open";
}

/** The operator queue (06 D14). */
export async function listDataRequests(
  db: DbOrTx,
  q: { state?: DataRequest["state"]; kind?: DataRequest["kind"]; limit?: number; offset?: number } = {},
): Promise<Page<DataRequest>> {
  const conds = [q.state ? eq(data_requests.state, q.state) : undefined, q.kind ? eq(data_requests.kind, q.kind) : undefined].filter(Boolean);
  const where = conds.length ? and(...(conds as never[])) : undefined;
  const items = await db.select().from(data_requests).where(where).orderBy(desc(data_requests.requested_at)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const total = num((await db.select({ n: sql<number>`count(*)` }).from(data_requests).where(where))[0]!.n);
  return { items, total };
}

export interface AttendeeExport {
  identity: AttendeeIdentity | null;
  registrations: (typeof registrations.$inferSelect)[];
  credentials: { id: string; registration_id: string | null; state: string; issued_at: Date; revoked_at: Date | null }[];
}

/**
 * Everything held about one attendee, for a data export (03 §5): decrypted identity (vault
 * connection), registrations and credential states (general connection). Movement data is not
 * included — it is held only under an ephemeral id and destroyed after each event.
 */
export async function collectAttendeeExport(c: { db: DbOrTx; vault: AnyDb; cipher: Cipher }, attendeeId: string): Promise<AttendeeExport> {
  const identity = await readAttendee(c.vault, c.cipher, attendeeId, "system");
  const regs = await c.db.select().from(registrations).where(eq(registrations.attendee_id, attendeeId));
  const creds = regs.length
    ? await c.db
        .select({ id: credentials.id, registration_id: credentials.registration_id, state: credentials.state, issued_at: credentials.issued_at, revoked_at: credentials.revoked_at })
        .from(credentials)
        .where(sql`${credentials.registration_id} in (select id from public.registrations where attendee_id = ${attendeeId}::uuid)`)
    : [];
  return { identity, registrations: regs, credentials: creds };
}

/** Processes an erasure request: scrubs identity (vault connection) then completes the request (general). */
export async function processErasureRequest(c: { db: DbOrTx; vault: AnyDb }, request: DataRequest, actorId?: string | null): Promise<void> {
  if (request.kind !== "erasure") throw new Error("not an erasure request");
  await eraseAttendee(c.vault, request.attendee_id, actorId ?? null);
  await finishDataRequest(c.db, request.id, { state: "completed", actorId });
}
