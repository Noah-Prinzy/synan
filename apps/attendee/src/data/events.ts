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
