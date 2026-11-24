/**
 * Self-service registrations waiting for their emailed link (0028/0029): pii_vault.pending_registrations.
 * The answers (profile values, phone) are an AES-256-GCM envelope bound to the row and column; the
 * table is readable and writable only in the vault's `system` scope (forced row-level security).
 * Use the vault connection (`databases.vault`, role app_vault).
 */
import { randomUUID } from "node:crypto";
import { eq, lte } from "drizzle-orm";
import type { AnyDb } from "./client";
import { withVaultScope } from "./client";
import type { Cipher } from "./crypto/index";
import { pending_registrations } from "./schema/vault";

const ctx = (rowId: string) => ({ table: "pii_vault.pending_registrations", column: "answers_enc", rowId });

export interface PendingRegistrationInput {
  id?: string;
  /** base64url SHA-256 of the emailed link's token (auth_links.token_hash). */
  linkTokenHash: string;
  attendeeId: string;
  eventId: string;
  zonePresenceConsent: boolean;
  /** Profile values and phone; held encrypted. */
  answers: Record<string, unknown>;
  /** The link's expiry: an unused pending registration goes with it. */
  expiresAt: Date;
  now?: Date;
}

export interface PendingRegistration {
  id: string;
  attendee_id: string;
  event_id: string;
  zone_presence_consent: boolean;
  answers: Record<string, unknown>;
  expires_at: Date;
  created_at: Date;
}

export async function createPendingRegistration(vault: AnyDb, cipher: Cipher, i: PendingRegistrationInput): Promise<string> {
  const id = i.id ?? randomUUID();
  await withVaultScope(vault, "system", (tx) =>
    tx.insert(pending_registrations).values({
      id,
      link_token_hash: i.linkTokenHash,
      attendee_id: i.attendeeId,
      event_id: i.eventId,
      zone_presence_consent: i.zonePresenceConsent,
      answers_enc: cipher.encrypt(JSON.stringify(i.answers), ctx(id)),
      expires_at: i.expiresAt,
      ...(i.now ? { created_at: i.now } : {}),
    }),
  );
  return id;
}

/**
 * Takes (reads and deletes, once) the pending registration tied to a redeemed link. Null when there
 * is none, or it has expired (an expired one is deleted too).
 */
export async function takePendingRegistration(vault: AnyDb, cipher: Cipher, linkTokenHash: string, now: Date = new Date()): Promise<PendingRegistration | null> {
  const rows = await withVaultScope(vault, "system", (tx) =>
    tx.delete(pending_registrations).where(eq(pending_registrations.link_token_hash, linkTokenHash)).returning(),
  );
  const r = rows[0];
  if (!r || r.expires_at.getTime() <= now.getTime()) return null;
  return {
    id: r.id,
    attendee_id: r.attendee_id,
    event_id: r.event_id,
    zone_presence_consent: r.zone_presence_consent,
    answers: JSON.parse(cipher.decrypt(r.answers_enc, ctx(r.id))) as Record<string, unknown>,
    expires_at: r.expires_at,
    created_at: r.created_at,
  };
}

/** Deletes pending registrations whose link has expired; returns how many. Schedule it with the sign-in cleanup. */
export async function cleanupPendingRegistrations(vault: AnyDb, now: Date = new Date()): Promise<number> {
  const rows = await withVaultScope(vault, "system", (tx) =>
    tx.delete(pending_registrations).where(lte(pending_registrations.expires_at, now)).returning({ id: pending_registrations.id }),
  );
  return rows.length;
}

/** Erasure: every pending registration of one attendee. */
export async function deletePendingRegistrationsOf(vault: AnyDb, attendeeId: string): Promise<number> {
  const rows = await withVaultScope(vault, "system", (tx) =>
    tx.delete(pending_registrations).where(eq(pending_registrations.attendee_id, attendeeId)).returning({ id: pending_registrations.id }),
  );
  return rows.length;
}
