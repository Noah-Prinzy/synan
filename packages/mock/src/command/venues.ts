/**
 * Venues for Admin Command, drawn on the abstract zone grid (docs/06 §2.3 D1: "the
 * abstract zone grid is the only map in version 1"). Zones are polygons, rooms are
 * rectangles, both in grid units; gates sit on zone edges. Never real coordinates of
 * people (D-04) — only the shape of the venue.
 *
 * Room geometry is laid out once here, as the D3 spatial editor will one day store it:
 * rows of rooms inside each zone, sized by capacity (compressed, so a 24-seat room is
 * still big enough to read).
 *
 * Ids follow the portal fixtures (`room:<venue>:<name>`), so a room is the same room
 * on every surface.
 */
import { createRng, hashString, idFor } from "../random";
import type { Checkpoint, Room, Venue, Zone } from "../types";

/* ------------------------------------------------------------ geometry types */

/** NOT IN CONTRACTS — proposed typed shape for `rooms.geometry`. Grid units. */
export type GridRect = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** NOT IN CONTRACTS — proposed typed shape for `zones.geometry`. Grid units. */
export type GridPolygon = {
  kind: "polygon";
  points: [number, number][];
}

/** NOT IN CONTRACTS — where a perimeter gate sits on the grid, and which edge it faces. */
export interface GridPoint {
  x: number;
  y: number;
  side: "n" | "e" | "s" | "w";
}

/**
 * GET /venues/:id (Venue + zones + rooms + checkpoints, in contracts) plus the grid
 * size and gate positions (NOT IN CONTRACTS, proposed as `venues.grid` and
 * `checkpoints.position`).
 */
export interface VenueLayout {
  venue: Venue;
  zones: Zone[];
  rooms: Room[];
  checkpoints: Checkpoint[];
  grid: { w: number; h: number };
  checkpoint_positions: Record<string, GridPoint>;
}

export function isGridRect(value: unknown): value is GridRect {
  return typeof value === "object" && value !== null && (value as GridRect).kind === "rect";
}

export function isGridPolygon(value: unknown): value is GridPolygon {
  return typeof value === "object" && value !== null && (value as GridPolygon).kind === "polygon";
}

/* ------------------------------------------------------------------- specs */

interface RoomSpec {
  name: string;
  capacity: number;
  /** Occupancy at the demo instant, as a fraction of capacity. Seeded when absent. */
  fill?: number;
  continuous?: boolean;
  policy?: "block" | "admit_with_alert";
}

interface ZoneSpec {
  name: string;
  floor: string;
  /** x, y, w, h in grid units. */
  at: [number, number, number, number];
  rooms: RoomSpec[];
}

interface GateSpec {
  label: string;
  direction: "in" | "out" | "both";
  /** Zone index and where on its edge (0–1 along it). */
  zone: number;
  side: GridPoint["side"];
  along: number;
}

interface VenueSpec {
  name: string;
  city: string;
  timezone: string;
  grid: { w: number; h: number };
  zones: ZoneSpec[];
  gates: GateSpec[];
}

/** Space inside a zone kept free for its label, and the margin around its rooms. Grid units. */
const ZONE_LABEL_BAND = 3.5;
const ZONE_PAD = 1;

