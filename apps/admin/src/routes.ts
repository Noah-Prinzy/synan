/**
 * Every Admin Command route in docs/06 §2.1, with what each screen is for. One table
 * drives the router, the navigation rail and the honest placeholders, so a route
 * cannot exist without saying what it is.
 */
import {
  Building,
  CalendarDays,
  DoorOpen,
  FileChartColumn,
  IdCard,
  LayoutGrid,
  Nfc,
  ScrollText,
  Settings,
  Siren,
  Users,
} from "lucide-react";
import { createElement, type ReactNode } from "react";

export interface ScreenSpec {
  /** Path under /admin, router syntax. */
  path: string;
  code: string;
  title: string;
  /** What it will do, in one or two sentences (from docs/06 §2.3). */
  purpose: string;
  data: string;
  built?: boolean;
}

export const SCREENS = {
  command: {
    path: "/",
    code: "D1",
    title: "Command Center",
    purpose: "Live map, rooms and feed.",
    data: "stream/telemetry · stream/alerts · stream/scans · GET /dashboard",
    built: true,
  },
  setup: {
    path: "/setup",
    code: "D0",
    title: "First run",
    purpose: "Three steps — organization, venue, done — then hands off to the event wizard. Reachable only while the organization has no published venue.",
    data: "POST /organizations · POST /venues",
  },
  signIn: {
    path: "/sign-in",
    code: "—",
    title: "Sign in",
    purpose: "Password and a second factor. Privileged actions ask for the second factor again.",
    data: "POST /auth/login · POST /auth/mfa/verify",
  },
  venues: {
    path: "/venues",
    code: "D2",
    title: "Venues",
    purpose: "Table of venues: name, city, rooms, capacity, active events. One primary action, New venue.",
    data: "GET /venues",
  },
  venueNew: {
    path: "/venues/new",
    code: "D2b",
    title: "New venue",
    purpose: "Name, city, time zone, floors. Creating a venue goes straight into the spatial editor so it is never left with no zones.",
    data: "POST /venues",
  },
  venueEditor: {
    path: "/venues/:id",
    code: "D3",
    title: "Spatial editor",
    purpose: "Zones and rooms drawn on the abstract grid, with capacity and thresholds per room. The only screen with a drawing mode; changes are drafts until Publish layout.",
    data: "GET /venues/:id · PUT /zones · PUT /rooms/:id",
  },
  events: {
    path: "/events",
    code: "D4",
    title: "Events",
    purpose: "Table of events with state, registrations and last edit. Duplicate is the prominent row action.",
    data: "GET /events",
  },
  eventNew: {
    path: "/events/new/:step?",
    code: "D5",
    title: "Event wizard",
    purpose: "Basics → Venue & rooms → Access rules → Pass template → Review. Publish stays disabled until every requirement is met.",
    data: "draft endpoints",
  },
  eventOverview: {
    path: "/events/:id/overview",
    code: "D6.1",
    title: "Event overview",
    purpose: "The KPI strip scoped to this event, and the readiness checklist.",
    data: "GET /events/:id/summary",
  },
  eventSchedule: {
    path: "/events/:id/schedule",
    code: "D6.2",
    title: "Schedule",
    purpose: "Sessions by room and time.",
    data: "GET /events/:id/sessions",
  },
  eventRooms: {
    path: "/events/:id/rooms",
    code: "D6.3",
    title: "Rooms & rules",
    purpose: "Tier × room matrix of permit and deny. Changes show a diff and need an explicit republish.",
    data: "GET · PUT /events/:id/access-rules",
  },
  eventAttendees: {
    path: "/events/:id/attendees",
    code: "D6.4",
    title: "Event attendees",
    purpose: "The attendee table scoped to this event.",
    data: "GET /attendees (scoped)",
  },
  eventCredentials: {
    path: "/events/:id/credentials",
    code: "D6.5",
    title: "Event credentials",
    purpose: "Band inventory and provisioning for this event.",
    data: "GET /credentials (scoped)",
  },
  eventStaff: {
    path: "/events/:id/staff",
    code: "D6.6",
    title: "Event staff",
    purpose: "Shift assignments per checkpoint, conflicts, and handover.",
    data: "GET /staff-assignments",
  },
  eventReports: {
    path: "/events/:id/reports",
    code: "D6.7",
    title: "Event reports",
    purpose: "Reports for this event and their export jobs.",
    data: "GET /reports?eventId=",
  },
  eventSummary: {
    path: "/events/:id/summary",
    code: "D13c",
    title: "Event summary",
    purpose: "How the event went, on one page, with the Excel workbook and other downloads (D-21).",
    data: "GET /events/:id/post-event-summary · POST /reports/:id/export",
    built: true,
  },
  eventSettings: {
    path: "/events/:id/settings",
    code: "D6.8",
    title: "Event settings",
    purpose: "Time zone, capacity policy overrides, retention, and the danger zone.",
    data: "PATCH /events/:id",
  },
  attendees: {
    path: "/attendees",
    code: "D7",
    title: "Attendees",
    purpose: "Dense table with a detail sheet: resend pass, revoke, rebind band, change tier (second factor), view audit.",
    data: "GET /attendees",
  },
  credentials: {
    path: "/credentials",
    code: "D8",
    title: "Wristbands & provisioning",
    purpose: "Inventory by state, and the provisioning console: scan band, find registration, verify, bind. Replacement revokes the old band.",
    data: "GET /credentials/inventory",
  },
  accessLog: {
    path: "/access-log",
    code: "D9",
    title: "Access log",
    purpose: "Virtualised, searchable scan stream: time, checkpoint, credential, result, latency.",
    data: "GET /scans · stream/scans",
  },
  alerts: {
    path: "/alerts",
    code: "D10",
    title: "Security alerts",
    purpose: "Inbox by severity. The detail sheet shows the triggering scan, the rule, and a resolution note; an alert leaves the list only when resolved.",
    data: "GET /breach-alerts · stream/alerts",
  },
  staff: {
    path: "/staff",
    code: "D11",
    title: "Staff & shifts",
    purpose: "Staff, roles, assigned checkpoint and shift. Overlapping assignments are rejected inline.",
    data: "GET /staff",
  },
  gates: {
    path: "/gates",
    code: "D12",
    title: "Gate health",
    purpose: "Every checkpoint: link state, heartbeat age, queue depth, clock offset, throughput. Faults first.",
    data: "stream/scans · GET /checkpoints",
  },
  gateDetail: {
    path: "/gates/:id",
    code: "D12b",
    title: "Gate detail",
    purpose: "One checkpoint: link history, throughput by 5 minutes, failures by result, last 50 scans, assigned staff.",
    data: "GET /checkpoints/:id/scans",
  },
  reports: {
    path: "/reports",
    code: "D13",
    title: "Reports",
    purpose: "Generated reports with state and download. Export runs as a job with progress.",
    data: "GET /reports",
  },
  eventReport: {
    path: "/reports/:eventId",
    code: "D13b",
    title: "Event report",
    purpose: "One tab per report type, charted on the same hairline grid.",
    data: "GET /reports/:eventId · GET /reports/:eventId/:kind",
  },
  settings: {
    path: "/settings/:tab?",
    code: "D14",
    title: "Settings",
    purpose: "Organization, email, integrations and webhooks, retention and privacy, audit log, API keys.",
    data: "various",
  },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;

const icon = (component: typeof LayoutGrid): ReactNode => createElement(component, { size: 16, strokeWidth: 1.5 });

/** The six top-level ideas (docs/06 §2.1): watch, configure, people, access, response, records. */
export const NAV_GROUPS = [
  {
    label: "Watch",
    items: [
      { to: "/", label: "Command Center", icon: icon(LayoutGrid), end: true },
      { to: "/gates", label: "Gate health", icon: icon(DoorOpen) },
    ],
  },
  {
    label: "Configure",
    items: [
      { to: "/events", label: "Events", icon: icon(CalendarDays) },
      { to: "/venues", label: "Venues", icon: icon(Building) },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/attendees", label: "Attendees", icon: icon(Users) },
      { to: "/staff", label: "Staff & shifts", icon: icon(IdCard) },
    ],
  },
  {
    label: "Access",
    items: [
      { to: "/credentials", label: "Wristbands", icon: icon(Nfc) },
      { to: "/access-log", label: "Access log", icon: icon(ScrollText) },
    ],
  },
  {
    label: "Response",
    items: [{ to: "/alerts", label: "Alerts", icon: icon(Siren) }],
  },
  {
    label: "Records",
    items: [
      { to: "/reports", label: "Reports", icon: icon(FileChartColumn) },
      { to: "/settings", label: "Settings", icon: icon(Settings) },
    ],
  },
];
