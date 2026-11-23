/**
 * The Attendee Portal's world: events, rooms, sessions, public occupancy and profile
 * schemas, in contract shapes. Deterministic: every id is derived from a name.
 *
 * Times are UTC. The venues are in Africa/Kampala (UTC+3).
 */
import { idFor } from "../random";
import type {
  EventDetail,
  PortalEvent,
  PortalWorld,
  ProfileField,
  RoomOccupancy,
} from "../types";

/** Default virtual "now" for demos: Sun 22 Nov 2026, 11:45 in Kampala, Nexus Summit live. */
export const DEMO_NOW = "2026-11-22T08:45:00.000Z";

const KAMPALA = "Africa/Kampala";

/** Minimum crowd before an aggregate is shown publicly (O-08). */
const K_ANONYMITY = 5;

interface RoomSpec {
  name: string;
  capacity: number;
  /** Public occupancy at DEMO_NOW; null = not open. */
  occupancy: number | null;
}

interface SessionSpec {
  title: string;
  room: string;
  /** UTC ISO */
  starts: string;
  ends: string;
}

interface EventSpec {
  slug: string;
  title: string;
  venue: string;
  city: string;
  starts: string;
  ends: string;
  state: EventDetail["state"];
  listed: boolean;
  nearby: boolean;
  description: string;
  rooms: RoomSpec[];
  sessions: SessionSpec[];
}