/* The demo venue: Nexus Hall, 24 rooms over three floors. */
const NEXUS_HALL: VenueSpec = {
  name: "Nexus Hall",
  city: "Kampala",
  timezone: "Africa/Kampala",
  grid: { w: 96, h: 60 },
  zones: [
    {
      name: "Hall",
      floor: "Ground",
      at: [0, 0, 36, 34],
      rooms: [
        { name: "Main Hall", capacity: 800, fill: 0.76 },
        { name: "West Terrace", capacity: 200, fill: 0.62 },
        { name: "Registration Lounge", capacity: 120, fill: 0.4, continuous: true },
        { name: "Press Room", capacity: 40, fill: 0.35 },
      ],
    },
    {
      name: "Expo",
      floor: "Ground",
      at: [0, 36, 36, 24],
      rooms: [
        { name: "Expo Floor", capacity: 400, fill: 0.58, continuous: true },
        { name: "Demo Stage", capacity: 120, fill: 0.71 },
        { name: "Partner Lounge", capacity: 60, fill: 0.45 },
        { name: "Media Bar", capacity: 40, fill: 0.3 },
      ],
    },
    {
      name: "Workshops",
      floor: "Level 1",
      at: [38, 0, 34, 30],
      rooms: [
        { name: "Workshop A", capacity: 80, fill: 0.975 },
        { name: "Workshop B", capacity: 80, fill: 0.55 },
        { name: "Workshop C", capacity: 60, fill: 0.48 },
        { name: "Workshop D", capacity: 60, fill: 0.2 },
        { name: "Lab 1", capacity: 40, fill: 1 },
        { name: "Lab 2", capacity: 40, fill: 0.6 },
      ],
    },
    {
      name: "Breakouts",
      floor: "Level 1",
      at: [38, 32, 34, 28],
      rooms: [
        { name: "Breakout 1", capacity: 120, fill: 0.88 },
        { name: "Breakout 2", capacity: 120, fill: 0.5 },
        { name: "Breakout 3", capacity: 80, fill: 0.36 },
        { name: "Breakout 4", capacity: 80, fill: 0.62 },
        { name: "Quiet Room", capacity: 24, fill: 0.12, continuous: true },
      ],
    },
    {
      name: "Hospitality",
      floor: "Level 2",
      at: [74, 0, 22, 60],
      rooms: [
        { name: "Roof Garden", capacity: 150, fill: 0.44, continuous: true },
        { name: "VIP Lounge", capacity: 60, fill: 0.68, continuous: true },
        { name: "Speaker Green Room", capacity: 30, fill: 0.5 },
        { name: "Boardroom", capacity: 24, fill: 0.0 },
        { name: "Prayer Room", capacity: 24, fill: 0.16, continuous: true },
      ],
    },
  ],
  gates: [
    { label: "Gate 1 · North", direction: "in", zone: 0, side: "n", along: 0.25 },
    { label: "Gate 2 · North", direction: "in", zone: 0, side: "n", along: 0.7 },
    { label: "Gate 3 · West", direction: "in", zone: 1, side: "w", along: 0.5 },
    { label: "Gate 4 · East", direction: "out", zone: 4, side: "e", along: 0.8 },
  ],
};

/* The performance venue: the same building fully fitted out, 60 rooms in six zones. */
function nexusHallFull(): VenueSpec {
  const zone = (name: string, floor: string, at: ZoneSpec["at"], rooms: [string, number][]): ZoneSpec => ({
    name,
    floor,
    at,
    rooms: rooms.map(([roomName, capacity]) => {
      const known = NEXUS_HALL.zones.flatMap((z) => z.rooms).find((r) => r.name === roomName);
      return known ? { ...known } : { name: roomName, capacity };
    }),
  });
  const w = (96 - 4) / 3;
  const h = (60 - 2) / 2;
  return {
    ...NEXUS_HALL,
    zones: [
      zone("Hall", "Ground", [0, 0, w, h], [
        ["Main Hall", 800], ["West Terrace", 200], ["North Foyer", 150], ["South Foyer", 150],
        ["Registration Lounge", 120], ["Press Room", 40], ["Cloakroom", 30], ["Media Desk", 24],
        ["Info Point", 20], ["First Aid", 12],
      ]),
      zone("Expo", "Ground", [0, h + 2, w, h], [
        ["Expo Floor", 400], ["Startup Alley", 200], ["Demo Stage", 120], ["Coffee Court", 120],
        ["Booth Row A", 80], ["Booth Row B", 80], ["Partner Lounge", 60], ["Product Lab", 60],
        ["Media Bar", 40], ["Meetups", 40],
      ]),
      zone("Workshops", "Level 1", [w + 2, 0, w, h], [
        ["Workshop A", 80], ["Workshop B", 80], ["Workshop C", 60], ["Workshop D", 60],
        ["Workshop E", 40], ["Workshop F", 40], ["Lab 1", 40], ["Lab 2", 40], ["Lab 3", 24], ["Lab 4", 24],
      ]),
      zone("Breakouts", "Level 1", [w + 2, h + 2, w, h], [
        ["Breakout 1", 120], ["Breakout 2", 120], ["Breakout 3", 80], ["Breakout 4", 80],
        ["Breakout 5", 60], ["Breakout 6", 60], ["Breakout 7", 40], ["Breakout 8", 40],
        ["Quiet Room", 24], ["Prayer Room", 24],
      ]),
      zone("Studios", "Level 2", [2 * (w + 2), 0, w, h], [
        ["Studio 1", 60], ["Studio 2", 60], ["Studio 3", 40], ["Studio 4", 40], ["Studio 5", 30],
        ["Studio 6", 30], ["Recording Room", 12], ["Edit Suite", 12], ["Control Room", 12], ["Podcast Booth", 12],
      ]),
      zone("Hospitality", "Level 2", [2 * (w + 2), h + 2, w, h], [
        ["Dining Hall", 300], ["Roof Garden", 150], ["Bar", 120], ["Terrace Café", 80],
        ["VIP Lounge", 60], ["Speaker Green Room", 30], ["Boardroom", 24], ["Meeting Room 1", 16],
        ["Meeting Room 2", 16], ["Meeting Room 3", 16],
      ]),
    ],
    gates: [
      { label: "Gate 1 · North", direction: "in", zone: 0, side: "n", along: 0.25 },
      { label: "Gate 2 · North", direction: "in", zone: 0, side: "n", along: 0.7 },
      { label: "Gate 3 · West", direction: "in", zone: 1, side: "w", along: 0.5 },
      { label: "Gate 4 · East", direction: "out", zone: 5, side: "e", along: 0.6 },
      { label: "Gate 5 · North", direction: "in", zone: 4, side: "n", along: 0.5 },
      { label: "Gate 6 · South", direction: "both", zone: 3, side: "s", along: 0.5 },
    ],
  };
}

