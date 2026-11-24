/**
 * Identity vault — docs/03-security-privacy.md §5. A separate Postgres schema, `pii_vault`, with
 * row-level security ENABLED and FORCED on every table (policies in migration 0002).
 *
 * Every query touching these tables must run inside `withVaultScope()` (src/client.ts), which sets
 * `app.vault_scope` (and `app.attendee_id` for the `attendee` scope) for the transaction.
 * Without it, reads return zero rows and writes are rejected.
 *
 * `ephemeral_ids` also lives in this schema but is declared in ./operations.ts to avoid an import
 * cycle (it references credentials).
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./people";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const piiVault = pgSchema("pii_vault");

/**
 * One row per person. A Public-tier attendee has no email and no name (02 §4.2).
 *
 * `email` and `full_name` hold AES-256-GCM envelopes (`ev1.<kid>.<iv>.<ct>`, src/crypto) bound to
 * this row and column; `profile_jsonb` holds `{"$enc": "ev1.…"}`. The database never sees a key.
 * Write and read them only through src/secrets.ts. `email_hash` is the keyed blind index
 * (HMAC-SHA-256 under a separate key, 64 hex) used for lookup and de-duplication without decrypting.
 */
export const attendees = piiVault.table(
  "attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Optional link to a users row (an attendee who is also staff). */
    user_id: uuid("user_id").references(() => users.id),
    email: text("email"),
    email_hash: text("email_hash"),
    full_name: text("full_name"),
    /** Answers to the event-defined profile fields. */
    profile_jsonb: jsonb("profile_jsonb").notNull().default(sql`'{}'::jsonb`),
    created_at: tstz("created_at").notNull().defaultNow(),
    updated_at: tstz("updated_at").notNull().defaultNow(),
    /** Set by erasure: identifying columns are nulled, the row stays so registrations keep integrity. */
    erased_at: tstz("erased_at"),
    /** Optional phone number (0030): an AES-256-GCM envelope like `email`; scrubbed by erasure. */
    phone: text("phone"),
  },
  (t) => [
    uniqueIndex("attendees_email_hash_uq")
      .on(t.email_hash)
      .where(sql`${t.email_hash} IS NOT NULL`),
    index("attendees_user_idx").on(t.user_id),
    check("attendees_phone_encrypted", sql`${t.phone} IS NULL OR ${t.phone} ~ '^ev1\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$'`),
  ],
);

/**
 * A self-service registration waiting for its emailed link to be redeemed (0028). Created by the
 * public `POST /users/register`; completed (and deleted) when the link is redeemed on any device;
 * deleted unused once the link has expired. `answers_enc` is an AES-256-GCM envelope of the JSON
 * answers (profile values, phone), bound to this row and column; write and read it only through
 * src/pending-registrations.ts. Forced row-level security: system scope only.
 */
export const pending_registrations = piiVault.table(
  "pending_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** auth_links.token_hash of the emailed link this registration completes with. */
    link_token_hash: text("link_token_hash").notNull(),
    attendee_id: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id),
    /** public.events.id (no FK across the vault boundary). */
    event_id: uuid("event_id").notNull(),
    zone_presence_consent: boolean("zone_presence_consent").notNull(),
    answers_enc: text("answers_enc").notNull(),
    expires_at: tstz("expires_at").notNull(),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pending_registrations_link_uq").on(t.link_token_hash),
    index("pending_registrations_expiry_idx").on(t.expires_at),
    check("pending_registrations_link_hash", sql`${t.link_token_hash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("pending_registrations_answers_encrypted", sql`${t.answers_enc} ~ '^ev1\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22,}$'`),
  ],
);
