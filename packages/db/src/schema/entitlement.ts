/**
 * Registration and entitlement — docs/02-architecture.md §4.2 (P-04, D-02).
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accessEffect, accessSubjectKind, attendeeTier, invitationState, registrationState } from "./enums";
import { attendees } from "./vault";
import { event_rooms, events } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Private Invitation links: single-use, bound to a hash of the recipient email (03 §2). */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    /** Email blind index: HMAC-SHA-256 of the normalised address under the blind-index key, 64 hex. */
    email_hash: text("email_hash").notNull(),
    /** base64url SHA-256 (43 chars) of the high-entropy invite token. The token itself is never stored. */
    token_hash: text("token_hash").notNull(),
    state: invitationState("state").notNull().default("sent"),
    expires_at: tstz("expires_at").notNull(),
    redeemed_at: tstz("redeemed_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.token_hash),
    // At most one outstanding invitation per recipient per event.
    uniqueIndex("invitations_open_per_recipient_uq")
      .on(t.event_id, t.email_hash)
      .where(sql`${t.state} = 'sent'`),
    check(
      "invitations_redeemed_consistent",
      sql`(${t.state} = 'redeemed') = (${t.redeemed_at} IS NOT NULL)`,
    ),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id),
    /** pii_vault.attendees. ON DELETE RESTRICT: erasure scrubs the attendee row instead. */
    attendee_id: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id),
    tier: attendeeTier("tier").notNull(),
    /** No default: the path decides (VIP → pending_approval; Ordinary/Public/RSVP → confirmed). */
    state: registrationState("state").notNull(),
    /** Separate, unticked-by-default consent (03 §5). Null = not given. */
    zone_presence_consent_at: tstz("zone_presence_consent_at"),
    /** The Private Invitation this registration redeemed, if any. */
    invitation_id: uuid("invitation_id").references(() => invitations.id),
    /** First admission at this event. Survives the purge, so attendance is reportable afterwards. */
    checked_in_at: tstz("checked_in_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
    updated_at: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("registrations_event_attendee_uq").on(t.event_id, t.attendee_id),
    index("registrations_event_tier_idx").on(t.event_id, t.tier),
    index("registrations_attendee_idx").on(t.attendee_id),
    uniqueIndex("registrations_invitation_uq")
      .on(t.invitation_id)
      .where(sql`${t.invitation_id} IS NOT NULL`),
  ],
);

/**
 * The tier × room matrix — source of truth for entitlement (02 §4.2). `subject` is a tier value when
 * subject_kind = 'tier' and a role value when subject_kind = 'role' (CHECK enforced).
 */
export const access_rules = pgTable(
  "access_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id").notNull(),
    subject_kind: accessSubjectKind("subject_kind").notNull(),
    subject: text("subject").notNull(),
    room_id: uuid("room_id").notNull(),
    window_start: tstz("window_start"),
    window_end: tstz("window_end"),
    effect: accessEffect("effect").notNull(),
  },
  (t) => [
    // The room must be one of the event's rooms.
    foreignKey({
      name: "access_rules_event_room_fk",
      columns: [t.event_id, t.room_id],
      foreignColumns: [event_rooms.event_id, event_rooms.room_id],
    }).onDelete("cascade"),
    index("access_rules_lookup_idx").on(t.event_id, t.room_id, t.subject_kind, t.subject),
    check(
      "access_rules_subject_valid",
      sql`(${t.subject_kind} = 'tier' AND ${t.subject} IN ('VIP','ORDINARY','PRIVATE_INVITE','PUBLIC'))
       OR (${t.subject_kind} = 'role' AND ${t.subject} IN ('admin','organiser','security_staff','speaker','crew'))`,
    ),
    check(
      "access_rules_window_order",
      sql`${t.window_start} IS NULL OR ${t.window_end} IS NULL OR ${t.window_end} > ${t.window_start}`,
    ),
  ],
);