/* A second, small venue: Serena Conference Centre, for the Security Operations Forum. */
const SERENA: VenueSpec = {
  name: "Serena Conference Centre",
  city: "Kampala",
  timezone: "Africa/Kampala",
  grid: { w: 96, h: 60 },
  zones: [
    {
      name: "Ballroom",
      floor: "Ground",
      at: [0, 0, 56, 60],
      rooms: [
        { name: "Grand Ballroom", capacity: 200, fill: 0.95 },
        { name: "Ballroom Foyer", capacity: 80, fill: 0.4, continuous: true },
        { name: "Registration", capacity: 40, fill: 0.2, continuous: true },
      ],
    },
    {
      name: "Breakouts",
      floor: "Level 1",
      at: [58, 0, 38, 60],
      rooms: [
        { name: "Breakout Room 1", capacity: 100, fill: 0.78 },
        { name: "Breakout Room 2", capacity: 60, fill: 0.3 },
        { name: "Operations Room", capacity: 20, fill: 0.5 },
      ],
    },
  ],
  gates: [
    { label: "Gate 1 · Main", direction: "in", zone: 0, side: "s", along: 0.35 },
    { label: "Gate 2 · Main", direction: "in", zone: 0, side: "s", along: 0.7 },
    { label: "Gate 3 · Garden", direction: "in", zone: 1, side: "e", along: 0.5 },
    { label: "Gate 4 · Service", direction: "out", zone: 1, side: "n", along: 0.5 },
  ],
};

export type VenueKey = "nexus-hall" | "nexus-hall-full" | "serena";

const SPECS: Record<VenueKey, () => VenueSpec> = {
  "nexus-hall": () => NEXUS_HALL,
  "nexus-hall-full": nexusHallFull,
  serena: () => SERENA,
};

/* ------------------------------------------------------------------ layout */

interface Weighted {
  key: string;
  weight: number;
}

/**
 * Rows of rooms inside a rectangle, largest first, each row as tall as its share of
 * the weight and each room as wide as its share of its row. A floor-plan reading of
 * a treemap: corridors of rooms rather than nested boxes.
 *
 * Where the rows break is chosen to keep every room as close to square as possible
 * (minimise the worst aspect ratio), so no room becomes a sliver too thin to label.
 */
