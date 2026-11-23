import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setVaultScope } from "../src/client";
import { createCipher, devKeyProvider } from "../src/crypto/index";
import { encryptAttendeeColumns } from "../src/secrets";
import * as s from "../src/schema/index";
import type { TestDb } from "./helpers";

export interface MiniVenue {
  orgId: string;
  venueId: string;
  zoneId: string;
  roomA: string;
  roomB: string;
  /** Room A: in door, out door. Room B: in door, both-direction door. Perimeter: in gate (no room). */
  cpAin: string;
  cpAout: string;
  cpBin: string;
  cpBboth: string;
  cpPerimeter: string;
  eventId: string;
}

/** One org, one venue, one zone, rooms A (cap 10) and B (cap 4), five checkpoints, one live event. */
export async function miniVenue(db: TestDb, opts: { eventState?: "draft" | "live" | "closed" } = {}): Promise<MiniVenue> {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: "Org", timezone: "Europe/London", support_email: "ops@example.test" })
    .returning();
  const [venue] = await db
    .insert(s.venues)
    .values({ org_id: org!.id, name: "Hall", timezone: "Europe/London" })
    .returning();
  const [zone] = await db.insert(s.zones).values({ venue_id: venue!.id, name: "Ground", floor: "G" }).returning();
  const [roomA, roomB] = await db
    .insert(s.rooms)
    .values([
      { venue_id: venue!.id, zone_id: zone!.id, name: "Room A", capacity: 10 },
      { venue_id: venue!.id, zone_id: zone!.id, name: "Room B", capacity: 4, warn_at_pct: 50, block_at_pct: 100 },
    ])
    .returning();
  const cps = await db
    .insert(s.checkpoints)
    .values([
      { venue_id: venue!.id, zone_id: zone!.id, room_id: roomA!.id, direction: "in", label: "A in" },
      { venue_id: venue!.id, zone_id: zone!.id, room_id: roomA!.id, direction: "out", label: "A out" },
      { venue_id: venue!.id, zone_id: zone!.id, room_id: roomB!.id, direction: "in", label: "B in" },
      { venue_id: venue!.id, zone_id: zone!.id, room_id: roomB!.id, direction: "both", label: "B both" },
      { venue_id: venue!.id, zone_id: zone!.id, direction: "in", perimeter_bool: true, label: "Main gate" },
    ])
    .returning();
  const [event] = await db
    .insert(s.events)
    .values({
      org_id: org!.id,
      venue_id: venue!.id,
      slug: `ev-${randomUUID().slice(0, 8)}`,
      title: "Event",
      starts_at: new Date("2026-12-01T09:00:00Z"),
      ends_at: new Date("2026-12-01T18:00:00Z"),
      timezone: "Europe/London",
      state: opts.eventState ?? "live",
      pass_template_jsonb: { layout: "default" },
    })
    .returning();
  await db.insert(s.event_rooms).values([
    { event_id: event!.id, room_id: roomA!.id },
    { event_id: event!.id, room_id: roomB!.id },
  ]);
  return {
    orgId: org!.id,
    venueId: venue!.id,
    zoneId: zone!.id,
    roomA: roomA!.id,
    roomB: roomB!.id,
    cpAin: cps[0]!.id,
    cpAout: cps[1]!.id,
    cpBin: cps[2]!.id,
    cpBboth: cps[3]!.id,
    cpPerimeter: cps[4]!.id,
    eventId: event!.id,
  };
}

/** The fixed development cipher used by every fixture (enforcement is on: no plaintext identity). */
export const devCipher = await createCipher(devKeyProvider());
/** Settled formats: credential reference (22 base64url) and hashes (43 base64url) / blind index (64 hex). */
export const credentialRef = () => randomBytes(16).toString("base64url");
export const b64Hash = (v: string = randomUUID()) => createHash("sha256").update(v).digest("base64url");
export const hexIndex = (v: string = randomUUID()) => createHash("sha256").update(v).digest("hex");

/** Creates an attendee + confirmed registration + active credential + ephemeral id. */
export async function attendeeWithCredential(
  db: TestDb,
  eventId: string,
  tier: (typeof s.attendeeTier.enumValues)[number] = "ORDINARY",
) {
  return db.transaction(async (tx) => {
    await setVaultScope(tx, "system");
    const id = randomUUID();
    const [att] = await tx.insert(s.attendees).values({ id, ...encryptAttendeeColumns(devCipher, id, { full_name: "Test Person" }) }).returning();
    const [reg] = await tx
      .insert(s.registrations)
      .values({ event_id: eventId, attendee_id: att!.id, tier, state: "confirmed" })
      .returning();
    const [cred] = await tx
      .insert(s.credentials)
      .values({ registration_id: reg!.id, token_hash: credentialRef(), state: "active" })
      .returning();
    const [eph] = await tx
      .insert(s.ephemeral_ids)
      .values({ event_id: eventId, credential_id: cred!.id })
      .returning();
    return { attendeeId: att!.id, registrationId: reg!.id, credentialId: cred!.id, ephemeralId: eph!.ephemeral_id };
  });
}

let idem = 0;
/** Inserts one scan. `at` is the device time; `offsetMs` the device clock offset. */
export async function scan(
  db: TestDb,
  v: { eventId: string },
  checkpointId: string,
  ephemeralId: string | null,
  result: (typeof s.scanResult.enumValues)[number],
  at: string,
  extra: Partial<typeof s.scans.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.scans)
    .values({
      event_id: v.eventId,
      checkpoint_id: checkpointId,
      ephemeral_id: ephemeralId,
      carrier_kind: "nfc",
      result,
      occurred_at: new Date(at),
      idem_key: `idem-key-${++idem}-${randomUUID()}`,
      ...extra,
    })
    .returning();
  return row!;
}
