/**
 * Wristbands and other carriers (docs/01 §5.2–§5.3). State machines are enforced by triggers; these
 * helpers wrap the atomic functions, which also write the audit entries and return their ids.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { num, rows, tsOrNow, type DbOrTx } from "./sqlrows";

type ChipProfile = "ntag_uid" | "ntag424_dna" | "desfire_ev3";
type CarrierKind = "qr_portal" | "qr_email" | "nfc";

/**
 * The stored identifier of an NFC band: base64url SHA-256 of "nfc:" + the UID in uppercase hex.
 * Identical to the API's scan-path derivation; the raw UID is never stored.
 */
export function nfcIdentifierHash(uid: string): string {
  return createHash("sha256").update(`nfc:${uid.trim().toUpperCase()}`, "utf8").digest("base64url");
}

/** What a band shows people (0035): the UID's last four characters in upper-case hex. Never more of the UID. */
export function nfcIdentifierHint(uid: string): string {
  return uid.trim().toUpperCase().slice(-4);
}

/**
 * Stores the readable hint of each presented UID on the NFC carriers with its identifier that have none
 * yet (0035). Safe to call whenever a UID is presented: hint and identifier both derive from the UID.
 * Returns how many carriers were updated.
 */
export async function noteCarrierHints(db: DbOrTx, uids: readonly string[]): Promise<number> {
  const valid = [...new Set(uids.map((u) => u.trim().toUpperCase()).filter((u) => /^[0-9A-F]{8,32}$/.test(u)))];
  if (valid.length === 0) return 0;
  const arr = (xs: string[]) => `{${xs.join(",")}}`; // base64url and hex need no quoting
  const r = await rows(
    db,
    sql`with v as (select * from unnest(${arr(valid.map(nfcIdentifierHash))}::text[], ${arr(valid.map(nfcIdentifierHint))}::text[]) as v(h, hint))
        update public.carriers c set identifier_hint = v.hint from v
         where c.kind = 'nfc' and c.identifier = v.h and c.identifier_hint is null
        returning c.id`,
  );
  return r.length;
}

export interface ImportResult {
  inserted: number;
  /** Identifiers repeated in the input or already present among non-retired carriers. */
  duplicates: string[];
  /** Values that are not a 43-character base64url hash. */
  invalid: string[];
}

