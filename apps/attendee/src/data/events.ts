export type EventState = "live" | "upcoming";

export type EventSummary = {
  slug: string;
  title: string;
  startsAt: string;
  timezone: string;
  venue: string;
  city: string;
  state: EventState;
  admitted: number;
  capacity: number;
  nearby: boolean;
};

export type EventDetail = EventSummary & {
  description: string;
  membership: "none" | "registered" | "checked-in";
  closed?: boolean;
  sessions: {
    id: string;
    day: string;
    room: string;
    title: string;
    startsAt: string;
    endsAt: string;
    occupancy: number;
    capacity: number;
  }[];
};

export const eventDetails: EventDetail[] = [
  {
    slug: "nexus-summit-2026",
    title: "Nexus Summit 2026",
    startsAt: "2026-11-22T09:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Nexus Hall",
    city: "Kampala",
    state: "live",
    admitted: 864,
    capacity: 1200,
    nearby: true,
    description:
      "The Nexus Summit brings together leaders in technology, policy, and social impact to explore the future of connected systems across Africa. Over two days, we share strategies for building resilient, inclusive infrastructure.",
    membership: "none",
    closed: false,
    sessions: [
      {
        id: "s1",
        day: "Sun 22 Nov",
        room: "Main Hall",
        title: "Keynote: The Next Decade of Connectivity",
        startsAt: "09:00",
        endsAt: "10:00",
        occupancy: 42,
        capacity: 100,
      },
      {
        id: "s2",
        day: "Sun 22 Nov",
        room: "Main Hall",
        title: "Panel: Policy Frameworks for Innovation",
        startsAt: "10:15",
        endsAt: "11:15",
        occupancy: 65,
        capacity: 100,
      },
      {
        id: "s3",
        day: "Sun 22 Nov",
        room: "Workshop A",
        title: "Building Scalable Infrastructure",
        startsAt: "11:30",
        endsAt: "12:30",
        occupancy: 78,
        capacity: 80,
      },
      {
        id: "s4",
        day: "Sun 22 Nov",
        room: "Main Hall",
        title: "Closing: The Path Forward",
        startsAt: "14:00",
        endsAt: "15:30",
        occupancy: 88,
        capacity: 100,
      },
    ],
  },
  {
    slug: "security-operations-forum",
    title: "Security Operations Forum",
    startsAt: "2026-11-22T14:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Serena Conference Centre",
    city: "Kampala",
    state: "live",
    admitted: 268,
    capacity: 300,
    nearby: true,
    description:
      "A focused forum for security professionals managing live events and large gatherings. Share best practices, threat assessment, and real-time response strategies.",
    membership: "checked-in",
    closed: false,
    sessions: [
      {
        id: "s1",
        day: "Sun 22 Nov",
        room: "Grand Ballroom",
        title: "Threat Landscape Overview",
        startsAt: "14:00",
        endsAt: "14:45",
        occupancy: 72,
        capacity: 100,
      },
      {
        id: "s2",
        day: "Sun 22 Nov",
        room: "Grand Ballroom",
        title: "Incident Response Workshop",
        startsAt: "15:00",
        endsAt: "16:30",
        occupancy: 93,
        capacity: 100,
      },
      {
        id: "s3",
        day: "Sun 22 Nov",
        room: "Breakout Room 1",
        title: "Access Control Strategies",
        startsAt: "16:45",
        endsAt: "17:45",
        occupancy: 58,
        capacity: 80,
      },
    ],
  },
  {
    slug: "design-week-kampala",
    title: "Design Week Kampala",
    startsAt: "2026-11-25T10:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Innovation Village",
    city: "Kampala",
    state: "upcoming",
    admitted: 0,
    capacity: 400,
    nearby: true,
    description:
      "A celebration of design innovation in Kampala. Explore exhibitions, workshops, and talks from local and international designers pushing the boundaries of creative practice.",
    membership: "none",
    closed: false,
    sessions: [
      {
        id: "s1",
        day: "Wed 25 Nov",
        room: "Gallery Space",
        title: "Opening Exhibition Tour",
        startsAt: "10:00",
        endsAt: "11:30",
        occupancy: 0,
        capacity: 150,
      },
      {
        id: "s2",
        day: "Wed 25 Nov",
        room: "Workshop Studio",
        title: "Design Thinking Workshop",
        startsAt: "12:00",
        endsAt: "14:00",
        occupancy: 0,
        capacity: 50,
      },
    ],
  },
];

export const events: EventSummary[] = [
  {
    slug: "nexus-summit-2026",
    title: "Nexus Summit 2026",
    startsAt: "2026-11-22T09:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Nexus Hall",
    city: "Kampala",
    state: "live",
    admitted: 864,
    capacity: 1200,
    nearby: true,
  },
  {
    slug: "security-operations-forum",
    title: "Security Operations Forum",
    startsAt: "2026-11-22T14:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Serena Conference Centre",
    city: "Kampala",
    state: "live",
    admitted: 268,
    capacity: 300,
    nearby: true,
  },
  {
    slug: "design-week-kampala",
    title: "Design Week Kampala",
    startsAt: "2026-11-25T10:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Innovation Village",
    city: "Kampala",
    state: "upcoming",
    admitted: 0,
    capacity: 400,
    nearby: true,
  },
  {
    slug: "founders-night",
    title: "Founders Night",
    startsAt: "2026-11-28T18:30:00+03:00",
    timezone: "Africa/Kampala",
    venue: "The Alchemist",
    city: "Kampala",
    state: "upcoming",
    admitted: 0,
    capacity: 260,
    nearby: false,
  },
  {
    slug: "civic-tech-assembly",
    title: "Civic Tech Assembly",
    startsAt: "2026-12-03T09:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "National Theatre",
    city: "Kampala",
    state: "upcoming",
    admitted: 0,
    capacity: 500,
    nearby: false,
  },
];
