/**
 * The operator-scale seed (docs/02 §8): 2 venues, 60 rooms, 1,400 attendees,
 * 40,000 scans. Deterministic for a given seed. Generated on demand and exported
 * from `@synan/mock/seed` only, so the Attendee Portal never bundles it.
 */
import { createRng, int, pick, uuidFrom, type Rng } from "./random";
import type {
  AttendeeTier,
  Checkpoint,
  CredentialState,
  Room,
  ScanRecord,
  ScanResult,
  Venue,
  Zone,
} from "./types";

export interface SeedAttendee {
  id: string;
  registration_id: string;
  tier: AttendeeTier;
  credential_state: CredentialState;
  /** Fictional; never a real person. */
  full_name: string;
}

export interface Seed {
  orgId: string;
  eventId: string;
  venues: Venue[];
  zones: Zone[];
  rooms: Room[];
  checkpoints: Checkpoint[];
  attendees: SeedAttendee[];
  scans: ScanRecord[];
}

export interface SeedOptions {
  seed?: number;
  venues?: number;
  roomsPerVenue?: number;
  attendees?: number;
  scans?: number;
  /** Scans are spread over the hours before this instant. */
  until?: string;
}

const FIRST = ["Amara", "Brian", "Grace", "Joseph", "Ruth", "Samuel", "Esther", "Daniel", "Aisha", "Peter", "Naledi", "Tendai"];
const LAST = ["Okello", "Nakato", "Mugisha", "Achieng", "Kato", "Namubiru", "Otieno", "Wanjiru", "Banda", "Mensah"];
const ROOM_KINDS = ["Hall", "Studio", "Lounge", "Room", "Gallery", "Terrace"];

function tierFor(rng: Rng): AttendeeTier {
  const roll = rng();
  if (roll < 0.06) return "VIP";
  if (roll < 0.1) return "PRIVATE_INVITE";
  if (roll < 0.25) return "PUBLIC";
  return "ORDINARY";
}

function resultFor(rng: Rng): ScanResult {
  const roll = rng();
  if (roll < 0.86) return "admitted";
  if (roll < 0.92) return "already_inside";
  if (roll < 0.95) return "duplicate_read";
  if (roll < 0.97) return "implied_exit";
  if (roll < 0.98) return "denied_room";
  if (roll < 0.985) return "capacity_block";
  if (roll < 0.99) return "wristband_required";
  if (roll < 0.995) return "unknown_token";
  return "pass_spent";
}

export function generateSeed(options: SeedOptions = {}): Seed {
  const {
    seed = 20261122,
    venues: venueCount = 2,
    roomsPerVenue = 30,
    attendees: attendeeCount = 1400,
    scans: scanCount = 40_000,
    until = "2026-11-22T12:00:00.000Z",
  } = options;
  const rng = createRng(seed);
  const id = () => uuidFrom(rng);
  const orgId = id();
  const eventId = id();

  const venues: Venue[] = [];
  const zones: Zone[] = [];
  const rooms: Room[] = [];
  const checkpoints: Checkpoint[] = [];

  for (let v = 0; v < venueCount; v++) {
    const venue: Venue = { id: id(), org_id: orgId, name: v === 0 ? "Nexus Hall" : "Serena Conference Centre", address: "Kampala", timezone: "Africa/Kampala" };
    venues.push(venue);
    const venueZones: Zone[] = ["Ground", "Level 1", "Level 2"].map((floor) => ({
      id: id(),
      venue_id: venue.id,
      name: floor,
      floor,
      geometry: null,
    }));
    zones.push(...venueZones);

    for (let r = 0; r < roomsPerVenue; r++) {
      const zone = venueZones[r % venueZones.length] as Zone;
      const room: Room = {
        id: id(),
        venue_id: venue.id,
        zone_id: zone.id,
        name: `${pick(rng, ROOM_KINDS)} ${r + 1}`,
        capacity: pick(rng, [24, 40, 60, 80, 120, 200, 400, 800]),
        warn_at_pct: 85,
        block_at_pct: 100,
        continuous: rng() < 0.15,
        capacity_policy: "block",
        geometry: null,
      };
      rooms.push(room);
      checkpoints.push({
        id: id(),
        venue_id: venue.id,
        zone_id: zone.id,
        room_id: room.id,
        direction: "in",
        perimeter: false,
        hardware_id: `RDR-${v}${String(r).padStart(3, "0")}`,
        label: `${room.name} door`,
      });
    }
    for (let g = 0; g < 4; g++) {
      checkpoints.push({
        id: id(),
        venue_id: venue.id,
        zone_id: (venueZones[0] as Zone).id,
        room_id: null,
        direction: g === 3 ? "out" : "in",
        perimeter: true,
        hardware_id: null,
        label: `Gate ${g + 1}`,
      });
    }
  }

  const attendees: SeedAttendee[] = Array.from({ length: attendeeCount }, () => {
    const roll = rng();
    return {
      id: id(),
      registration_id: id(),
      tier: tierFor(rng),
      credential_state: roll < 0.012 ? "revoked" : roll < 0.015 ? "suspended_review" : roll < 0.02 ? "replaced" : "active",
      full_name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
    };
  });

  const end = Date.parse(until);
  const span = 6 * 60 * 60 * 1000;
  const scans: ScanRecord[] = Array.from({ length: scanCount }, (_, i) => {
    const occurred = end - span + Math.floor((i / scanCount) * span) + int(rng, 0, 400);
    const checkpoint = pick(rng, checkpoints);
    const offline = rng() < 0.03;
    return {
      id: id(),
      event_id: eventId,
      checkpoint_id: checkpoint.id,
      ephemeral_id: `e${int(rng, 0, attendeeCount - 1).toString(36)}`,
      carrier_kind: checkpoint.perimeter ? pick(rng, ["qr_portal", "qr_email", "nfc"] as const) : "nfc",
      result: resultFor(rng),
      occurred_at: new Date(occurred).toISOString(),
      received_at: new Date(occurred + (offline ? int(rng, 30_000, 600_000) : int(rng, 40, 300))).toISOString(),
      clock_offset_ms: offline ? int(rng, -2000, 2000) : 0,
      offline,
    };
  });

  return { orgId, eventId, venues, zones, rooms, checkpoints, attendees, scans };
}