/** Bulk import of already-hashed identifiers into `stock`. Duplicates are reported, not fatal. */
export async function importCarrierIdentifiers(
  db: DbOrTx,
  identifiers: readonly string[],
  opts: { kind?: CarrierKind; chipProfile?: ChipProfile | null } = {},
): Promise<ImportResult> {
  const x = (
    await rows(
      db,
      sql`select * from public.carriers_import(${`{${identifiers.map((s) => `"${s.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`}::text[],
            ${opts.kind ?? "nfc"}::carrier_kind, ${opts.chipProfile ?? null}::chip_profile)`,
    )
  )[0]!;
  return { inserted: num(x.inserted), duplicates: (x.duplicates as string[]) ?? [], invalid: (x.invalid as string[]) ?? [] };
}

/**
 * Bulk import of bands by UID (the manufacturer's CSV). UIDs are hashed here; duplicates are
 * reported by UID. Chunked so tens of thousands of rows stay well inside parameter limits.
 */
export async function importBands(
  db: DbOrTx,
  uids: readonly string[],
  opts: { chipProfile?: ChipProfile | null; chunk?: number } = {},
): Promise<{ inserted: number; duplicateUids: string[]; invalidUids: string[] }> {
  const byHash = new Map<string, string>();
  const invalidUids: string[] = [];
  const hashes: string[] = [];
  for (const u of uids) {
    if (!/^[0-9A-Fa-f]{8,32}$/.test(u.trim())) {
      invalidUids.push(u);
      continue;
    }
    const h = nfcIdentifierHash(u);
    if (!byHash.has(h)) byHash.set(h, u);
    hashes.push(h);
  }
  let inserted = 0;
  const dup = new Set<string>();
  const chunk = opts.chunk ?? 5000;
  for (let i = 0; i < hashes.length; i += chunk) {
    const r = await importCarrierIdentifiers(db, hashes.slice(i, i + chunk), { kind: "nfc", chipProfile: opts.chipProfile ?? null });
    inserted += r.inserted;
    for (const d of r.duplicates) dup.add(byHash.get(d) ?? d);
  }
  // A UID repeated across chunks is a duplicate too.
  const seen = new Set<string>();
  for (const h of hashes) {
    if (seen.has(h)) dup.add(byHash.get(h)!);
    seen.add(h);
  }
  // The readable hint of each band (0035).
  const valid = [...byHash.values()];
  for (let i = 0; i < valid.length; i += chunk) await noteCarrierHints(db, valid.slice(i, i + chunk));
  return { inserted, duplicateUids: [...dup], invalidUids };
}

export type BindStatus = "bound" | "assigned" | "unknown_carrier" | "not_in_stock" | "credential_not_usable" | "credential_has_carrier";
export interface BindResult {
  status: BindStatus;
  carrier_id: string | null;
  credential_id: string;
  carrier_state: string | null;
  audit_id: number | null;
}

/** Desk binding: stock → assigned (→ bound when `confirm`, the default). Audited. */
export async function bindCarrier(
  db: DbOrTx,
  i: { identifier: string; credentialId: string; actorId?: string | null; confirm?: boolean; kind?: CarrierKind; now?: Date },
): Promise<BindResult> {
  const x = (
    await rows(
      db,
      sql`select * from public.carrier_bind(${i.identifier}, ${i.credentialId}::uuid, ${i.actorId ?? null}::uuid,
            ${i.confirm ?? true}, ${i.kind ?? "nfc"}::carrier_kind, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return {
    status: x.status as BindStatus,
    carrier_id: (x.carrier_id as string | null) ?? null,
    credential_id: String(x.credential_id),
    carrier_state: (x.carrier_state as string | null) ?? null,
    audit_id: x.audit_id == null ? null : num(x.audit_id),
  };
}

/** Confirms an assigned band after the write was verified (assigned → bound). Audited. */
export async function confirmCarrier(db: DbOrTx, carrierId: string, opts: { actorId?: string | null; now?: Date } = {}) {
  const x = (await rows(db, sql`select * from public.carrier_confirm(${carrierId}::uuid, ${opts.actorId ?? null}::uuid, ${tsOrNow(opts.now)})`))[0]!;
  return { status: x.status as "bound" | "not_assigned", audit_id: x.audit_id == null ? null : num(x.audit_id) };
}

export type RebindStatus = "rebound" | "no_current_carrier" | "unknown_carrier" | "not_in_stock" | "credential_not_usable";
/** Swaps a credential's band for a stock band, keeping the credential. Old band → retired or lost. Audited (2 entries). */
export async function rebindCarrier(
  db: DbOrTx,
  i: { credentialId: string; newIdentifier: string; disposition?: "retired" | "lost"; actorId?: string | null; now?: Date },
): Promise<{ status: RebindStatus; old_carrier_id: string | null; new_carrier_id: string | null; audit_ids: number[] }> {
  const x = (
    await rows(
      db,
      sql`select * from public.carrier_rebind(${i.credentialId}::uuid, ${i.newIdentifier}, ${i.disposition ?? "retired"}::carrier_state,
            ${i.actorId ?? null}::uuid, 'nfc'::carrier_kind, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return {
    status: x.status as RebindStatus,
    old_carrier_id: (x.old_carrier_id as string | null) ?? null,
    new_carrier_id: (x.new_carrier_id as string | null) ?? null,
    audit_ids: ((x.audit_ids as unknown[]) ?? []).map(num),
  };
}

export type ReplaceLostStatus = "replaced" | "unknown_carrier" | "carrier_not_live" | "not_in_stock" | "credential_not_usable";
export interface ReplaceLostResult {
  status: ReplaceLostStatus;
  old_carrier_id: string | null;
  new_carrier_id: string | null;
  old_credential_id: string | null;
  new_credential_id: string | null;
  /** carrier.mark_lost, credential.replace, credential.reissue, carrier.bind — in that order. */
  audit_ids: number[];
}

/**
 * Lost band (01 §5.3): band → lost, credential → replaced, new credential (reference
 * `newCredentialRef`, 22 base64url) with a portal-QR carrier, new band bound. One transaction.
 */
export async function replaceLostBand(
  db: DbOrTx,
  i: { lostIdentifier: string; newIdentifier: string; newCredentialRef: string; actorId?: string | null; now?: Date },
): Promise<ReplaceLostResult> {
  const x = (
    await rows(
      db,
      sql`select * from public.carrier_replace_lost(${i.lostIdentifier}, ${i.newIdentifier}, ${i.newCredentialRef},
            ${i.actorId ?? null}::uuid, ${tsOrNow(i.now)})`,
    )
  )[0]!;
  return {
    status: x.status as ReplaceLostStatus,
    old_carrier_id: (x.old_carrier_id as string | null) ?? null,
    new_carrier_id: (x.new_carrier_id as string | null) ?? null,
    old_credential_id: (x.old_credential_id as string | null) ?? null,
    new_credential_id: (x.new_credential_id as string | null) ?? null,
    audit_ids: ((x.audit_ids as unknown[]) ?? []).map(num),
  };
}

/** Counts per carrier state (D8 inventory). */
export async function carrierInventory(db: DbOrTx, kind: CarrierKind = "nfc"): Promise<Record<string, number>> {
  const r = await rows(db, sql`select * from public.carrier_inventory(${kind}::carrier_kind)`);
  return Object.fromEntries(r.map((x) => [String(x.state), num(x.count)]));
}

/**
 * Bulk import in the API's row shape: already-hashed identifiers with their chip profile.
 * `duplicates` are identifier hashes repeated in the input or already present; `invalid` are
 * values that are not 43-character base64url hashes. Never throws for bad rows.
 */
export async function importCarriers(
  db: DbOrTx,
  rowsIn: readonly { identifier_hash: string; chip_profile?: ChipProfile | null }[],
): Promise<{ imported: number; duplicates: string[]; invalid: string[] }> {
  const groups = new Map<ChipProfile | null, string[]>();
  for (const r of rowsIn) {
    const k = r.chip_profile ?? null;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r.identifier_hash);
  }
  let imported = 0;
  const duplicates = new Set<string>();
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const [profile, ids] of groups) {
    for (let i = 0; i < ids.length; i += 5000) {
      const r = await importCarrierIdentifiers(db, ids.slice(i, i + 5000), { kind: "nfc", chipProfile: profile });
      imported += r.inserted;
      r.duplicates.forEach((d) => duplicates.add(d));
      invalid.push(...r.invalid);
    }
  }
  // Repeated across chip-profile groups or chunks.
  for (const r of rowsIn) {
    if (seen.has(r.identifier_hash)) duplicates.add(r.identifier_hash);
    seen.add(r.identifier_hash);
  }
  return { imported, duplicates: [...duplicates], invalid };
}
