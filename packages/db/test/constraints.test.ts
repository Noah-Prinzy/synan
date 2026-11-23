import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema/index";
import { insertUser } from "../src/secrets";
import { attendeeWithCredential, b64Hash, devCipher, credentialRef, hexIndex, miniVenue, scan, type MiniVenue } from "./fixtures";

const UID_HASH = b64Hash("04A1B2C3D4E5F6");
import { createTestDb, q, rejects, type TestDb } from "./helpers";

let db: TestDb;
let v: MiniVenue;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  v = await miniVenue(db);
  userId = await insertUser(db, devCipher, { email: "Guard@Example.test", role: "security_staff" });
});

describe("credentials", () => {
  it("require exactly one of registration_id and staff_user_id", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await rejects(
      db.insert(s.credentials).values({ token_hash: credentialRef() }),
      /credentials_exactly_one_holder/,
    );
    await rejects(
      db.insert(s.credentials).values({
        token_hash: credentialRef(),
        registration_id: a.registrationId,
        staff_user_id: userId,
        state: "revoked",
        revoked_at: new Date(),
      }),
      /credentials_exactly_one_holder/,
    );
    const [staffCred] = await db
      .insert(s.credentials)
      .values({ token_hash: credentialRef(), staff_user_id: userId })
      .returning();
    expect(staffCred!.zone_state).toBe("OUTSIDE");
  });

  it("allow only one live credential per registration, and unique token hashes", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await rejects(
      db.insert(s.credentials).values({ registration_id: a.registrationId, token_hash: credentialRef() }),
      /credentials_one_live_per_registration_uq/,
    );
    // A replaced credential does not block its re-issue.
    await db.update(s.credentials).set({ state: "replaced" }).where(eq(s.credentials.id, a.credentialId));
    const [reissued] = await db
      .insert(s.credentials)
      .values({ registration_id: a.registrationId, token_hash: credentialRef() })
      .returning();
    await rejects(
      db.insert(s.credentials).values({ staff_user_id: userId, token_hash: (await q<{ token_hash: string }>(db, `select token_hash from credentials where id = $1`, [reissued!.id]))[0]!.token_hash, state: "revoked", revoked_at: new Date() }),
      /credentials_token_hash_uq/,
    );
  });

  it("validate zone_state and revoked_at", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await rejects(
      db.update(s.credentials).set({ zone_state: "INSIDE_somewhere" }).where(eq(s.credentials.id, a.credentialId)),
      /credentials_zone_state_format/,
    );
    await db.update(s.credentials).set({ zone_state: `INSIDE_${v.zoneId}` }).where(eq(s.credentials.id, a.credentialId));
    await rejects(
      db.update(s.credentials).set({ state: "revoked" }).where(eq(s.credentials.id, a.credentialId)),
      /credentials_revoked_at/,
    );
  });
});

describe("carriers", () => {
  it("keep NFC identifiers unique among non-retired carriers", async () => {
    await db.insert(s.carriers).values({ kind: "nfc", identifier: UID_HASH, state: "stock", chip_profile: "ntag_uid" });
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", identifier: UID_HASH, state: "stock" }),
      /carriers_identifier_uq/,
    );
    await db.update(s.carriers).set({ state: "retired" }).where(eq(s.carriers.identifier, UID_HASH));
    // A reusable Public band can be re-entered once its previous carrier is retired.
    await db.insert(s.carriers).values({ kind: "nfc", identifier: UID_HASH, state: "stock" });
  });

  it("enforce stock ⇔ unassigned, one live carrier per kind per credential, and kind-specific columns", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("band-1"), state: "stock", credential_id: a.credentialId }),
      /carriers_stock_unassigned/,
    );
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("band-2"), state: "bound" }),
      /carriers_stock_unassigned/,
    );
    await db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("band-3"), state: "bound", credential_id: a.credentialId, bound_at: new Date() });
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("band-4"), state: "active", credential_id: a.credentialId }),
      /carriers_one_live_per_kind_uq/,
    );
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", state: "stock" }),
      /carriers_identifier_required/,
    );
    await rejects(
      db.insert(s.carriers).values({ kind: "qr_portal", state: "active", credential_id: a.credentialId, chip_profile: "ntag424_dna" }),
      /carriers_chip_profile_nfc_only/,
    );
    await rejects(
      db.insert(s.carriers).values({ kind: "nfc", identifier: b64Hash("band-5"), state: "stock", redeemed_at: new Date() }),
      /carriers_redeemed_email_only/,
    );
  });
});

