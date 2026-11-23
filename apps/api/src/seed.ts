/**
 * Dev / test fixtures, written through the repository layer so they work on either backend.
 * Refuses to run in production. Secrets (MFA seed, NFC UIDs) are random per run and returned.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { AttendeeTier, Role } from "@synan/contracts/enums";
import type { AppContext } from "./app.js";
import { API_BRAND, devEmail } from "./brand.js";
import { hashPassword, newTotpSecret } from "./lib/crypto.js";
import { nfcIdentifier } from "./domain/scan-service.js";
import type { CheckpointRow, RoomRow } from "./repo/types.js";

export interface SeedAttendee {
  id: string;
  email: string | null;
  registrationId: string;
  credentialId: string;
  /** Raw NFC UID of the bound band (hex). */
  uid: string;
  tier: AttendeeTier;
}

export type CheckpointKey = "mainIn" | "mainOut" | "eastIn" | "auditorium" | "expo" | "vip" | "boardroom" | "press";

export interface SeedResult {
  orgId: string;
  venueId: string;
  eventId: string;
  eventSlug: string;
  publishedEventSlug: string;
  publishedEventId: string;
  privateEventSlug: string;
  privateEventId: string;
  draftEventSlug: string;
  zones: { ground: string; upper: string };
  rooms: { auditorium: string; expo: string; vip: string; boardroom: string; press: string };
  checkpoints: Record<CheckpointKey, string>;
  password: string;
  users: { admin: string; organiser: string; gate2: string; speaker: string };
  emails: { admin: string; organiser: string; gate: string; gate2: string };
  /** One security-staff user per checkpoint (assignments may not overlap per person, 01 §3). */
  gates: Record<CheckpointKey, { id: string; email: string }>;
  /** checkpoint id → gate user email. */
  gateEmailByCheckpoint: Record<string, string>;
  adminMfaSecret: string;
  attendees: { vip: SeedAttendee; ordinary: SeedAttendee; privateInvite: SeedAttendee; publicTier: SeedAttendee; ordinary2: SeedAttendee };
  stockUid: string;
}

const uid = () => randomBytes(7).toString("hex").toUpperCase();

