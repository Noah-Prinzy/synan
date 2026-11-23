/**
 * Short-lived single-use codes: wristband desk codes (attendee self-binding, 01 §5.3) and staff
 * activation invites.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./people";
import { attendees } from "./vault";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Six-character codes a desk clerk gives an attendee to bind a band from their own phone (06 A5).
 * `code_hash` is a keyed HMAC (blind-index key, "desk_code" domain), never a plain hash: six
 * characters are too few to survive an offline guess against an unkeyed hash.
 */
export const carrier_desk_codes = pgTable(
  "carrier_desk_codes",
  {
    code_hash: text("code_hash").primaryKey(),
    /** The band's identifier hash (carriers.identifier), in stock when the code is created. */
    carrier_identifier: text("carrier_identifier").notNull(),
    created_by: uuid("created_by").references(() => users.id),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
    used_at: tstz("used_at"),
    used_by: uuid("used_by").references(() => attendees.id),
  },
  (t) => [
    index("carrier_desk_codes_expires_idx").on(t.expires_at),
    check("carrier_desk_codes_short_lived", sql`${t.expires_at} > ${t.created_at} AND ${t.expires_at} <= ${t.created_at} + interval '15 minutes'`),
    check("carrier_desk_codes_hash_format", sql`${t.code_hash} ~ '^[A-Za-z0-9_-]{43}$'`),
  ],
);

/** Failed desk-code attempts per attendee, so consumption can be limited (kept 1 day). */
export const carrier_desk_code_failures = pgTable(
  "carrier_desk_code_failures",
  {
    attendee_id: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("carrier_desk_code_failures_idx").on(t.attendee_id, t.at)],
);

/** Single-use staff activation tokens (operator invites a user; they set a password). */
export const user_invites = pgTable(
  "user_invites",
  {
    /** base64url SHA-256 of the invite token (43). */
    token_hash: text("token_hash").primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    created_by: uuid("created_by").references(() => users.id),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
    used_at: tstz("used_at"),
    /** Set when a newer invite for the same user replaces this one. */
    revoked_at: tstz("revoked_at"),
  },
  (t) => [
    index("user_invites_user_idx").on(t.user_id),
    index("user_invites_expires_idx").on(t.expires_at),
    check("user_invites_expiry_order", sql`${t.expires_at} > ${t.created_at}`),
    check("user_invites_token_hash_format", sql`${t.token_hash} ~ '^[A-Za-z0-9_-]{43}$'`),
  ],
);