describe("scans", () => {
  it("reject a second scan with the same idempotency key, and ON CONFLICT DO NOTHING makes sync idempotent", async () => {
    const a = await attendeeWithCredential(db, v.eventId);
    const row = await scan(db, v, v.cpAin, a.ephemeralId, "admitted", "2026-12-01T10:00:00Z", { idem_key: "dup-key-0001" });
    await rejects(
      scan(db, v, v.cpAin, a.ephemeralId, "admitted", "2026-12-01T10:00:00Z", { idem_key: "dup-key-0001" }),
      /scans_idem_key_uq|duplicate key/,
    );
    const replay = await db
      .insert(s.scans)
      .values({
        event_id: v.eventId,
        checkpoint_id: v.cpAin,
        ephemeral_id: a.ephemeralId,
        result: "admitted",
        occurred_at: new Date("2026-12-01T10:00:00Z"),
        idem_key: "dup-key-0001",
      })
      .onConflictDoNothing({ target: [s.scans.event_id, s.scans.idem_key] })
      .returning();
    expect(replay).toHaveLength(0);
    const n = await q<{ n: number }>(db, `select count(*)::int n from scans where idem_key = 'dup-key-0001'`);
    expect(n[0]!.n).toBe(1);
    expect(row.id).toBeTruthy();
  });

  it("compute corrected_at = occurred_at + clock_offset_ms (D-14)", async () => {
    const row = await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:00:00.000Z", { clock_offset_ms: -90_500 });
    expect(row.corrected_at.toISOString()).toBe("2026-12-01T09:58:29.500Z");
  });

  it("refuse the client-side offline_queued state as a stored result", async () => {
    await rejects(scan(db, v, v.cpAin, null, "offline_queued", "2026-12-01T10:00:00Z"), /scans_result_stored/);
  });

  it("are append-only: UPDATE, DELETE and TRUNCATE are rejected", async () => {
    const row = await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:01:00Z");
    await rejects(q(db, `update scans set result = 'admitted' where id = $1`, [row.id]), /append-only/);
    await rejects(q(db, `delete from scans where id = $1`, [row.id]), /append-only/);
    await rejects(q(db, `truncate scans`), /append-only/);
  });

  it("land in the event's own partition", async () => {
    const row = await scan(db, v, v.cpAin, null, "unknown_token", "2026-12-01T10:02:00Z");
    const r = await q<{ part: string }>(db, `select tableoid::regclass::text as part from scans where id = $1`, [row.id]);
    expect(r[0]!.part).toBe(`scans_${v.eventId.replaceAll("-", "")}`);
  });

  it("are refused for an event that has no partition", async () => {
    await rejects(
      db.insert(s.scans).values({
        event_id: randomUUID(),
        checkpoint_id: v.cpAin,
        result: "unknown_token",
        occurred_at: new Date(),
        idem_key: "orphan-key-01",
      }),
      /no partition/,
    );
  });
});

describe("staff_assignments", () => {
  it("reject overlapping shifts for one user, allow back-to-back shifts and other users", async () => {
    const u2 = { id: await insertUser(db, devCipher, { email: "g2@example.test", role: "security_staff" }) };
    await db.insert(s.staff_assignments).values({
      user_id: userId,
      checkpoint_id: v.cpAin,
      shift_start: new Date("2026-12-01T08:00:00Z"),
      shift_end: new Date("2026-12-01T12:00:00Z"),
    });
    await rejects(
      db.insert(s.staff_assignments).values({
        user_id: userId,
        checkpoint_id: v.cpBin,
        shift_start: new Date("2026-12-01T11:59:00Z"),
        shift_end: new Date("2026-12-01T14:00:00Z"),
      }),
      /staff_assignments_no_overlap/,
    );
    await db.insert(s.staff_assignments).values({
      user_id: userId,
      checkpoint_id: v.cpBin,
      shift_start: new Date("2026-12-01T12:00:00Z"),
      shift_end: new Date("2026-12-01T16:00:00Z"),
    });
    await db.insert(s.staff_assignments).values({
      user_id: u2!.id,
      checkpoint_id: v.cpAin,
      shift_start: new Date("2026-12-01T08:00:00Z"),
      shift_end: new Date("2026-12-01T12:00:00Z"),
    });
    await rejects(
      db.insert(s.staff_assignments).values({
        user_id: u2!.id,
        checkpoint_id: v.cpAin,
        shift_start: new Date("2026-12-01T12:00:00Z"),
        shift_end: new Date("2026-12-01T12:00:00Z"),
      }),
      /staff_assignments_shift_order/,
    );
  });
});

