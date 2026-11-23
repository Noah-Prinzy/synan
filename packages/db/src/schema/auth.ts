/**
 * Sign-in state: refresh-token sessions, attendee email links, WebSocket tickets.
 * Atomic operations (rotate, redeem, consume, cleanup) are SQL functions in migration 0004 with
 * typed wrappers in src/auth.ts. Every secret is stored only as base64url SHA-256 (43 chars).
 *
 * No attendee identity lives here: a holder is an id, an unknown recipient is the email blind index.
 */
import { sql } from "drizzle-orm";
import {
  check,
  cidr,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./people";
import { attendees } from "./vault";
import { checkpoints, events } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const authRevokeReason = pgEnum("auth_revoke_reason", [
  "logout",
  "reuse_detected",
  "mfa_step_up",
  "operator",
  "credential_change",
  "erasure",
]);
export const authLinkPurpose = pgEnum("auth_link_purpose", ["sign_in", "verify_email"]);
/** Same values as the contracts' WsChannel. */
export const wsChannel = pgEnum("ws_channel", ["/stream/scans", "/stream/telemetry", "/stream/alerts", "/stream/me"]);

/**
 * One row per refresh token. A login starts a family; each refresh exchanges the presented token
 * (stamping `rotated_at`) for a child row in the same family (`parent_id` = the row it replaced).
 * Presenting a token whose row is already rotated is reuse: the whole family is revoked.
 *
 * Device context is deliberately coarse, for operator session review only: `user_agent` truncated to
 * 200 characters and `ip_prefix` truncated to /24 (IPv4) or /48 (IPv6) — never a full address.
 */
export const auth_sessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    family_id: uuid("family_id").notNull(),
    parent_id: uuid("parent_id").references((): AnyPgColumn => auth_sessions.id, { onDelete: "set null" }),
    /** Operator or staff holder. Exactly one of user_id / attendee_id. */
    user_id: uuid("user_id").references(() => users.id),
    attendee_id: uuid("attendee_id").references(() => attendees.id),
    /** base64url SHA-256 of this row's refresh token. */
    token_hash: text("token_hash").notNull(),
    /** Time of the last MFA step-up carried by this family. */
    mfa_at: tstz("mfa_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
    /** When this token was exchanged for its child (single use). */
    rotated_at: tstz("rotated_at"),
    expires_at: tstz("expires_at").notNull(),
    revoked_at: tstz("revoked_at"),
    revoke_reason: authRevokeReason("revoke_reason"),
    user_agent: text("user_agent"),
    ip_prefix: cidr("ip_prefix"),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_uq").on(t.token_hash),
    index("auth_sessions_family_idx").on(t.family_id),
    index("auth_sessions_user_idx").on(t.user_id).where(sql`${t.revoked_at} IS NULL`),
    index("auth_sessions_attendee_idx").on(t.attendee_id).where(sql`${t.revoked_at} IS NULL`),
    index("auth_sessions_expires_idx").on(t.expires_at),
    check("auth_sessions_one_holder", sql`num_nonnulls(${t.user_id}, ${t.attendee_id}) = 1`),
    check("auth_sessions_revoke_reason", sql`(${t.revoked_at} IS NULL) = (${t.revoke_reason} IS NULL)`),
    check("auth_sessions_expiry_order", sql`${t.expires_at} > ${t.created_at}`),
    check("auth_sessions_user_agent_len", sql`${t.user_agent} IS NULL OR length(${t.user_agent}) <= 200`),
    check(
      "auth_sessions_ip_truncated",
      sql`${t.ip_prefix} IS NULL OR masklen(${t.ip_prefix}) <= CASE family(${t.ip_prefix}) WHEN 4 THEN 24 ELSE 48 END`,
    ),
  ],
);

/**
 * Single-use attendee email links. `attendee_id` when the address belongs to an attendee, otherwise
 * only `email_hash` (blind index), so a link can be issued for an unknown address without creating
 * an account or revealing whether one exists.
 */
export const auth_links = pgTable(
  "auth_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** base64url SHA-256 of the link token. */
    token_hash: text("token_hash").notNull(),
    attendee_id: uuid("attendee_id").references(() => attendees.id),
    /** Keyed blind index of the normalised recipient address (hex). */
    email_hash: text("email_hash"),
    purpose: authLinkPurpose("purpose").notNull().default("sign_in"),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
    redeemed_at: tstz("redeemed_at"),
  },
  (t) => [
    uniqueIndex("auth_links_token_hash_uq").on(t.token_hash),
    index("auth_links_attendee_idx").on(t.attendee_id),
    index("auth_links_expires_idx").on(t.expires_at),
    check("auth_links_recipient", sql`num_nonnulls(${t.attendee_id}, ${t.email_hash}) >= 1`),
    check("auth_links_expiry_order", sql`${t.expires_at} > ${t.created_at}`),
  ],
);

/** Single-use WebSocket tickets (P-16): valid for seconds, consumed on first presentation. */
export const ws_tickets = pgTable(
  "ws_tickets",
  {
    /** base64url SHA-256 of the ticket. */
    ticket_hash: text("ticket_hash").primaryKey(),
    user_id: uuid("user_id").references(() => users.id),
    attendee_id: uuid("attendee_id").references(() => attendees.id),
    /** The refresh family the ticket was minted under; a revoked family invalidates the ticket. */
    session_family_id: uuid("session_family_id"),
    channel: wsChannel("channel").notNull(),
    event_id: uuid("event_id").references(() => events.id),
    checkpoint_id: uuid("checkpoint_id").references(() => checkpoints.id),
    created_at: tstz("created_at").notNull().defaultNow(),
    expires_at: tstz("expires_at").notNull(),
    consumed_at: tstz("consumed_at"),
  },
  (t) => [
    index("ws_tickets_expires_idx").on(t.expires_at),
    check("ws_tickets_one_holder", sql`num_nonnulls(${t.user_id}, ${t.attendee_id}) = 1`),
    check(
      "ws_tickets_short_lived",
      sql`${t.expires_at} > ${t.created_at} AND ${t.expires_at} <= ${t.created_at} + interval '5 minutes'`,
    ),
  ],
);
