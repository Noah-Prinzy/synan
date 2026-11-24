/**
 * Deterministic demo dataset (docs/02-architecture.md §8 scale direction):
 * 1 organisation, 2 venues, 5 zones, 60 rooms, 78 checkpoints, 3 events, 1,400 attendees across
 * the four tiers, ~7–8k scans (a sample, not the full 40k), sessions, access matrix, credentials and
 * carriers, staff and shifts, occupancy corrections, alerts, audit entries, and rebuilt rollups.
 *
 *   Event 1 "Northern Lights Summit"  live, venue 1, all 36 rooms, ~1,000 checked in
 *   Event 2 "Harbour Partner Roundtable" published, unlisted (Private Invitation), venue 2, next week
 *   Event 3 "Autumn Expo"             closed 5 days ago at venue 1 — past its 72 h grace period, so
 *                                     purge_event_movement_data() can be demonstrated on it
 *
 * Same `seed` + same `now` ⇒ same rows (except signing keys, which are freshly generated).
 * Dev data only: emails are plaintext (production stores an encrypted envelope), password hashes and
 * the signing keys' private halves are NOT usable secrets.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { setVaultScope, type AnyDb, type AnyTx } from "../client";
import { createCipher, devKeyProvider, type Cipher } from "../crypto/index";
import { encryptAttendeeColumns, encryptMfaSecret, encryptSigningPrivateKey, encryptUserEmail } from "../secrets";
import * as s from "../schema/index";

export interface SeedOptions {
  /** Wall clock the dataset is built around. Default: now, floored to the minute. */
  now?: Date;
  /** PRNG seed. */
  seed?: number;
  /** Encrypts identity, MFA secrets and signing keys. Default: the fixed development keys (devKeyProvider). */
  cipher?: Cipher;
}

export interface SeedSummary {
  /** Row count per table after seeding. */
  counts: Record<string, number>;
  events: { live: string; published: string; closed: string };
  now: Date;
}

type Tier = (typeof s.attendeeTier.enumValues)[number];
type RoomType =
  | "auditorium" | "expo" | "plaza" | "community" | "concourse" | "breakout"
  | "vip_lounge" | "vip_keynote" | "backstage" | "press" | "sponsor" | "roundtable";

const TIER_ACCESS: Record<RoomType, Tier[]> = {
  auditorium: ["VIP", "ORDINARY", "PRIVATE_INVITE"],
  breakout: ["VIP", "ORDINARY", "PRIVATE_INVITE"],
  concourse: ["VIP", "ORDINARY", "PRIVATE_INVITE"],
  expo: ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"],
  plaza: ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"],
  community: ["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"],
  vip_lounge: ["VIP"],
  vip_keynote: ["VIP"],
  backstage: ["VIP"],
  press: ["VIP", "PRIVATE_INVITE"],
  sponsor: ["VIP", "PRIVATE_INVITE"],
  roundtable: ["VIP", "PRIVATE_INVITE"],
};
const SPEAKER_ROOMS: RoomType[] = ["auditorium", "vip_keynote", "backstage", "breakout"];
const CONTINUOUS: RoomType[] = ["expo", "plaza", "concourse", "vip_lounge"];
const SESSION_ROOMS: RoomType[] = ["auditorium", "breakout", "vip_keynote", "community", "roundtable", "press"];

const VENUE_1: [zone: string, floor: string, rooms: [string, RoomType, number][]][] = [
  ["Ground Floor", "G", [
    ["Main Auditorium", "auditorium", 900], ["Expo Hall A", "expo", 1200], ["Expo Hall B", "expo", 800],
    ["Public Plaza", "plaza", 1500], ["Community Stage", "community", 250], ["Concourse Café", "concourse", 300],
    ["Breakout G1", "breakout", 120], ["Breakout G2", "breakout", 120], ["Breakout G3", "breakout", 100],
    ["Breakout G4", "breakout", 100], ["Press Briefing Room", "press", 40], ["Backstage Main", "backstage", 40],
  ]],
  ["Level 1", "1", [
    ["Auditorium 2", "auditorium", 450], ["Breakout 1.1", "breakout", 150], ["Breakout 1.2", "breakout", 150],
    ["Breakout 1.3", "breakout", 120], ["Breakout 1.4", "breakout", 120], ["Breakout 1.5", "breakout", 100],
    ["Breakout 1.6", "breakout", 100], ["Breakout 1.7", "breakout", 80], ["Breakout 1.8", "breakout", 80],
    ["VIP Lounge", "vip_lounge", 60], ["Sponsor Suite A", "sponsor", 50], ["Speaker Green Room", "backstage", 30],
  ]],
  ["Level 2", "2", [
    ["Keynote Theatre", "auditorium", 600], ["VIP Keynote Studio", "vip_keynote", 120],
    ["Breakout 2.1", "breakout", 120], ["Breakout 2.2", "breakout", 120], ["Breakout 2.3", "breakout", 90],
    ["Breakout 2.4", "breakout", 90], ["Breakout 2.5", "breakout", 70], ["Breakout 2.6", "breakout", 70],
    ["Roundtable 1", "roundtable", 24], ["Roundtable 2", "roundtable", 24], ["Sponsor Suite B", "sponsor", 50],
    ["Rooftop VIP Terrace", "vip_lounge", 80],
  ]],
];
const VENUE_2: typeof VENUE_1 = [
  ["Harbour Ground", "G", [
    ["Harbour Hall", "auditorium", 700], ["Harbour Expo Floor", "expo", 1000], ["Harbour Open Plaza", "plaza", 1200],
    ["Harbour Community Stage", "community", 200], ["Breakout H1", "breakout", 90], ["Breakout H2", "breakout", 90],
    ["Breakout H3", "breakout", 80], ["Breakout H4", "breakout", 80], ["Breakout H5", "breakout", 60],
    ["Breakout H6", "breakout", 60], ["Harbour Press Room", "press", 30], ["Harbour Backstage", "backstage", 30],
  ]],
  ["Mezzanine", "M", [
    ["Roundtable M1", "roundtable", 20], ["Roundtable M2", "roundtable", 20], ["Roundtable M3", "roundtable", 20],
    ["Roundtable M4", "roundtable", 20], ["Sponsor Suite M1", "sponsor", 40], ["Sponsor Suite M2", "sponsor", 40],
    ["Mezzanine VIP Lounge", "vip_lounge", 50], ["Board Room", "roundtable", 16], ["Breakout M1", "breakout", 60],
    ["Breakout M2", "breakout", 60], ["Breakout M3", "breakout", 60], ["Breakout M4", "breakout", 60],
  ]],
];

const FIRST = ["Amara", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hiro", "Isla", "Jonas", "Kemi", "Liam", "Maya",
  "Noah", "Olu", "Priya", "Quinn", "Rosa", "Sami", "Tara", "Umar", "Vera", "Wes", "Xin", "Yara", "Zane", "Aisha", "Bruno",
  "Carla", "Dmitri", "Esme", "Farid", "Greta", "Hamza", "Ines", "Jae", "Kofi", "Lena", "Mateo", "Nia"];
