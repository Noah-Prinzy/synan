/**
 * Credentials and carriers — docs/02-architecture.md §4.3 (P-01, P-02, P-10, D-05, D-06, D-12).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { carrierKind, carrierState, chipProfile, credentialState, signingKeyPurpose } from "./enums";
import { registrations } from "./entitlement";
import { users } from "./people";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * One credential per registration (or per staff user, O-09). Exactly one of registration_id and
 * staff_user_id is set. The credential carries no tier: entitlement is resolved through
 * registration → tier → access_rules at scan time.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registration_id: uuid("registration_id").references(() => registrations.id),
    staff_user_id: uuid("staff_user_id").references(() => users.id),
    /**
     * The credential's opaque 128-bit reference, 22 base64url characters (no padding). Random, never a
     * database id; signed QR codes and allowlists carry it. (Named `token_hash` in the spec; it is a
     * random reference, not a hash.)
     */
    token_hash: text("token_hash").notNull(),
    state: credentialState("state").notNull().default("issued"),
    /** `OUTSIDE` or `INSIDE_<zone_id>` — drives anti-passback (01 §7). */
    zone_state: text("zone_state").notNull().default("OUTSIDE"),
    issued_at: tstz("issued_at").notNull().defaultNow(),
    revoked_at: tstz("revoked_at"),
    /** The re-issued credential that superseded this one (state = replaced). */
    replaced_by_id: uuid("replaced_by_id").references((): AnyPgColumn => credentials.id),
  },
  (t) => [
    uniqueIndex("credentials_token_hash_uq").on(t.token_hash),
    check("credentials_exactly_one_holder", sql`num_nonnulls(${t.registration_id}, ${t.staff_user_id}) = 1`),
    check(
      "credentials_zone_state_format",
      sql`${t.zone_state} = 'OUTSIDE' OR ${t.zone_state} ~ '^INSIDE_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check("credentials_revoked_at", sql`(${t.state} = 'revoked') = (${t.revoked_at} IS NOT NULL)`),
    // "Each registration has one credential": at most one live credential per holder.
    uniqueIndex("credentials_one_live_per_registration_uq")
      .on(t.registration_id)
      .where(sql`${t.registration_id} IS NOT NULL AND ${t.state} IN ('issued','active','suspended_review')`),
    uniqueIndex("credentials_one_live_per_staff_uq")
      .on(t.staff_user_id)
      .where(sql`${t.staff_user_id} IS NOT NULL AND ${t.state} IN ('issued','active','suspended_review')`),
    index("credentials_registration_idx").on(t.registration_id),
    index("credentials_staff_idx").on(t.staff_user_id),
  ],
);

/**
 * A physical or digital carrier pointing at a credential. Stock wristbands have no credential yet.
 *
 * `identifier` is always base64url SHA-256 (43 characters), never a raw value:
 *  - `nfc`: SHA-256 of the chip UID as uppercase hex (the raw UID is not stored);
 *  - `qr_email`: SHA-256 of the emailed code's id;
 *  - `qr_portal`: null (portal codes are signed per request).
 */
export const carriers = pgTable(
  "carriers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credential_id: uuid("credential_id").references(() => credentials.id),
    kind: carrierKind("kind").notNull(),
    identifier: text("identifier"),
    /**
     * NFC: the UID's last four characters in upper-case hex (0035), what the band shows people
     * ("••••81BF"). Written when the UID is presented (import, bind, a desk or gate read); the UID
     * itself is never stored. Null until then, and for other kinds.
     */
    identifier_hint: text("identifier_hint"),
    chip_profile: chipProfile("chip_profile"),
    state: carrierState("state").notNull(),
    bound_at: tstz("bound_at"),
    /** The single use of an emailed QR (D-05). */
    redeemed_at: tstz("redeemed_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // A band / token identifier resolves to at most one non-retired carrier.
    uniqueIndex("carriers_identifier_uq")
      .on(t.kind, t.identifier)
      .where(sql`${t.identifier} IS NOT NULL AND ${t.state} <> 'retired'`),
    // The scan lookup itself (kind + identifier, retired bands included so a retired band is reported
    // as such): the partial index above cannot serve it, which made every scan read the whole table
    // (measured on PostgreSQL 17 with 60,000 carriers: ≈14 ms of a scan's ≈16 ms in the database; 0036).
    index("carriers_kind_identifier_idx").on(t.kind, t.identifier),
    // At most one live carrier of each kind per credential.
    uniqueIndex("carriers_one_live_per_kind_uq")
      .on(t.credential_id, t.kind)
      .where(sql`${t.state} IN ('assigned','bound','active')`),
    index("carriers_credential_idx").on(t.credential_id),
    index("carriers_state_idx").on(t.kind, t.state),
    check(
      "carriers_stock_unassigned",
      sql`(${t.state} = 'stock' AND ${t.credential_id} IS NULL) OR (${t.state} <> 'stock' AND (${t.credential_id} IS NOT NULL OR ${t.state} IN ('retired','lost')))`,
    ),
    check("carriers_identifier_required", sql`${t.kind} = 'qr_portal' OR ${t.identifier} IS NOT NULL`),
    check("carriers_chip_profile_nfc_only", sql`${t.chip_profile} IS NULL OR ${t.kind} = 'nfc'`),
    check("carriers_redeemed_email_only", sql`${t.redeemed_at} IS NULL OR ${t.kind} = 'qr_email'`),
    check("carriers_identifier_hint_shape", sql`${t.identifier_hint} IS NULL OR (${t.kind} = 'nfc' AND ${t.identifier_hint} ~ '^[0-9A-F]{4}$')`),
  ],
);

/** Ed25519 keys for portal QR codes and offline allowlists (D-12). Scanners receive public keys only. */
export const signing_keys = pgTable(
  "signing_keys",
  {
    /** Also the JWS `kid`. */
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: signingKeyPurpose("purpose").notNull(),
    algorithm: text("algorithm").notNull().default("EdDSA"),
    /**
     * Short public key id carried in signed QR codes: first 4 bytes of SHA-256 of the raw public key,
     * 8 lowercase hex. Unique, so a rotation that would collide is refused (generate another key).
     */
    qr_kid: text("qr_kid"),
    /** Public JWK (JSON text). */
    public_key: text("public_key").notNull(),
    /** Private JWK encrypted by src/crypto (envelope `ev1.…`, bound to this row). */
    private_key_enc: text("private_key_enc").notNull(),
    active_from: tstz("active_from").notNull().defaultNow(),
    retired_at: tstz("retired_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("signing_keys_purpose_idx").on(t.purpose, t.active_from),
    uniqueIndex("signing_keys_qr_kid_uq").on(t.qr_kid).where(sql`${t.qr_kid} IS NOT NULL`),
    check("signing_keys_qr_kid_format", sql`${t.qr_kid} IS NULL OR ${t.qr_kid} ~ '^[0-9a-f]{8}$'`),
    check("signing_keys_retire_order", sql`${t.retired_at} IS NULL OR ${t.retired_at} > ${t.active_from}`),
  ],
);