const specs: EventSpec[] = [
  {
    slug: "nexus-summit-2026",
    title: "Nexus Summit 2026",
    venue: "Nexus Hall",
    city: "Kampala",
    starts: "2026-11-22T06:00:00.000Z",
    ends: "2026-11-23T14:00:00.000Z",
    state: "live",
    listed: true,
    nearby: true,
    description:
      "The Nexus Summit brings together leaders in technology, policy, and social impact to explore the future of connected systems across Africa. Over two days, we share strategies for building resilient, inclusive infrastructure.",
    rooms: [
      { name: "Main Hall", capacity: 800, occupancy: 610 },
      { name: "Workshop A", capacity: 80, occupancy: 78 },
      { name: "Breakout 1", capacity: 120, occupancy: 52 },
      { name: "West Terrace", capacity: 200, occupancy: 124 },
    ],
    sessions: [
      { title: "Keynote: The Next Decade of Connectivity", room: "Main Hall", starts: "2026-11-22T06:00:00.000Z", ends: "2026-11-22T07:00:00.000Z" },
      { title: "Panel: Policy Frameworks for Innovation", room: "Main Hall", starts: "2026-11-22T07:15:00.000Z", ends: "2026-11-22T08:15:00.000Z" },
      { title: "Building Scalable Infrastructure", room: "Workshop A", starts: "2026-11-22T08:30:00.000Z", ends: "2026-11-22T09:30:00.000Z" },
      { title: "Open Data in Public Services", room: "Breakout 1", starts: "2026-11-22T09:45:00.000Z", ends: "2026-11-22T10:30:00.000Z" },
      { title: "Closing: The Path Forward", room: "Main Hall", starts: "2026-11-22T11:00:00.000Z", ends: "2026-11-22T12:30:00.000Z" },
      { title: "Day Two Opening", room: "Main Hall", starts: "2026-11-23T06:00:00.000Z", ends: "2026-11-23T06:45:00.000Z" },
      { title: "Fireside: Infrastructure in Africa", room: "West Terrace", starts: "2026-11-23T12:00:00.000Z", ends: "2026-11-23T13:00:00.000Z" },
    ],
  },
  {
    slug: "security-operations-forum",
    title: "Security Operations Forum",
    venue: "Serena Conference Centre",
    city: "Kampala",
    starts: "2026-11-22T07:00:00.000Z",
    ends: "2026-11-22T11:00:00.000Z",
    state: "live",
    listed: true,
    nearby: true,
    description:
      "A focused forum for security professionals managing live events and large gatherings. Share best practices, threat assessment, and real-time response strategies.",
    rooms: [
      { name: "Grand Ballroom", capacity: 200, occupancy: 190 },
      { name: "Breakout Room 1", capacity: 100, occupancy: 78 },
    ],
    sessions: [
      { title: "Threat Landscape Overview", room: "Grand Ballroom", starts: "2026-11-22T07:00:00.000Z", ends: "2026-11-22T07:45:00.000Z" },
      { title: "Incident Response Workshop", room: "Grand Ballroom", starts: "2026-11-22T08:00:00.000Z", ends: "2026-11-22T09:30:00.000Z" },
      { title: "Access Control Strategies", room: "Breakout Room 1", starts: "2026-11-22T09:45:00.000Z", ends: "2026-11-22T10:45:00.000Z" },
    ],
  },
  {
    slug: "design-week-kampala",
    title: "Design Week Kampala",
    venue: "Innovation Village",
    city: "Kampala",
    starts: "2026-11-25T07:00:00.000Z",
    ends: "2026-11-27T15:00:00.000Z",
    state: "published",
    listed: true,
    nearby: true,
    description:
      "A celebration of design innovation in Kampala. Explore exhibitions, workshops, and talks from local and international designers pushing the boundaries of creative practice.",
    rooms: [
      { name: "Gallery Space", capacity: 150, occupancy: null },
      { name: "Workshop Studio", capacity: 50, occupancy: null },
    ],
    sessions: [
      { title: "Opening Exhibition Tour", room: "Gallery Space", starts: "2026-11-25T07:00:00.000Z", ends: "2026-11-25T08:30:00.000Z" },
      { title: "Design Thinking Workshop", room: "Workshop Studio", starts: "2026-11-25T09:00:00.000Z", ends: "2026-11-25T11:00:00.000Z" },
    ],
  },
  {
    slug: "founders-night",
    title: "Founders Night",
    venue: "The Alchemist",
    city: "Kampala",
    starts: "2026-11-28T15:30:00.000Z",
    ends: "2026-11-28T20:00:00.000Z",
    state: "published",
    listed: true,
    nearby: false,
    description:
      "An evening for founders and operators building in East Africa: short talks, open tables, and the people you have been meaning to meet.",
    rooms: [{ name: "Courtyard", capacity: 260, occupancy: null }],
    sessions: [
      { title: "Lightning talks", room: "Courtyard", starts: "2026-11-28T15:30:00.000Z", ends: "2026-11-28T16:30:00.000Z" },
      { title: "Open tables", room: "Courtyard", starts: "2026-11-28T16:30:00.000Z", ends: "2026-11-28T19:30:00.000Z" },
    ],
  },
  {
    slug: "civic-tech-assembly",
    title: "Civic Tech Assembly",
    venue: "National Theatre",
    city: "Kampala",
    starts: "2026-12-03T06:00:00.000Z",
    ends: "2026-12-03T14:00:00.000Z",
    state: "published",
    listed: true,
    nearby: false,
    description:
      "Public servants, technologists and citizens on what it takes to build digital services people trust.",
    rooms: [
      { name: "Auditorium", capacity: 420, occupancy: null },
      { name: "Rehearsal Room", capacity: 80, occupancy: null },
    ],
    sessions: [
      { title: "State of Civic Tech", room: "Auditorium", starts: "2026-12-03T06:00:00.000Z", ends: "2026-12-03T07:00:00.000Z" },
      { title: "Service Design Clinic", room: "Rehearsal Room", starts: "2026-12-03T08:00:00.000Z", ends: "2026-12-03T10:00:00.000Z" },
    ],
  },
  {
    // Private Invitation: resolvable by link, never listed (01 §4, 06 §1.2 A1).
    slug: "sponsor-roundtable",
    title: "Sponsor Roundtable",
    venue: "Nexus Hall",
    city: "Kampala",
    starts: "2026-11-23T08:00:00.000Z",
    ends: "2026-11-23T10:00:00.000Z",
    state: "published",
    listed: false,
    nearby: true,
    description: "A closed-door session for summit sponsors.",
    rooms: [{ name: "Board Room", capacity: 24, occupancy: null }],
    sessions: [
      { title: "Roundtable", room: "Board Room", starts: "2026-11-23T08:00:00.000Z", ends: "2026-11-23T10:00:00.000Z" },
    ],
  },
];

function level(occupancy: number, capacity: number): RoomOccupancy["level"] {
  if (capacity === 0) return "ok";
  const pct = (occupancy / capacity) * 100;
  if (pct >= 100) return "block";
  if (pct >= 85) return "warn";
  return "ok";
}