describe("venue consistency", () => {
  it("reject a checkpoint whose zone is in another venue, and an event room from another venue", async () => {
    const [venue2] = await db.insert(s.venues).values({ org_id: v.orgId, name: "Other", timezone: "UTC" }).returning();
    const [zone2] = await db.insert(s.zones).values({ venue_id: venue2!.id, name: "Z2" }).returning();
    const [room2] = await db.insert(s.rooms).values({ venue_id: venue2!.id, zone_id: zone2!.id, name: "R2", capacity: 5 }).returning();
    await rejects(
      db.insert(s.checkpoints).values({ venue_id: v.venueId, zone_id: zone2!.id, direction: "in", label: "bad" }),
      /checkpoints_zone_same_venue_fk/,
    );
    await rejects(db.insert(s.event_rooms).values({ event_id: v.eventId, room_id: room2!.id }), /not in the venue/);
    await rejects(
      db.insert(s.rooms).values({ venue_id: v.venueId, zone_id: v.zoneId, name: "bad", capacity: 5, warn_at_pct: 90, block_at_pct: 80 }),
      /rooms_thresholds/,
    );
  });

  it("keep hardware ids unique", async () => {
    await db.insert(s.checkpoints).values({ venue_id: v.venueId, zone_id: v.zoneId, direction: "in", label: "R1", hardware_id: "HW-1" });
    await rejects(
      db.insert(s.checkpoints).values({ venue_id: v.venueId, zone_id: v.zoneId, direction: "in", label: "R2", hardware_id: "HW-1" }),
      /checkpoints_hardware_id_uq/,
    );
  });
});

describe("access_rules", () => {
  it("only accept valid subjects and rooms of the event", async () => {
    await db.insert(s.access_rules).values({ event_id: v.eventId, subject_kind: "tier", subject: "VIP", room_id: v.roomA, effect: "permit" });
    await db.insert(s.access_rules).values({ event_id: v.eventId, subject_kind: "role", subject: "crew", room_id: v.roomA, effect: "permit" });
    await rejects(
      db.insert(s.access_rules).values({ event_id: v.eventId, subject_kind: "tier", subject: "crew", room_id: v.roomA, effect: "permit" }),
      /access_rules_subject_valid/,
    );
    const [venueRoomNotInEvent] = await db.insert(s.rooms).values({ venue_id: v.venueId, zone_id: v.zoneId, name: "Unused", capacity: 3 }).returning();
    await rejects(
      db.insert(s.access_rules).values({ event_id: v.eventId, subject_kind: "tier", subject: "VIP", room_id: venueRoomNotInEvent!.id, effect: "permit" }),
      /access_rules_event_room_fk/,
    );
  });
});

describe("event lifecycle", () => {
  it("guards transitions and publishing, and stamps closed_at", async () => {
    const draft = await miniVenue(db, { eventState: "draft" });
    await rejects(q(db, `update events set state = 'live' where id = $1`, [draft.eventId]), /cannot move from draft to live/);
    await q(db, `update events set pass_template_jsonb = null where id = $1`, [draft.eventId]);
    await rejects(q(db, `update events set state = 'published' where id = $1`, [draft.eventId]), /pass template/);
    await q(db, `update events set pass_template_jsonb = '{}' where id = $1`, [draft.eventId]);
    await q(db, `update events set state = 'published' where id = $1`, [draft.eventId]);
    await q(db, `update events set state = 'live' where id = $1`, [draft.eventId]);
    await rejects(q(db, `update events set state = 'draft' where id = $1`, [draft.eventId]), /cannot move from live to draft/);
    await q(db, `update events set state = 'closed' where id = $1`, [draft.eventId]);
    const [ev] = await db.select().from(s.events).where(eq(s.events.id, draft.eventId));
    expect(ev!.closed_at).toBeInstanceOf(Date);
    expect(ev!.grace_buffer).toBe("72:00:00");
  });
});