const LAST = ["Adeyemi", "Brennan", "Castillo", "Dubois", "Eriksen", "Fischer", "Gupta", "Hassan", "Ito", "Jensen", "Kowalski",
  "Larsen", "Mensah", "Novak", "Okafor", "Petrov", "Quinlan", "Rossi", "Sato", "Tanaka", "Uddin", "Varga", "Walsh", "Xu",
  "Yilmaz", "Zhang", "Abbott", "Byrne", "Costa", "Diallo"];
const COMPANIES = ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Litware", "Adatum", "Proseware", "Wingtip", "Fourth Coffee", "Lucerne"];
const ROLES = ["Engineer", "Producer", "Director", "Analyst", "Founder", "Designer", "Researcher", "Manager"];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inserts in chunks that stay under Postgres' 65,535 bind-parameter limit. */
async function insertMany<T extends PgTable>(tx: AnyTx, table: T, rows: T["$inferInsert"][], chunk = 400) {
  for (let i = 0; i < rows.length; i += chunk) await tx.insert(table).values(rows.slice(i, i + chunk) as never);
}

export async function seed(db: AnyDb, options: SeedOptions = {}): Promise<SeedSummary> {
  const now = Math.floor((options.now ?? new Date()).getTime() / MIN) * MIN;
  const rng = mulberry32(options.seed ?? 20261123);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const chance = (p: number) => rng() < p;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)]!;
  const hex = (bytes: number) => Array.from({ length: bytes }, () => int(0, 255).toString(16).padStart(2, "0")).join("");
  const uuid = () => {
    const h = hex(16).split("");
    h[12] = "4";
    h[16] = "89ab"[int(0, 3)]!;
    const x = h.join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  };
  // Settled formats: hashes are base64url SHA-256 (43); the credential reference is 16 random bytes (22).
  const sha = (v: string) => createHash("sha256").update(v).digest("base64url");
  const credentialRef = () => Buffer.from(hex(16), "hex").toString("base64url");
  const cipher = options.cipher ?? (await createCipher(devKeyProvider()));
  const blind = (email: string) => cipher.blindIndex(email);
  const d = (ms: number) => new Date(ms);

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: s.organizations.id }).from(s.organizations).limit(1);
    if (existing.length > 0) throw new Error("seed: database already has data; run it on an empty, migrated database");
    await setVaultScope(tx, "system");

    /* ----------------------------------------------------------- organisation, venues */
    const orgId = uuid();
    await tx.insert(s.organizations).values({ id: orgId, name: "Demo Events Org", timezone: "Europe/London", support_email: "support@org.example.test" });

    interface RoomInfo { id: string; venue: number; zoneId: string; name: string; type: RoomType; capacity: number; inCp: string; outCp: string; both: boolean }
    const venueIds = [uuid(), uuid()];
    const zones: (typeof s.zones.$inferInsert)[] = [];
    const rooms: (typeof s.rooms.$inferInsert)[] = [];
    const checkpoints: (typeof s.checkpoints.$inferInsert)[] = [];
    const roomInfo: RoomInfo[] = [];
    const perimeter: { venue: number; id: string; dir: "in" | "out" | "both"; label: string }[] = [];
    const groundZone: string[] = [];

    await tx.insert(s.venues).values([
      { id: venueIds[0]!, org_id: orgId, name: "Riverside Convention Centre", address: "1 Riverside Walk, London", city: "London", timezone: "Europe/London" },
      { id: venueIds[1]!, org_id: orgId, name: "Harbour Exhibition Hall", address: "12 Quay Street, Bristol", city: "Bristol", timezone: "Europe/London" },
    ]);
    for (const [vi, layout] of [VENUE_1, VENUE_2].entries()) {
      const venueId = venueIds[vi]!;
      let hw = 0;
      for (const [zi, [zoneName, floor, roomSpecs]] of layout.entries()) {
        const zoneId = uuid();
        if (zi === 0) groundZone[vi] = zoneId;
        zones.push({ id: zoneId, venue_id: venueId, name: zoneName, floor, geometry_jsonb: { kind: "rect", x: 0, y: zi * 100, w: 400, h: 90 } });
        for (const [ri, [name, type, capacity]] of roomSpecs.entries()) {
          const roomId = uuid();
          rooms.push({
            id: roomId, venue_id: venueId, zone_id: zoneId, name, capacity,
            continuous_bool: CONTINUOUS.includes(type),
            capacity_policy: type === "plaza" || type === "expo" ? "admit_with_alert" : "block",
            geometry_jsonb: { kind: "rect", x: (ri % 6) * 65, y: zi * 100 + Math.floor(ri / 6) * 45, w: 60, h: 40 },
          });
          const both = capacity < 300;
          const inCp = uuid();
          const outCp = both ? inCp : uuid();
          // Doors sit on the bottom edge of the room's rectangle (same grid units as its geometry).
          const rx = (ri % 6) * 65;
          const ry = zi * 100 + Math.floor(ri / 6) * 45;
          checkpoints.push({ id: inCp, venue_id: venueId, zone_id: zoneId, room_id: roomId, direction: both ? "both" : "in", label: both ? `${name} door` : `${name} in`, hardware_id: `RDR-${vi + 1}-${String(++hw).padStart(3, "0")}`, position_jsonb: { x: rx + (both ? 30 : 20), y: ry + 40, side: "s" } });
          if (!both) checkpoints.push({ id: outCp, venue_id: venueId, zone_id: zoneId, room_id: roomId, direction: "out", label: `${name} out`, hardware_id: `RDR-${vi + 1}-${String(++hw).padStart(3, "0")}`, position_jsonb: { x: rx + 40, y: ry + 40, side: "s" } });
          roomInfo.push({ id: roomId, venue: vi, zoneId, name, type, capacity, inCp, outCp, both });
        }
      }
      const gates: [string, "in" | "out" | "both"][] =
        vi === 0
          ? [["Main Gate 1", "in"], ["Main Gate 2", "in"], ["Exit Gate 1", "out"], ["Exit Gate 2", "out"], ["Provisioning Desk", "both"]]
          : [["Harbour Gate", "in"], ["Harbour Exit", "out"], ["Harbour Desk", "both"]];
      for (const [gi, [label, dir]] of gates.entries()) {
        const id = uuid();
        // Perimeter gates on the west edge of the ground-floor zone.
        checkpoints.push({ id, venue_id: venueId, zone_id: groundZone[vi]!, direction: dir, perimeter_bool: true, label, last_heartbeat_at: d(now - int(2, 40) * 1000), last_clock_offset_ms: int(-300, 300), position_jsonb: { x: 0, y: 10 + gi * 15, side: "w" } });
        perimeter.push({ venue: vi, id, dir, label });
      }
    }
    await insertMany(tx, s.zones, zones);
    await insertMany(tx, s.rooms, rooms);
    await insertMany(tx, s.checkpoints, checkpoints);

    // Impossible-travel table: perimeter gates and room doors of each venue, both ways.
    const transit: (typeof s.transit_times.$inferInsert)[] = [];
    for (const vi of [0, 1]) {
      const nodes = [
        ...perimeter.filter((p) => p.venue === vi).map((p) => ({ id: p.id, zone: groundZone[vi]! })),
        ...roomInfo.filter((r) => r.venue === vi).map((r) => ({ id: r.inCp, zone: r.zoneId })),
      ];
      for (const a of nodes) for (const b of nodes) {
        if (a.id === b.id) continue;
        transit.push({ venue_id: venueIds[vi]!, from_checkpoint_id: a.id, to_checkpoint_id: b.id, min_seconds: a.zone === b.zone ? 20 : 75 });
      }
    }
    await insertMany(tx, s.transit_times, transit, 1000);

    /* ------------------------------------------------------------------ users */
    const users: (typeof s.users.$inferInsert)[] = [];
    const mkUser = (role: (typeof s.userRole.enumValues)[number], i: number) => {
      const id = uuid();
      const first = pick(FIRST);
      const last = pick(LAST);
      users.push({
        id, org_id: orgId, role, ...encryptUserEmail(cipher, id, `${role}.${i}@org.example.test`), display_name: `${first} ${last}`,
        password_hash: role === "speaker" || role === "crew" ? null : "$argon2id$v=19$seed$not-a-real-hash",
        mfa_enrolled_at: role === "admin" || role === "organiser" ? d(now - 30 * DAY) : null,
        // Development TOTP secret (base32), encrypted and bound to this user row.
        mfa_secret_enc: role === "admin" || role === "organiser"
          ? encryptMfaSecret(cipher, id, Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[int(0, 31)]).join(""))
          : null,
      });
      return id;
    };
    const admins = [0, 1].map((i) => mkUser("admin", i));
    const organisers = [0, 1, 2].map((i) => mkUser("organiser", i));
    const security = Array.from({ length: 24 }, (_, i) => mkUser("security_staff", i));
    const speakers = Array.from({ length: 12 }, (_, i) => mkUser("speaker", i));
    const crew = Array.from({ length: 10 }, (_, i) => mkUser("crew", i));
    await insertMany(tx, s.users, users);

    /* ----------------------------------------------------------------- events */
    const ev1Start = Math.floor((now - 4 * HOUR) / HOUR) * HOUR;
    const ev1End = ev1Start + 10 * HOUR;
    const ev2Start = Math.floor((now + 7 * DAY) / HOUR) * HOUR;
    const ev3Start = Math.floor((now - 6 * DAY) / HOUR) * HOUR;
    const ev3End = ev3Start + 9 * HOUR;
    const ev = { live: uuid(), published: uuid(), closed: uuid() };
    const profileSchema = [
      { key: "company", label: "Company", type: "text", required: false },
      { key: "job_title", label: "Job title", type: "text", required: false },
      { key: "dietary", label: "Dietary requirements", type: "select", required: false, options: ["none", "vegetarian", "vegan", "halal", "kosher"] },
    ];
    const passTemplate = { layout: "standard", accent: "brand", show_tier: true };
    await tx.insert(s.events).values([
      { id: ev.live, org_id: orgId, venue_id: venueIds[0]!, slug: "northern-lights-summit-2026", title: "Northern Lights Summit 2026", description: "Two-stage technology summit.", starts_at: d(ev1Start), ends_at: d(ev1End), timezone: "Europe/London", state: "live", listed_bool: true, profile_schema_jsonb: profileSchema, pass_template_jsonb: passTemplate, access_rules_version: 3 },
      { id: ev.published, org_id: orgId, venue_id: venueIds[1]!, slug: "harbour-partner-roundtable", title: "Harbour Partner Roundtable", description: "Closed-door partner briefings.", starts_at: d(ev2Start), ends_at: d(ev2Start + 6 * HOUR), timezone: "Europe/London", state: "published", listed_bool: false, profile_schema_jsonb: profileSchema, pass_template_jsonb: passTemplate, access_rules_version: 1 },
      { id: ev.closed, org_id: orgId, venue_id: venueIds[0]!, slug: "autumn-expo-2026", title: "Autumn Expo 2026", description: "Open expo weekend.", starts_at: d(ev3Start), ends_at: d(ev3End), timezone: "Europe/London", state: "closed", closed_at: d(ev3End + HOUR), listed_bool: true, profile_schema_jsonb: profileSchema, pass_template_jsonb: passTemplate, access_rules_version: 1 },
    ]);

    const v1Rooms = roomInfo.filter((r) => r.venue === 0);
    const v2Rooms = roomInfo.filter((r) => r.venue === 1);
    const ev2Rooms = v2Rooms.filter((r) => ["roundtable", "sponsor", "press", "vip_lounge", "auditorium"].includes(r.type));
    const ev3Rooms = v1Rooms.filter((r) => r.zoneId === groundZone[0] || r.name.startsWith("Breakout 1."));
    const eventRooms: Record<string, RoomInfo[]> = { [ev.live]: v1Rooms, [ev.published]: ev2Rooms, [ev.closed]: ev3Rooms };
    await insertMany(tx, s.event_rooms, Object.entries(eventRooms).flatMap(([eventId, rs]) =>
      rs.map((r) => ({ event_id: eventId, room_id: r.id, capacity_override: r.type === "community" && eventId === ev.live ? 200 : null }))));

    /* --------------------------------------------------------- sessions, resets */
    const sessions: (typeof s.sessions.$inferInsert)[] = [];
    /** "event|room" → session-end times already passed (session-end reset anchors, D-10). */
    const resets = new Map<string, number[]>();
    let keynoteWindow: [number, number] = [ev1Start, ev1End];
    for (const [eventId, start, end] of [[ev.live, ev1Start, ev1End], [ev.published, ev2Start, ev2Start + 6 * HOUR], [ev.closed, ev3Start, ev3End]] as const) {
      for (const r of eventRooms[eventId]!) {
        if (!SESSION_ROOMS.includes(r.type)) continue;
        let t = start + int(0, 2) * 15 * MIN;
        let n = 0;
        while (t + 45 * MIN <= end) {
          const len = int(4, 6) * 15 * MIN;
          const sEnd = Math.min(t + len, end);
          sessions.push({ id: uuid(), event_id: eventId, room_id: r.id, title: `${r.name} — Session ${++n}`, starts_at: d(t), ends_at: d(sEnd) });
          if (r.type === "vip_keynote" && eventId === ev.live && n === 1) keynoteWindow = [t - 15 * MIN, sEnd];
          if (eventId !== ev.published && sEnd < now && !CONTINUOUS.includes(r.type)) {
            const key = `${eventId}|${r.id}`;
            resets.set(key, [...(resets.get(key) ?? []), sEnd]);
          }
          t = sEnd + int(1, 2) * 15 * MIN;
        }
      }
    }
    await insertMany(tx, s.sessions, sessions);

    /* ------------------------------------------------------------ access rules */
    const rules: (typeof s.access_rules.$inferInsert)[] = [];
    for (const [eventId, rs] of Object.entries(eventRooms)) {
      for (const r of rs) {
        for (const tier of TIER_ACCESS[r.type]) {
          const windowed = r.type === "vip_keynote" && eventId === ev.live;
          rules.push({ id: uuid(), event_id: eventId, subject_kind: "tier", subject: tier, room_id: r.id, effect: "permit", window_start: windowed ? d(keynoteWindow[0]) : null, window_end: windowed ? d(keynoteWindow[1]) : null });
        }
        if (r.type === "vip_lounge") rules.push({ id: uuid(), event_id: eventId, subject_kind: "tier", subject: "PUBLIC", room_id: r.id, effect: "deny" });
        for (const role of ["crew", "security_staff"]) rules.push({ id: uuid(), event_id: eventId, subject_kind: "role", subject: role, room_id: r.id, effect: "permit" });
        if (SPEAKER_ROOMS.includes(r.type)) rules.push({ id: uuid(), event_id: eventId, subject_kind: "role", subject: "speaker", room_id: r.id, effect: "permit" });
      }
    }
    await insertMany(tx, s.access_rules, rules);
    const permitted = (eventId: string, r: RoomInfo, tier: Tier, t: number) =>
      TIER_ACCESS[r.type].includes(tier) && !(r.type === "vip_keynote" && eventId === ev.live && (t < keynoteWindow[0] || t > keynoteWindow[1]));

    /* ----------------------------------------------------------- signing keys */
    const keyRows = (["qr", "allowlist"] as const).map((purpose) => {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const id = uuid();
      const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32); // raw 32-byte Ed25519 key
      return {
        id, purpose, algorithm: "EdDSA",
        qr_kid: createHash("sha256").update(raw).digest("hex").slice(0, 8),
        public_key: JSON.stringify(publicKey.export({ format: "jwk" })),
        private_key_enc: encryptSigningPrivateKey(cipher, id, JSON.stringify(privateKey.export({ format: "jwk" }))),
        active_from: d(now - 14 * DAY),
      };
    });
    await tx.insert(s.signing_keys).values(keyRows);

    /* ------------------------------------------------- attendees, registrations */
    interface Person { attendeeId: string; tier: Tier; email: string | null }
    const attendees: (typeof s.attendees.$inferInsert)[] = [];
    const mkAttendee = (tier: Tier, i: number): Person => {
      const id = uuid();
      if (tier === "PUBLIC") {
        attendees.push({ id, ...encryptAttendeeColumns(cipher, id, { profile: {} }) });
        return { attendeeId: id, tier, email: null };
      }
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}.${i}@example.test`.toLowerCase();
      attendees.push({
        id,
        ...encryptAttendeeColumns(cipher, id, {
          email,
          full_name: `${first} ${last}`,
          profile: { company: pick(COMPANIES), job_title: pick(ROLES), dietary: pick(["none", "none", "none", "vegetarian", "vegan", "halal"]) },
        }),
      });
      return { attendeeId: id, tier, email };
    };
    let pi = 0;
    const ev1People: Person[] = [
      ...Array.from({ length: 110 }, () => mkAttendee("VIP", ++pi)),
      ...Array.from({ length: 880 }, () => mkAttendee("ORDINARY", ++pi)),
      ...Array.from({ length: 90 }, () => mkAttendee("PRIVATE_INVITE", ++pi)),
      ...Array.from({ length: 240 }, () => mkAttendee("PUBLIC", ++pi)),
    ];
    const ev2New: Person[] = [
      ...Array.from({ length: 60 }, () => mkAttendee("PRIVATE_INVITE", ++pi)),
      ...Array.from({ length: 20 }, () => mkAttendee("VIP", ++pi)),
    ];
    await insertMany(tx, s.attendees, attendees);

    interface Reg { id: string; eventId: string; person: Person; tier: Tier; state: (typeof s.registrationState.enumValues)[number]; createdAt: number; invitationId: string | null; checkedInAt: number | null }
    const regs: Reg[] = [];
    const invitations: (typeof s.invitations.$inferInsert)[] = [];
    const addReg = (eventId: string, person: Person, tier: Tier, createdAt: number, state: Reg["state"] = "confirmed") => {
      let invitationId: string | null = null;
      if (tier === "PRIVATE_INVITE") {
        invitationId = uuid();
        invitations.push({ id: invitationId, event_id: eventId, email_hash: blind(person.email!), token_hash: sha(hex(32)), state: "redeemed", expires_at: d(createdAt + 14 * DAY), redeemed_at: d(createdAt), created_at: d(createdAt - int(1, 5) * DAY) });
      }
      const r: Reg = { id: uuid(), eventId, person, tier, state, createdAt, invitationId, checkedInAt: null };
      regs.push(r);
      return r;
    };
    for (const p of ev1People) {
      const state = p.tier === "VIP" && chance(0.09) ? "pending_approval" : p.tier === "ORDINARY" && chance(0.017) ? "cancelled" : "confirmed";
      addReg(ev.live, p, p.tier, p.tier === "PUBLIC" ? ev1Start + int(0, 200) * MIN : ev1Start - int(2, 40) * DAY, state);
    }
    for (const p of ev2New) addReg(ev.published, p, p.tier, now - int(1, 10) * DAY);
    for (const p of ev1People.filter((x) => x.tier === "VIP").slice(0, 20)) addReg(ev.published, p, "VIP", now - int(1, 10) * DAY);
    for (const p of [...ev1People.filter((x) => x.tier === "ORDINARY").slice(0, 250), ...ev1People.filter((x) => x.tier === "VIP").slice(40, 90)]) {
      addReg(ev.closed, p, p.tier, ev3Start - int(3, 30) * DAY);
    }
    // Outstanding and expired invitations for the private event.
    for (let i = 0; i < 20; i++) {
      const expired = i >= 15;
      invitations.push({ id: uuid(), event_id: ev.published, email_hash: blind(`invitee.${i}@partner.example`), token_hash: sha(hex(32)), state: expired ? "expired" : "sent", expires_at: d(expired ? now - DAY : now + 6 * DAY), created_at: d(now - int(2, 12) * DAY) });
    }
    await insertMany(tx, s.invitations, invitations);

    /* ------------------------------------------------- credentials & simulation */
    interface Cred { id: string; reg: Reg | null; staffUserId: string | null; state: (typeof s.credentialState.enumValues)[number]; zoneState: string; issuedAt: number; revokedAt: number | null; replacedBy: string | null; ephemeral: Map<string, string> }
    const creds: Cred[] = [];
    const credByReg = new Map<string, Cred>();
    const mkCred = (reg: Reg | null, staffUserId: string | null, issuedAt: number): Cred => {
      const c: Cred = { id: uuid(), reg, staffUserId, state: "issued", zoneState: "OUTSIDE", issuedAt, revokedAt: null, replacedBy: null, ephemeral: new Map() };
      creds.push(c);
      if (reg) credByReg.set(reg.id, c);
      return c;
    };
    for (const r of regs) if (r.state === "confirmed") mkCred(r, null, r.createdAt + (r.tier === "PUBLIC" ? 0 : int(1, 30) * MIN));
    for (const u of [...security, ...speakers, ...crew]) mkCred(null, u, now - 3 * DAY);

    const carriers: (typeof s.carriers.$inferInsert)[] = [];
    /** NFC identifier: base64url SHA-256 of a 7-byte UID in uppercase hex. */
    // A band: its identifier (the hash) and its readable last four (0035).
    const bandId = () => {
      const u = "04" + hex(6).toUpperCase();
      return { identifier: sha(u), identifier_hint: u.slice(-4) };
    };
    const scans: (typeof s.scans.$inferInsert)[] = [];
    const adjustments: (typeof s.occupancy_adjustments.$inferInsert)[] = [];
    const alerts: (typeof s.breach_alerts.$inferInsert)[] = [];
    const deniedScans: { scanId: string; eventId: string; cp: string; credId: string; t: number }[] = [];
    const emailRedeemed = new Map<string, number>();
    const bandBound = new Map<string, number>();

    const ephemeralFor = (c: Cred, eventId: string) => {
      let e = c.ephemeral.get(eventId);
      if (!e) c.ephemeral.set(eventId, (e = uuid()));
      return e;
    };
    const pushScan = (
      eventId: string, cp: string, eph: string | null, kind: (typeof s.carrierKind.enumValues)[number] | null,
      result: (typeof s.scanResult.enumValues)[number], t: number, extra: Partial<typeof s.scans.$inferInsert> = {},
    ) => {
      const offset = extra.clock_offset_ms ?? int(-400, 400);
      const id = uuid();
      scans.push({
        id, event_id: eventId, checkpoint_id: cp, ephemeral_id: eph, carrier_kind: kind, result,
        occurred_at: d(t - offset), clock_offset_ms: offset, received_at: d(t + int(80, 900)),
        idem_key: hex(16), device_id: `dev-${cp.slice(0, 8)}`, ...extra,
      });
      return id;
    };
    const resetBetween = (eventId: string, roomId: string, a: number, b: number) =>
      (resets.get(`${eventId}|${roomId}`) ?? []).some((r) => r >= a && r <= b);

    /** One person's day: arrival, room visits with implied exits, taps out, noise. */
    const simulate = (eventId: string, c: Cred, rs: RoomInfo[], venue: number, from: number, until: number) => {
      const tier = c.reg!.tier;
      const eph = ephemeralFor(c, eventId);
      const gatesIn = perimeter.filter((p) => p.venue === venue && p.dir === "in");
      const gatesOut = perimeter.filter((p) => p.venue === venue && p.dir === "out");
      let t = from;
      if (tier === "PUBLIC") {
        pushScan(eventId, pick(gatesIn).id, eph, "nfc", "admitted", t);
        bandBound.set(c.id, t - int(1, 4) * MIN);
      } else {
        const kind = chance(0.2) ? "qr_email" : "qr_portal";
        pushScan(eventId, pick(gatesIn).id, eph, kind, "admitted", t);
        if (kind === "qr_email") {
          emailRedeemed.set(c.id, t);
          const again = t + int(10, 90) * MIN;
          if (chance(0.06) && again < until) pushScan(eventId, pick(gatesIn).id, eph, "qr_email", "pass_spent", again);
        }
        bandBound.set(c.id, t + int(2, 6) * MIN);
        t += 6 * MIN;
      }
      c.reg!.checkedInAt = from;
      c.state = "active";
      let zone = groundZone[venue]!;
      let current: { room: RoomInfo; cp: string; te: number } | null = null;
      t += int(5, 25) * MIN;
      const visits = int(1, 4);
      for (let i = 0; i < visits && t < until - 2 * MIN; i++) {
        const ok = rs.filter((r) => permitted(eventId, r, tier, t) && r.id !== current?.room.id);
        const no = rs.filter((r) => !permitted(eventId, r, tier, t));
        const goodVisit = chance(0.93) || no.length === 0;
        const room = goodVisit ? pick(ok) : pick(no);
        const dir = room.both ? { direction: "in" as const } : {};
        if (!goodVisit) {
          const id = pushScan(eventId, room.inCp, eph, "nfc", "denied_room", t, dir);
          deniedScans.push({ scanId: id, eventId, cp: room.inCp, credId: c.id, t });
          t += int(2, 10) * MIN;
          continue;
        }
        if (current && !resetBetween(eventId, current.room.id, current.te, t)) pushScan(eventId, current.cp, eph, "nfc", "implied_exit", t);
        pushScan(eventId, room.inCp, eph, "nfc", "admitted", t, dir);
        if (chance(0.03)) pushScan(eventId, room.inCp, eph, "nfc", "duplicate_read", t + int(2, 20) * 1000, dir);
        current = { room, cp: room.inCp, te: t };
        zone = room.zoneId;
        const stay = int(20, 70) * MIN;
        // Tap out only while still counted (a tap-out after a session-end reset would be clamped
        // and flagged as a reconciliation fault — real, but not what the demo data should show).
        if (chance(0.3) && t + stay < until && !resetBetween(eventId, room.id, t, t + stay)) {
          pushScan(eventId, room.outCp, eph, "nfc", "admitted", t + stay, room.both ? { direction: "out" } : {});
          current = null;
        }
        t += stay + int(2, 10) * MIN;
      }
      if (chance(0.015) && t < until) {
        const interior = pick(rs);
        pushScan(eventId, interior.inCp, eph, "qr_portal", "wristband_required", Math.min(t, until - MIN), interior.both ? { direction: "in" } : {});
      }
      if (chance(0.15) && t < until) {
        pushScan(eventId, pick(gatesOut).id, eph, "nfc", "admitted", t);
        c.zoneState = "OUTSIDE";
      } else {
        if (chance(0.03) && t < until) pushScan(eventId, pick(gatesIn).id, eph, "nfc", "already_inside", t);
        c.zoneState = `INSIDE_${zone}`;
      }
    };

    // Event 1 (live).
    const checkInRate: Record<Tier, number> = { VIP: 0.8, ORDINARY: 0.72, PRIVATE_INVITE: 0.75, PUBLIC: 1 };
    const ev1Creds = creds.filter((c) => c.reg?.eventId === ev.live);
    for (const c of ev1Creds) {
      if (!chance(checkInRate[c.reg!.tier])) continue;
      const arrival = c.reg!.tier === "PUBLIC" ? c.reg!.createdAt : ev1Start - 30 * MIN + int(0, Math.max(1, (now - ev1Start) / MIN - 20)) * MIN;
      simulate(ev.live, c, v1Rooms, 0, Math.min(arrival, now - 10 * MIN), now - MIN);
    }
    // Event 3 (closed).
    for (const c of creds.filter((x) => x.reg?.eventId === ev.closed)) {
      if (!chance(0.83)) continue;
      simulate(ev.closed, c, ev3Rooms, 0, ev3Start - 30 * MIN + int(0, 240) * MIN, ev3End);
    }
    for (const c of creds) if (c.reg?.eventId === ev.closed && c.state === "active") c.zoneState = "OUTSIDE";
    // Unknown and forged tokens.
    for (let i = 0; i < 45; i++) {
      const g = chance(0.6) ? pick(perimeter.filter((p) => p.venue === 0)).id : pick(v1Rooms).inCp;
      pushScan(ev.live, g, null, null, "unknown_token", ev1Start + int(0, Math.max(1, (now - ev1Start) / MIN - 2)) * MIN);
    }

    // Offline door (Breakout 1.3): device 95 s slow, offline from now-90m to now-70m, synced at now-68m.
    const offlineRoom = v1Rooms.find((r) => r.name === "Breakout 1.3")!;
    for (const row of scans) {
      if (row.checkpoint_id !== offlineRoom.inCp || row.result === "implied_exit") continue;
      const corrected = row.occurred_at!.getTime() + row.clock_offset_ms!;
      if (corrected >= now - 90 * MIN && corrected < now - 70 * MIN) {
        row.clock_offset_ms = 95_000;
        row.occurred_at = d(corrected - 95_000);
        row.offline_bool = true;
        row.local_result = row.result;
        row.received_at = d(now - 68 * MIN + int(0, 30_000));
      }
    }

    // Lost bands (P-10): band lost, credential revoked, replacement issued and a new band bound.
    const lost = ev1Creds.filter((c) => c.state === "active" && c.reg!.tier === "ORDINARY").slice(0, 4);
    const audit: { actor: string | null; action: string; target: string; meta: Record<string, unknown> }[] = [];
    for (const c of lost) {
      const tl = now - int(40, 70) * MIN;
      // The old band stops being used at the moment it is lost.
      const oldEph = c.ephemeral.get(ev.live)!;
      for (let i = scans.length - 1; i >= 0; i--) {
        const x = scans[i]!;
        if (x.ephemeral_id === oldEph && x.occurred_at!.getTime() + x.clock_offset_ms! > tl) scans.splice(i, 1);
      }
      for (let i = deniedScans.length - 1; i >= 0; i--) {
        if (deniedScans[i]!.credId === c.id && deniedScans[i]!.t > tl) deniedScans.splice(i, 1);
      }
      c.state = "replaced";
      const n = mkCred(c.reg, null, tl + 3 * MIN);
      credByReg.set(c.reg!.id, n);
      c.replacedBy = n.id;
      n.state = "active";
      n.zoneState = `INSIDE_${groundZone[0]}`;
      const desk = perimeter.find((p) => p.label === "Provisioning Desk")!;
      pushScan(ev.live, desk.id, ephemeralFor(n, ev.live), "nfc", "admitted", tl + 5 * MIN, { direction: "in" });
      if (tl + 20 * MIN < now) pushScan(ev.live, pick(v1Rooms).inCp, ephemeralFor(c, ev.live), "nfc", "revoked", tl + 20 * MIN);
      bandBound.set(n.id, tl + 4 * MIN);
      const actor = pick(organisers);
      audit.push({ actor, action: "carrier.mark_lost", target: `credential:${c.id}`, meta: { reason: "attendee reported lost band" } });
      audit.push({ actor, action: "credential.revoke", target: `credential:${c.id}`, meta: {} });
      audit.push({ actor, action: "credential.reissue", target: `credential:${n.id}`, meta: { replaces: c.id } });
      audit.push({ actor, action: "carrier.rebind", target: `credential:${n.id}`, meta: {} });
    }
    // Revoked outright (cancelled after issue) and suspended for impossible travel.
    const revoked = ev1Creds.filter((c) => c.state === "issued" && c.reg!.tier === "ORDINARY").slice(0, 3);
    for (const c of revoked) {
      c.state = "revoked";
      c.revokedAt = now - int(1, 3) * DAY;
      audit.push({ actor: pick(admins), action: "credential.revoke", target: `credential:${c.id}`, meta: { reason: "registration cancelled" } });
    }
    const suspended = ev1Creds.filter((c) => c.state === "active" && c.reg!.tier === "ORDINARY").slice(10, 13);
    for (const c of suspended) {
      c.state = "suspended_review";
      const tf = now - int(15, 45) * MIN;
      const [a, b] = [pick(perimeter.filter((p) => p.venue === 0 && p.dir === "in")), pick(v1Rooms.filter((r) => r.zoneId !== groundZone[0]))];
      if (tf + 5 * MIN < now) pushScan(ev.live, a.id, ephemeralFor(c, ev.live), "nfc", "suspended", tf + 5 * MIN);
      alerts.push({ id: uuid(), event_id: ev.live, severity: "critical", kind: "impossible_travel", checkpoint_id: b.inCp, credential_id: c.id, occurred_at: d(tf), state: "open", detail: `Scanned at ${a.label} and ${b.name} 14 s apart (minimum 75 s)` });
    }

    // Registrations (checked_in_at is known now), then credentials, carriers, ephemeral IDs.
    await insertMany(
      tx,
      s.registrations,
      regs.map((r) => ({
        id: r.id, event_id: r.eventId, attendee_id: r.person.attendeeId, tier: r.tier, state: r.state,
        zone_presence_consent_at: r.tier === "PUBLIC" || chance(0.85) ? d(r.createdAt) : null,
        invitation_id: r.invitationId, checked_in_at: r.checkedInAt ? d(r.checkedInAt) : null, created_at: d(r.createdAt),
      })),
    );
    const credRows: (typeof s.credentials.$inferInsert)[] = creds.map((c) => ({
      id: c.id, registration_id: c.reg?.id ?? null, staff_user_id: c.staffUserId, token_hash: credentialRef(),
      state: c.staffUserId ? "active" : c.state, zone_state: c.zoneState, issued_at: d(c.issuedAt),
      revoked_at: c.state === "revoked" ? d(c.revokedAt!) : null, replaced_by_id: c.replacedBy,
    }));
    // Insert in two passes so replaced_by_id targets exist.
    await insertMany(tx, s.credentials, credRows.map((r) => ({ ...r, replaced_by_id: null })));
    for (const c of creds.filter((x) => x.replacedBy)) {
      await tx.update(s.credentials).set({ replaced_by_id: c.replacedBy }).where(sql`${s.credentials.id} = ${c.id}`);
    }
    for (const c of creds) {
      const tier = c.reg?.tier;
      const live = c.state === "issued" || c.state === "active" || c.state === "suspended_review";
      if (c.reg && tier !== "PUBLIC") {
        carriers.push({ id: uuid(), credential_id: c.id, kind: "qr_portal", state: live ? "active" : "retired", bound_at: d(c.issuedAt) });
        carriers.push({ id: uuid(), credential_id: c.id, kind: "qr_email", identifier: sha(hex(32)), state: live ? "active" : "retired", bound_at: d(c.issuedAt), redeemed_at: emailRedeemed.has(c.id) ? d(emailRedeemed.get(c.id)!) : null });
      }
      const bound = bandBound.get(c.id);
      if (bound !== undefined || c.staffUserId) {
        const lostBand = c.state === "replaced";
        carriers.push({
          id: uuid(), credential_id: c.id, kind: "nfc", ...bandId(),
          chip_profile: tier === "VIP" || tier === "PRIVATE_INVITE" ? (chance(0.5) ? "ntag424_dna" : "desfire_ev3") : "ntag_uid",
          state: lostBand ? "lost" : c.state === "revoked" ? "retired" : "active", bound_at: d(bound ?? c.issuedAt),
        });
      }
    }
    for (let i = 0; i < 300; i++) carriers.push({ id: uuid(), kind: "nfc", ...bandId(), chip_profile: i < 60 ? "ntag424_dna" : "ntag_uid", state: "stock" });
    for (let i = 0; i < 40; i++) carriers.push({ id: uuid(), credential_id: null, kind: "nfc", ...bandId(), chip_profile: "ntag424_dna", state: "stock" });
    await insertMany(tx, s.carriers, carriers);
    const ephRows: (typeof s.ephemeral_ids.$inferInsert)[] = [];
    for (const c of creds) for (const [eventId, e] of c.ephemeral) ephRows.push({ event_id: eventId, credential_id: c.id, ephemeral_id: e, created_at: d(c.issuedAt) });
    await insertMany(tx, s.ephemeral_ids, ephRows);

    scans.sort((a, b) => a.occurred_at!.getTime() + a.clock_offset_ms! - (b.occurred_at!.getTime() + b.clock_offset_ms!));
    await insertMany(tx, s.scans, scans, 500);

    /* ------------------------------------------------------ occupancy corrections */
    // Session-end resets, in time order, each recording the change it made.
    const resetList = [...resets.entries()]
      .flatMap(([key, ts]) => {
        const [eventId, roomId] = key.split("|") as [string, string];
        return ts.map((t) => ({ eventId, roomId, t }));
      })
      .sort((a, b) => a.t - b.t);
    for (const r of resetList) {
      const lvl = (await tx.execute(sql`select occupancy from public.room_occupancy(${r.eventId}::uuid, ${d(r.t - 1).toISOString()}::timestamptz) where room_id = ${r.roomId}::uuid`)) as unknown as { rows: { occupancy: number }[] };
      const before = Number(lvl.rows[0]?.occupancy ?? 0);
      await tx.insert(s.occupancy_adjustments).values({ id: uuid(), event_id: r.eventId, room_id: r.roomId, delta: -before, set_to: 0, reason: "session_end", at: d(r.t), note: "session ended" });
    }
    const expoA = v1Rooms.find((r) => r.name === "Expo Hall A")!;
    const recountAt = now - 60 * MIN;
    const lvlA = (await tx.execute(sql`select occupancy from public.room_occupancy(${ev.live}::uuid, ${d(recountAt - 1).toISOString()}::timestamptz) where room_id = ${expoA.id}::uuid`)) as unknown as { rows: { occupancy: number }[] };
    const headcount = Number(lvlA.rows[0]?.occupancy ?? 0) + 7;
    adjustments.push({ id: uuid(), event_id: ev.live, room_id: expoA.id, delta: 7, set_to: headcount, reason: "recount", actor_id: organisers[0]!, at: d(recountAt), note: "Floor headcount by stewards" });
    audit.push({ actor: organisers[0]!, action: "room.recount", target: `room:${expoA.id}`, meta: { event_id: ev.live, set_to: headcount } });
    adjustments.push({ id: uuid(), event_id: ev.live, room_id: offlineRoom.id, delta: -1, reason: "sync_conflict", at: d(now - 68 * MIN), note: "pass-back across offline gates corrected at sync" });
    await insertMany(tx, s.occupancy_adjustments, adjustments);

    /* --------------------------------------------------------------- alerts */
    for (const [i, dn] of deniedScans.filter((x) => x.eventId === ev.live).slice(0, 14).entries()) {
      const state = i < 6 ? "resolved" : i < 10 ? "acked" : "open";
      const by = pick(security);
      alerts.push({
        id: uuid(), event_id: ev.live, severity: i % 5 === 0 ? "high" : "medium", kind: "unauthorised_tier", checkpoint_id: dn.cp,
        credential_id: dn.credId, occurred_at: d(dn.t), state, scan_ids: [dn.scanId], detail: "Tier not permitted in this room",
        acked_by: state === "open" ? null : by, acked_at: state === "open" ? null : d(dn.t + 2 * MIN),
        resolved_by: state === "resolved" ? by : null, resolved_at: state === "resolved" ? d(dn.t + 9 * MIN) : null,
        resolution_note: state === "resolved" ? "Redirected to the correct room" : null,
      });
    }
    const offScans = scans.filter((x) => x.offline_bool).slice(0, 2);
    alerts.push({ id: uuid(), event_id: ev.live, severity: "high", kind: "offline_conflict_passback", checkpoint_id: offlineRoom.inCp, occurred_at: d(now - 68 * MIN), state: "acked", acked_by: security[0]!, acked_at: d(now - 60 * MIN), scan_ids: offScans.map((x) => x.id!), detail: "Pass-back across offline gates found at sync" });
    alerts.push({ id: uuid(), event_id: ev.live, severity: "medium", kind: "gate_offline", checkpoint_id: offlineRoom.inCp, occurred_at: d(now - 89 * MIN), state: "resolved", acked_by: security[1]!, acked_at: d(now - 85 * MIN), resolved_by: security[1]!, resolved_at: d(now - 68 * MIN), resolution_note: "Link restored, queue synced", detail: "No heartbeat for 60 s" });
    alerts.push({ id: uuid(), event_id: ev.live, severity: "low", kind: "clock_skew", checkpoint_id: offlineRoom.inCp, occurred_at: d(now - 68 * MIN), state: "acked", acked_by: security[1]!, acked_at: d(now - 66 * MIN), detail: "Device clock 95 s behind server" });
    alerts.push({ id: uuid(), event_id: ev.live, severity: "medium", kind: "capacity_warn", room_id: v1Rooms.find((r) => r.name === "Community Stage")!.id, occurred_at: d(now - 25 * MIN), state: "open", detail: "Room passed 85 % of capacity" });
    alerts.push({ id: uuid(), event_id: ev.closed, severity: "high", kind: "pass_replayed", checkpoint_id: perimeter[0]!.id, occurred_at: d(ev3Start + 2 * HOUR), state: "resolved", acked_by: security[2]!, acked_at: d(ev3Start + 2 * HOUR + MIN), resolved_by: security[2]!, resolved_at: d(ev3Start + 2 * HOUR + 10 * MIN), resolution_note: "Attendee had forwarded the email; verified ID", detail: "Emailed QR presented a second time" });
    await insertMany(tx, s.breach_alerts, alerts);
    for (const a of alerts.filter((x) => x.state !== "open")) audit.push({ actor: a.acked_by ?? null, action: "alert.ack", target: `alert:${a.id}`, meta: {} });

    /* ------------------------------------------------- staff assignments, misc */
    const interiorV1 = v1Rooms.map((r) => r.inCp);
    const perimV1 = perimeter.filter((p) => p.venue === 0).map((p) => p.id);
    const assignments: (typeof s.staff_assignments.$inferInsert)[] = [];
    for (const [i, u] of security.entries()) {
      const mid = ev1Start + 5 * HOUR;
      assignments.push({ id: uuid(), user_id: u, event_id: ev.live, checkpoint_id: i < 5 ? perimV1[i]! : interiorV1[i % interiorV1.length]!, shift_start: d(ev1Start - HOUR), shift_end: d(mid), created_by: admins[0]!, handed_over_at: mid < now ? d(mid) : null });
      assignments.push({ id: uuid(), user_id: u, event_id: ev.live, checkpoint_id: i < 5 ? perimV1[(i + 1) % perimV1.length]! : interiorV1[(i + 7) % interiorV1.length]!, shift_start: d(mid), shift_end: d(ev1End + HOUR), created_by: admins[0]! });
      if (i < 6) {
        const p2 = perimeter.filter((p) => p.venue === 1);
        assignments.push({ id: uuid(), user_id: u, event_id: ev.published, checkpoint_id: p2[i % p2.length]!.id, shift_start: d(ev2Start - HOUR), shift_end: d(ev2Start + 7 * HOUR), created_by: admins[1]! });
      }
    }
    await insertMany(tx, s.staff_assignments, assignments);

    const hookId = uuid();
    await tx.insert(s.webhook_endpoints).values({
      id: hookId, org_id: orgId, url: "https://hooks.example.test/alerts", events: ["alert.raised", "alert.acked", "alert.resolved"],
      secret: cipher.encrypt(hex(32), { table: "webhook_endpoints", column: "secret", rowId: hookId }),
    });
    // Gate devices: a fixed reader on each large room's in-door of venue 1, a phone per perimeter gate.
    const deviceRows: (typeof s.devices.$inferInsert)[] = [];
    for (const r of v1Rooms.filter((x) => !x.both)) {
      deviceRows.push({ venue_id: venueIds[0]!, kind: "fixed_reader", label: `Reader ${r.name}`, hardware_id: `FR-${r.inCp.slice(0, 8)}`,
        checkpoint_id: r.inCp, token_hash: sha(hex(32)), last_heartbeat_at: d(now - int(2, 50) * 1000), last_clock_offset_ms: int(-300, 300), last_queue_depth: 0 });
    }
    for (const p of perimeter.filter((x) => x.venue === 0)) {
      deviceRows.push({ venue_id: venueIds[0]!, kind: "scanner", label: `Scanner ${p.label}`, hardware_id: `PH-${p.id.slice(0, 8)}`,
        checkpoint_id: p.id, last_heartbeat_at: d(now - int(2, 50) * 1000), last_clock_offset_ms: int(-300, 300), last_queue_depth: 0 });
    }
    await insertMany(tx, s.devices, deviceRows);
    await tx.insert(s.event_reports).values([
      { id: uuid(), event_id: ev.closed, kind: "attendance", state: "ready", object_key: `reports/${ev.closed}/attendance.csv`, requested_by: organisers[1]!, created_at: d(ev3End + 2 * HOUR), completed_at: d(ev3End + 2 * HOUR + MIN) },
      { id: uuid(), event_id: ev.closed, kind: "gate_throughput", state: "ready", object_key: `reports/${ev.closed}/gate_throughput.csv`, requested_by: organisers[1]!, created_at: d(ev3End + 2 * HOUR), completed_at: d(ev3End + 2 * HOUR + 2 * MIN) },
      { id: uuid(), event_id: ev.closed, kind: "peak_occupancy", state: "queued", requested_by: organisers[2]!, created_at: d(now - 5 * MIN) },
    ]);

    // Audit trail (the trigger stamps time and hashes).
    for (const eventId of Object.values(ev)) audit.unshift({ actor: admins[0]!, action: "access_rules.republish", target: `event:${eventId}`, meta: {} });
    for (const r of regs.filter((x) => x.tier === "VIP" && x.eventId === ev.live).slice(0, 3)) {
      audit.push({ actor: admins[1]!, action: "registration.tier_override", target: `registration:${r.id}`, meta: { from: "ORDINARY", to: "VIP", mfa: true } });
    }
    for (const a of audit) await tx.insert(s.audit_log).values({ actor_id: a.actor, action: a.action, target: a.target, meta_jsonb: a.meta });

    /* ---------------------------------------------------------- aggregates */
    await tx.execute(sql`select public.rebuild_event_rollups(${ev.live}::uuid)`);
    await tx.execute(sql`select public.rebuild_event_rollups(${ev.closed}::uuid)`);
    await tx.execute(sql`select public.take_attendance_snapshot(${ev.live}::uuid, ${d(now).toISOString()}::timestamptz)`);
    await tx.execute(sql`select public.take_attendance_snapshot(${ev.closed}::uuid, ${d(ev3End).toISOString()}::timestamptz)`);

    const count = async (t: string) => {
      const r = (await tx.execute(sql.raw(`select count(*)::int as n from ${t}`))) as unknown as { rows: { n: number }[] };
      return Number(r.rows[0]!.n);
    };
    const tables = [
      "organizations", "venues", "zones", "rooms", "checkpoints", "transit_times", "events", "event_rooms", "sessions",
      "users", "staff_assignments", "pii_vault.attendees", "invitations", "registrations", "access_rules",
      "credentials", "carriers", "signing_keys", "pii_vault.ephemeral_ids", "scans", "occupancy_adjustments",
      "breach_alerts", "audit_log", "webhook_endpoints", "occupancy_rollups", "gate_rate_rollups",
      "attendance_snapshots", "event_reports",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = await count(t);
    return { counts, events: ev, now: d(now) };
  });
}
