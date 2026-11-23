/**
 * Operators and staff — docs/02-architecture.md §4.2 (P-15).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRole } from "./enums";
import { checkpoints, events, organizations } from "./venue";

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Operators (admin, organiser) and staff (security_staff, speaker, crew). Attendees are not users. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id").references(() => organizations.id),
    email: text("email").notNull(),
    display_name: text("display_name").notNull().default(""),
    /** Null for staff without a console (speaker, crew) or not yet activated. */
    password_hash: text("password_hash"),
    role: userRole("role").notNull(),
    mfa_enrolled_at: tstz("mfa_enrolled_at"),
    /** Encrypted TOTP / WebAuthn material. Never plaintext. */
    mfa_secret_enc: text("mfa_secret_enc"),
    last_login_at: tstz("last_login_at"),
    disabled_at: tstz("disabled_at"),
    created_at: tstz("created_at").notNull().defaultNow(),
    updated_at: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`), index("users_role_idx").on(t.role)],
);

/**
 * Binds a user to a checkpoint for a shift. Overlap per user is rejected by the exclusion
 * constraint `staff_assignments_no_overlap` (added in migration 0002 — Drizzle cannot express it).
 */
export const staff_assignments = pgTable(
  "staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    checkpoint_id: uuid("checkpoint_id")
      .notNull()
      .references(() => checkpoints.id),
    /** The event whose allowlist this shift caches. Optional: a checkpoint can be staffed between events. */
    event_id: uuid("event_id").references(() => events.id),
    shift_start: tstz("shift_start").notNull(),
    shift_end: tstz("shift_end").notNull(),
    /** Explicit handover (01 §3). Does not shorten the reserved window. */
    handed_over_at: tstz("handed_over_at"),
    created_by: uuid("created_by").references(() => users.id),
    created_at: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("staff_assignments_checkpoint_idx").on(t.checkpoint_id, t.shift_start),
    index("staff_assignments_user_idx").on(t.user_id, t.shift_start),
    check("staff_assignments_shift_order", sql`${t.shift_end} > ${t.shift_start}`),
  ],
);