describe("breach_alerts", () => {
  it("require ack and resolution details consistent with state", async () => {
    const [al] = await db
      .insert(s.breach_alerts)
      .values({ event_id: v.eventId, severity: "high", kind: "unauthorised_tier", checkpoint_id: v.cpAin, occurred_at: new Date() })
      .returning();
    await rejects(
      db.update(s.breach_alerts).set({ state: "acked" }).where(eq(s.breach_alerts.id, al!.id)),
      /breach_alerts_ack_consistent/,
    );
    await db.update(s.breach_alerts).set({ state: "acked", acked_by: userId, acked_at: new Date() }).where(eq(s.breach_alerts.id, al!.id));
    await rejects(
      db.update(s.breach_alerts).set({ state: "resolved", resolved_at: new Date() }).where(eq(s.breach_alerts.id, al!.id)),
      /breach_alerts_resolve_consistent/,
    );
    await db
      .update(s.breach_alerts)
      .set({ state: "resolved", resolved_at: new Date(), resolved_by: userId, resolution_note: "Verified at desk" })
      .where(eq(s.breach_alerts.id, al!.id));
  });
});

describe("users", () => {
  it("treat emails case-insensitively for uniqueness (through the blind index)", async () => {
    await rejects(insertUser(db, devCipher, { email: " guard@example.TEST", role: "crew" }), /users_email_hash_uq/);
    await rejects(q(db, `insert into users (email, role) values ($1, 'crew')`, [devCipher.encrypt("x@example.test", { table: "users", column: "email", rowId: "x" })]), /users_email_hash_required|null value in column "email_hash"/);
    await rejects(q(db, `update users set email = 'plain@example.test' where id = $1`, [userId]), /users_email_encrypted/);
  });
});

describe("invitations", () => {
  it("keep token hashes unique and one open invitation per recipient per event", async () => {
    const alice = hexIndex("alice");
    const tok1 = b64Hash("tok-1");
    const base = { event_id: v.eventId, email_hash: alice, expires_at: new Date("2027-01-01T00:00:00Z") };
    await db.insert(s.invitations).values({ ...base, token_hash: tok1 });
    await rejects(db.insert(s.invitations).values({ ...base, token_hash: b64Hash("tok-2") }), /invitations_open_per_recipient_uq/);
    await rejects(db.insert(s.invitations).values({ ...base, email_hash: hexIndex("bob"), token_hash: tok1 }), /invitations_token_hash_uq/);
    await rejects(
      db.update(s.invitations).set({ state: "redeemed" }).where(eq(s.invitations.token_hash, tok1)),
      /invitations_redeemed_consistent/,
    );
    void sql;
  });

  it("enforce the settled formats: token_hash 43 base64url, email_hash 64 lowercase hex", async () => {
    const ok = { event_id: v.eventId, expires_at: new Date("2027-01-01T00:00:00Z") };
    // token_hash: hex SHA-256 (the old emailed-QR style), padded base64, wrong length, wrong alphabet.
    for (const bad of [hexIndex("t"), b64Hash("t") + "=", b64Hash("t").slice(0, 42), b64Hash("t").slice(0, 42) + "+"]) {
      await rejects(
        db.insert(s.invitations).values({ ...ok, email_hash: hexIndex(), token_hash: bad }),
        /invitations_token_hash_format/,
      );
    }
    // email_hash: uppercase hex, base64url, a raw address, wrong length.
    for (const bad of [hexIndex("e").toUpperCase(), b64Hash("e"), "someone@example.test", hexIndex("e").slice(0, 63)]) {
      await rejects(
        db.insert(s.invitations).values({ ...ok, email_hash: bad, token_hash: b64Hash() }),
        /invitations_email_hash_format/,
      );
    }
    await db.insert(s.invitations).values({ ...ok, email_hash: hexIndex(), token_hash: b64Hash() });
    await rejects(
      db.update(s.invitations).set({ token_hash: "short" }).where(eq(s.invitations.event_id, v.eventId)),
      /invitations_token_hash_format/,
    );
  });
});