function build(spec: EventSpec): { event: PortalEvent; occupancy: RoomOccupancy[] } {
  const eventId = idFor(`event:${spec.slug}`);
  const venueId = idFor(`venue:${spec.venue}`);
  const zoneId = idFor(`zone:${spec.venue}:ground`);
  const roomId = (name: string) => idFor(`room:${spec.venue}:${name}`);

  const detail: EventDetail = {
    id: eventId,
    slug: spec.slug,
    title: spec.title,
    starts_at: spec.starts,
    ends_at: spec.ends,
    timezone: KAMPALA,
    state: spec.state,
    venue: { id: venueId, name: spec.venue, city: spec.city },
    on_site: null,
    description: spec.description,
    rooms: spec.rooms.map((room) => ({
      room_id: roomId(room.name),
      name: room.name,
      zone_id: zoneId,
      capacity: room.capacity,
    })),
    sessions: spec.sessions.map((session) => ({
      id: idFor(`session:${spec.slug}:${session.title}`),
      event_id: eventId,
      room_id: roomId(session.room),
      title: session.title,
      starts_at: session.starts,
      ends_at: session.ends,
    })),
  };

  const occupancy: RoomOccupancy[] = spec.rooms
    .filter((room) => room.occupancy !== null)
    .map((room) => ({
      room_id: roomId(room.name),
      zone_id: zoneId,
      occupancy: room.occupancy,
      capacity: room.capacity,
      level: level(room.occupancy ?? 0, room.capacity),
    }));

  const onSite = occupancy.reduce((sum, room) => sum + (room.occupancy ?? 0), 0);
  detail.on_site = spec.state === "live" && onSite >= K_ANONYMITY ? onSite : null;

  return {
    event: { detail, listed: spec.listed, extras: { city: spec.city, nearby: spec.nearby } },
    occupancy,
  };
}

type Profile = { fields: ProfileField[] };

const defaultProfile: Profile = {
  fields: [
    { key: "organization", label: "Organisation", type: "text", required: false, placeholder: "Where you work" },
    { key: "role", label: "Role", type: "select", required: true, options: ["Founder", "Operator", "Engineer", "Policy", "Student", "Other"] },
  ],
};

const profiles: Record<string, Profile> = {
  "nexus-summit-2026": {
    fields: [
      { key: "organization", label: "Organisation", type: "text", required: true, placeholder: "Where you work" },
      { key: "role", label: "Role", type: "select", required: true, options: ["Founder", "Operator", "Engineer", "Policy", "Student", "Other"] },
      { key: "tracks", label: "Tracks you plan to attend", type: "multiselect", required: false, options: ["Infrastructure", "Policy", "Product", "Research"], hint: "Pick any that apply. You can change this at the desk." },
      { key: "meal", label: "Meal preference", type: "select", required: true, options: ["No preference", "Vegetarian", "Vegan", "Halal"] },
    ],
  },
  "security-operations-forum": {
    fields: [
      { key: "organization", label: "Organisation", type: "text", required: true, placeholder: "Agency or company" },
      { key: "role", label: "Function", type: "select", required: true, options: ["Security lead", "Event operations", "Venue staff", "Other"] },
      { key: "topics", label: "Topics of interest", type: "multiselect", required: false, options: ["Threat assessment", "Access control", "Incident response"] },
    ],
  },
  "design-week-kampala": {
    fields: [
      { key: "role", label: "You are", type: "select", required: true, options: ["Designer", "Student", "Studio", "Press", "Other"] },
      { key: "days", label: "Days you plan to attend", type: "multiselect", required: true, options: ["Wed 25 Nov", "Thu 26 Nov", "Fri 27 Nov"] },
    ],
  },
};

export function buildPortalWorld(): PortalWorld {
  const built = specs.map(build);
  const occupancy: Record<string, RoomOccupancy[]> = {};
  for (const { event, occupancy: rooms } of built) occupancy[event.detail.id] = rooms;

  const profileBySlug: PortalWorld["profiles"] = {};
  for (const spec of specs) profileBySlug[spec.slug] = profiles[spec.slug] ?? defaultProfile;

  return { events: built.map((entry) => entry.event), occupancy, profiles: profileBySlug };
}