export async function seedDev(app: AppContext): Promise<SeedResult> {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to seed dev fixtures in production");
  const fx = app.repos.fixtures;
  const now = app.clock.now();
  const H = 3600_000;
  const password = process.env.DEV_SEED_PASSWORD || API_BRAND.dev.defaultPassword;
  const pwHash = await hashPassword(password, 12); // low cost for fixtures only

  const orgId = randomUUID();
  await fx.organization({ id: orgId, name: API_BRAND.dev.orgName, timezone: "Africa/Kampala", support_email: devEmail("support") });
  const venueId = randomUUID();
  await fx.venue({ id: venueId, org_id: orgId, name: "Harbour Hall", address: "1 Quay Street", timezone: "Africa/Kampala", city: "Kampala" });

  const zones = { ground: randomUUID(), upper: randomUUID() };
  await fx.zone({ id: zones.ground, venue_id: venueId, name: "Ground", floor: "0", geometry_jsonb: null });
  await fx.zone({ id: zones.upper, venue_id: venueId, name: "Level 1", floor: "1", geometry_jsonb: null });

  const room = async (name: string, zone: string, capacity: number, extra: Partial<RoomRow> = {}): Promise<string> => {
    const id = randomUUID();
    await fx.room({
      id, venue_id: venueId, zone_id: zone, name, capacity, warn_at_pct: 85, block_at_pct: 100,
      continuous_bool: false, capacity_policy: "block", geometry_jsonb: null, ...extra,
    });
    return id;
  };
  const rooms = {
    auditorium: await room("Main Auditorium", zones.ground, 200),
    expo: await room("Expo Hall", zones.ground, 500, { continuous_bool: true }),
    vip: await room("VIP Lounge", zones.upper, 40),
    boardroom: await room("Boardroom", zones.upper, 3),
    press: await room("Press Room", zones.upper, 2, { capacity_policy: "admit_with_alert" }),
  };

  const cp = async (label: string, zone: string, roomId: string | null, direction: CheckpointRow["direction"], perimeter: boolean) => {
    const id = randomUUID();
    await fx.checkpoint({ id, venue_id: venueId, zone_id: zone, room_id: roomId, direction, perimeter_bool: perimeter, hardware_id: null, label });
    return id;
  };
  const checkpoints: Record<CheckpointKey, string> = {
    mainIn: await cp("Main Entrance", zones.ground, null, "in", true),
    mainOut: await cp("Main Exit", zones.ground, null, "out", true),
    eastIn: await cp("East Entrance", zones.ground, null, "in", true),
    auditorium: await cp("Auditorium Doors", zones.ground, rooms.auditorium, "both", false),
    expo: await cp("Expo Doors", zones.ground, rooms.expo, "in", false),
    vip: await cp("VIP Lounge Door", zones.upper, rooms.vip, "in", false),
    boardroom: await cp("Boardroom Door", zones.upper, rooms.boardroom, "in", false),
    press: await cp("Press Room Door", zones.upper, rooms.press, "in", false),
  };
  // Impossible travel: East Entrance → VIP Lounge Door takes at least 5 minutes.
  await fx.transitTime({ venue_id: venueId, from_checkpoint_id: checkpoints.eastIn, to_checkpoint_id: checkpoints.vip, min_seconds: 300 });

  const event = async (slug: string, title: string, state: "draft" | "published" | "live", listed: boolean, startOff: number, endOff: number) => {
    const id = randomUUID();
    await fx.event({
      id, org_id: orgId, venue_id: venueId, slug, title, description: `${title} at Harbour Hall.`,
      starts_at: new Date(now + startOff), ends_at: new Date(now + endOff), timezone: "Africa/Kampala",
      state, listed_bool: listed, grace_buffer: 72,
    });
    return id;
  };
  const eventId = await event(API_BRAND.dev.liveEventSlug, API_BRAND.dev.liveEventTitle, "live", true, -1 * H, 8 * H);
  const publishedEventId = await event("future-summit", "Future Summit", "published", true, 72 * H, 80 * H);
  const privateEventId = await event("private-roundtable", "Private Roundtable", "published", false, 24 * H, 26 * H);
  await event("draft-planning", "Draft Planning Day", "draft", true, 200 * H, 208 * H);
  for (const r of Object.values(rooms)) await fx.eventRoom({ event_id: eventId, room_id: r, capacity_override: null });
  await fx.eventRoom({ event_id: publishedEventId, room_id: rooms.auditorium, capacity_override: 150 });
  await fx.eventRoom({ event_id: privateEventId, room_id: rooms.boardroom, capacity_override: null });
  await fx.session({ id: randomUUID(), event_id: eventId, room_id: rooms.auditorium, title: "Opening Keynote", starts_at: new Date(now), ends_at: new Date(now + 1 * H) });

  // Tier × room matrix (01 §4).
  const permit = async (subjectKind: "tier" | "role", subject: AttendeeTier | Role, roomIds: string[]) => {
    for (const roomId of roomIds) {
      await fx.accessRule({ id: randomUUID(), event_id: eventId, subject_kind: subjectKind, subject, room_id: roomId, window_start: null, window_end: null, effect: "permit" });
    }
  };
  await permit("tier", "VIP", Object.values(rooms));
  await permit("tier", "ORDINARY", [rooms.auditorium, rooms.expo, rooms.boardroom, rooms.press]);
  await permit("tier", "PRIVATE_INVITE", [rooms.press, rooms.boardroom]);
  await permit("tier", "PUBLIC", [rooms.expo]);
  await permit("role", "speaker", Object.values(rooms));

  // Operators and staff.
  const user = async (email: string, role: Role, mfaSecret: string | null = null) => {
    const id = randomUUID();
    await app.repos.users.insert({ id, email, password_hash: pwHash, role, mfa_enrolled_at: mfaSecret ? new Date(now) : null, mfa_secret: mfaSecret });
    return id;
  };
  const adminMfaSecret = newTotpSecret();
  const emails = { admin: devEmail("admin"), organiser: devEmail("organiser"), gate: devEmail("gate"), gate2: devEmail("gate2") };
  const users = {
    admin: await user(emails.admin, "admin", adminMfaSecret),
    organiser: await user(emails.organiser, "organiser"),
    gate2: await user(emails.gate2, "security_staff"),
    speaker: await user(devEmail("speaker"), "speaker"),
  };
  // One gate user per checkpoint for the event window; gate@ staffs the Main Entrance.
  const gates = {} as Record<CheckpointKey, { id: string; email: string }>;
  const gateEmailByCheckpoint: Record<string, string> = {};
  for (const [key, checkpointId] of Object.entries(checkpoints) as [CheckpointKey, string][]) {
    const email = key === "mainIn" ? emails.gate : devEmail(`gate-${key.toLowerCase()}`);
    const id = await user(email, "security_staff");
    gates[key] = { id, email };
    gateEmailByCheckpoint[checkpointId] = email;
    await fx.staffAssignment({ id: randomUUID(), user_id: id, checkpoint_id: checkpointId, shift_start: new Date(now - 2 * H), shift_end: new Date(now + 10 * H) });
  }
  // gate2: Main Entrance, but the shift is already over.
  await fx.staffAssignment({ id: randomUUID(), user_id: users.gate2, checkpoint_id: checkpoints.mainIn, shift_start: new Date(now - 6 * H), shift_end: new Date(now - 3 * H) });

  // Attendees, registrations, credentials, bound bands.
  const attendee = async (email: string | null, name: string | null, tier: AttendeeTier, onEvent = eventId): Promise<SeedAttendee> => {
    const id = randomUUID();
    await app.repos.attendees.insert({ id, user_id: null, email, full_name: name, profile_jsonb: {} });
    const registrationId = randomUUID();
    await fx.registration({
      id: registrationId, event_id: onEvent, attendee_id: id, tier, state: "confirmed",
      zone_presence_consent_at: new Date(now), checked_in_at: null, created_at: new Date(now),
    });
    const cred = await app.credentials.issueForRegistration(registrationId);
    const bandUid = uid();
    await app.repos.carriers.insert({
      id: randomUUID(), credential_id: cred.id, kind: "nfc", identifier: nfcIdentifier(bandUid),
      chip_profile: tier === "VIP" || tier === "PRIVATE_INVITE" ? "ntag424_dna" : "ntag_uid",
      state: "bound", bound_at: new Date(now), redeemed_at: null,
    });
    return { id, email, registrationId, credentialId: cred.id, uid: bandUid, tier };
  };
  const attendees = {
    vip: await attendee(devEmail("vip"), "Vera Ip", "VIP"),
    ordinary: await attendee(devEmail("ordinary"), "Orla Dinary", "ORDINARY"),
    privateInvite: await attendee(devEmail("private"), "Priya Vate", "PRIVATE_INVITE"),
    publicTier: await attendee(null, null, "PUBLIC"),
    ordinary2: await attendee(devEmail("ordinary2"), "Owen Dinary", "ORDINARY"),
  };
  // The private-invite attendee is also registered for the unlisted roundtable.
  await fx.registration({
    id: randomUUID(), event_id: privateEventId, attendee_id: attendees.privateInvite.id, tier: "PRIVATE_INVITE",
    state: "confirmed", zone_presence_consent_at: new Date(now), checked_in_at: null, created_at: new Date(now),
  });

  const stockUid = uid();
  await app.repos.carriers.insert({
    id: randomUUID(), credential_id: null, kind: "nfc", identifier: nfcIdentifier(stockUid),
    chip_profile: "ntag_uid", state: "stock", bound_at: null, redeemed_at: null,
  });

  return {
    orgId, venueId, eventId, eventSlug: API_BRAND.dev.liveEventSlug, publishedEventSlug: "future-summit", publishedEventId,
    privateEventSlug: "private-roundtable", privateEventId, draftEventSlug: "draft-planning",
    zones, rooms, checkpoints, password, users, emails, gates, gateEmailByCheckpoint, adminMfaSecret, attendees, stockUid,
  };
}