function layoutRows(items: Weighted[], x: number, y: number, w: number, h: number): Map<string, GridRect> {
  const out = new Map<string, GridRect>();
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const n = sorted.length;
  if (total <= 0 || n === 0) return out;

  const rowCost = (from: number, to: number): number => {
    let rowWeight = 0;
    for (let i = from; i < to; i++) rowWeight += (sorted[i] as Weighted).weight;
    const rh = (h * rowWeight) / total;
    let worst = 1;
    for (let i = from; i < to; i++) {
      const rw = (w * (sorted[i] as Weighted).weight) / rowWeight;
      worst = Math.max(worst, rw / rh, rh / rw);
    }
    return worst;
  };

  // best[i]: the smallest possible worst aspect for the first i rooms; cut[i]: where its last row starts.
  const best = new Array<number>(n + 1).fill(Infinity);
  const cut = new Array<number>(n + 1).fill(0);
  best[0] = 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      const cost = Math.max(best[j] as number, rowCost(j, i));
      if (cost < (best[i] as number)) {
        best[i] = cost;
        cut[i] = j;
      }
    }
  }
  const rows: Weighted[][] = [];
  for (let i = n; i > 0; i = cut[i] as number) rows.unshift(sorted.slice(cut[i] as number, i));

  let cy = y;
  for (const row of rows) {
    const rowWeight = row.reduce((sum, item) => sum + item.weight, 0);
    const rh = (h * rowWeight) / total;
    let cx = x;
    for (const item of row) {
      const rw = (w * item.weight) / rowWeight;
      out.set(item.key, { kind: "rect", x: round(cx), y: round(cy), w: round(rw), h: round(rh) });
      cx += rw;
    }
    cy += rh;
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Visual weight of a room: capacity compressed, so small rooms stay legible. */
function weightOf(capacity: number): number {
  return Math.pow(Math.max(capacity, 12), 0.45);
}

function gatePoint(zoneAt: ZoneSpec["at"], side: GridPoint["side"], along: number): GridPoint {
  const [x, y, w, h] = zoneAt;
  switch (side) {
    case "n":
      return { x: round(x + w * along), y, side };
    case "s":
      return { x: round(x + w * along), y: y + h, side };
    case "w":
      return { x, y: round(y + h * along), side };
    case "e":
      return { x: x + w, y: round(y + h * along), side };
  }
}

export interface BuiltVenue {
  layout: VenueLayout;
  /** Occupancy at the demo instant, by room id. */
  initial: Record<string, number>;
}

/**
 * Build a venue. Room order puts the two rooms the scenarios address first: the
 * largest hall, then "Workshop A" (or the second room) — see scenarios.ts.
 */
export function buildVenue(key: VenueKey, orgId: string): BuiltVenue {
  const spec = SPECS[key]();
  const venueId = idFor(`venue:${spec.name}`);
  const venue: Venue = {
    id: venueId,
    org_id: orgId,
    name: spec.name,
    address: spec.city,
    city: spec.city,
    timezone: spec.timezone,
  };

  const zones: Zone[] = [];
  const rooms: Room[] = [];
  const initial: Record<string, number> = {};
  const roomId = (name: string) => idFor(`room:${spec.name}:${name}`);

  for (const zoneSpec of spec.zones) {
    const zoneId = idFor(`zone:${spec.name}:${zoneSpec.floor}:${zoneSpec.name}`);
    const [x, y, w, h] = zoneSpec.at;
    zones.push({
      id: zoneId,
      venue_id: venueId,
      name: zoneSpec.name,
      floor: zoneSpec.floor,
      geometry: {
        kind: "polygon",
        points: [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
      } satisfies GridPolygon,
    });

    const rects = layoutRows(
      zoneSpec.rooms.map((room) => ({ key: room.name, weight: weightOf(room.capacity) })),
      x + ZONE_PAD,
      y + ZONE_LABEL_BAND,
      w - ZONE_PAD * 2,
      h - ZONE_LABEL_BAND - ZONE_PAD,
    );

    for (const roomSpec of zoneSpec.rooms) {
      const id = roomId(roomSpec.name);
      rooms.push({
        id,
        venue_id: venueId,
        zone_id: zoneId,
        name: roomSpec.name,
        capacity: roomSpec.capacity,
        warn_at_pct: 85,
        block_at_pct: 100,
        continuous: roomSpec.continuous ?? false,
        capacity_policy: roomSpec.policy ?? "block",
        geometry: rects.get(roomSpec.name) ?? null,
      });
      const rng = createRng(hashString(`fill:${spec.name}:${roomSpec.name}`));
      const fill = roomSpec.fill ?? 0.18 + rng() * 0.6;
      initial[id] = Math.round(roomSpec.capacity * fill);
    }
  }

  // Scenario addressing: rooms[0] is the main hall, rooms[1] the workshop that fills up.
  const firstNames = ["Main Hall", "Grand Ballroom", "Workshop A", "Breakout Room 1"];
  rooms.sort((a, b) => {
    const ia = firstNames.indexOf(a.name);
    const ib = firstNames.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const checkpoints: Checkpoint[] = [];
  const positions: Record<string, GridPoint> = {};
  const perimeter = spec.gates.map((gate) => {
    const zoneSpec = spec.zones[gate.zone] as ZoneSpec;
    const zone = zones[gate.zone] as Zone;
    const id = idFor(`checkpoint:${spec.name}:${gate.label}`);
    positions[id] = gatePoint(zoneSpec.at, gate.side, gate.along);
    return {
      id,
      venue_id: venueId,
      zone_id: zone.id,
      room_id: null,
      direction: gate.direction,
      perimeter: true,
      hardware_id: null,
      label: gate.label,
    } satisfies Checkpoint;
  });
  const doors: Checkpoint[] = rooms.map((room, index) => ({
    id: idFor(`checkpoint:${spec.name}:door:${room.name}`),
    venue_id: venueId,
    zone_id: room.zone_id,
    room_id: room.id,
    direction: "both",
    perimeter: false,
    hardware_id: `RDR-${String(index + 1).padStart(3, "0")}`,
    label: index === 1 ? `Door 4 · ${room.name}` : `${room.name} door`,
  }));

  // Scenario addressing: three entry gates, then the workshop's door, then the rest.
  const entries = perimeter.filter((gate) => gate.direction !== "out");
  const exits = perimeter.filter((gate) => gate.direction === "out");
  checkpoints.push(...entries.slice(0, 3));
  if (doors[1]) checkpoints.push(doors[1]);
  checkpoints.push(...entries.slice(3), ...exits, ...doors.filter((_, index) => index !== 1));

  return {
    layout: { venue, zones, rooms, checkpoints, grid: spec.grid, checkpoint_positions: positions },
    initial,
  };
}
