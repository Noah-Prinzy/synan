/**
 * Every Admin Command route in docs/06 §2.1, with what each screen is for and what a role
 * needs to open it. One table drives the router, the route guards, the navigation rail and
 * the honest placeholders, so a route cannot exist without saying what it is and who it is for.
 */
import {
  Bell,
  Building,
  CalendarDays,
  ChartColumn,
  DoorOpen,
  IdCard,
  LayoutGrid,
  Nfc,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { createElement, type ReactNode } from "react";
import { matchPath } from "react-router-dom";
import type { Capability } from "./access/capabilities";

export interface ScreenSpec {
  /** Path under /admin, router syntax. */
  path: string;
  code: string;
  title: string;
  /** What it will do, in one or two sentences (from docs/06 §2.3). */
  purpose: string;
  data: string;
  built?: boolean;
  /** What the signed-in role needs to open it (docs/01 §3). Absent: any console role. */
  need?: Capability;
}

export const SCREENS = {
  command: {
    path: "/",
    code: "D1",
    title: "Command Center",
    purpose: "Live map, rooms and feed.",
    data: "stream/telemetry · stream/alerts · stream/scans · GET /dashboard",
    built: true,
    need: "live.view",
  },
  setup: {
    path: "/setup",
    code: "D0",
    title: "First run",
    purpose: "Three steps — organization, venue, done — then hands off to the event wizard. Reachable only while the organization has no published venue.",
    data: "POST /organizations · POST /venues",
    built: true,
    need: "setup.run",
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
    built: true,
    need: "venues.edit",
  },
  venueNew: {
    path: "/venues/new",
    code: "D2b",
    title: "New venue",
    purpose: "Name, city, time zone, floors. Creating a venue goes straight into the spatial editor so it is never left with no zones.",
    data: "POST /venues",
    built: true,
    need: "venues.edit",
  },
  venueEditor: {
    path: "/venues/:id",
    code: "D3",
    title: "Spatial editor",
    purpose: "Zones and rooms drawn on the abstract grid, with capacity and thresholds per room. The only screen with a drawing mode; changes are drafts until Publish layout.",
    data: "GET /venues/:id · PUT /zones · PUT /rooms/:id",
    built: true,
    need: "venues.edit",
  },
  events: {
    path: "/events",
    code: "D4",
    title: "Events",
    purpose: "Table of events with state, registrations and last edit. Duplicate is the prominent row action.",
    data: "GET /events",
    built: true,
    need: "events.list",
  },
  eventNew: {
    path: "/events/new/:step?",
    code: "D5",
    title: "Event wizard",
    purpose: "Basics → Venue & rooms → Access rules → Pass template → Review. Publish stays disabled until every requirement is met.",
    data: "draft endpoints",
    built: true,
    need: "events.edit",
  },
  eventOverview: {
    path: "/events/:id/overview",
    code: "D6.1",
    title: "Event overview",
    purpose: "The KPI strip scoped to this event, and the readiness checklist.",
    data: "GET /events/:id/summary",
    built: true,
    need: "events.view",
  },
  eventSchedule: {
    path: "/events/:id/schedule",
    code: "D6.2",
    title: "Schedule",
    purpose: "Sessions by room and time.",
    data: "GET /events/:id/sessions",
    built: true,
    need: "events.view",
  },
  eventRooms: {
    path: "/events/:id/rooms",
    code: "D6.3",
    title: "Rooms & rules",
    purpose: "Tier × room matrix of permit and deny. Changes show a diff and need an explicit republish.",
    data: "GET · PUT /events/:id/access-rules",
    built: true,
    need: "rules.view",
  },
  eventAttendees: {
    path: "/events/:id/attendees",
    code: "D6.4",
    title: "Event attendees",
    purpose: "The attendee table scoped to this event.",
    data: "GET /attendees (scoped)",
    built: true,
    need: "attendees.view",
  },
  eventCredentials: {
    path: "/events/:id/credentials",
    code: "D6.5",
    title: "Event credentials",
    purpose: "Band inventory and provisioning for this event.",
    data: "GET /credentials (scoped)",
    built: true,
    need: "credentials.view",
  },
  eventStaff: {
    path: "/events/:id/staff",
    code: "D6.6",
    title: "Event staff",
    purpose: "Shift assignments per checkpoint, conflicts, and handover.",
    data: "GET /staff-assignments",
    built: true,
    need: "staff.manage",
  },
  eventReports: {
    path: "/events/:id/reports",
    code: "D6.7",
    title: "Event reports",
    purpose: "Reports for this event and their export jobs.",
    data: "GET /reports?eventId=",
    built: true,
    need: "reports.view",
  },
  eventSummary: {
    path: "/events/:id/summary",
    code: "D13c",
    title: "Event summary",
    purpose: "How the event went, on one page, with the Excel workbook and other downloads (D-21).",
    data: "GET /events/:id/post-event-summary · POST /reports/:id/export",
    built: true,
    need: "reports.view",
  },
  eventSettings: {
    path: "/events/:id/settings",
    code: "D6.8",
    title: "Event settings",
    purpose: "Time zone, capacity policy overrides, retention, and the danger zone.",
    data: "PATCH /events/:id",
    built: true,
    need: "events.edit",
  },
  attendees: {
    path: "/attendees",
    code: "D7",
    title: "Attendees",
    purpose: "With the event workspace: the event's attendee table. Without it (supervisor): attendee lookup in the selected event, read only, with clear or revoke for a pass under review. The organisation-wide console (bulk actions, change tier, audit) comes later.",
    data: "GET /attendees",
    built: true,
    need: "attendees.view",
  },
  desk: {
    path: "/desk",
    code: "D8",
    title: "Wristband desk",
    purpose: "The registration desk: find an attendee, bind or rebind a band, mark a band lost and bind the replacement, resend a pass; band stock at a glance. /credentials leads here.",
    data: "GET /attendees · GET /credentials/inventory · POST /carriers/bind · POST /carriers/:id/rebind · POST /credentials/:id/resend",
    built: true,
    need: "desk.use",
  },
  accessLog: {
    path: "/access-log",
    code: "D9",
    title: "Access log",
    purpose: "Virtualised, searchable scan stream: time, checkpoint, credential, result, latency.",
    data: "GET /scans · stream/scans",
    built: true,
    need: "scans.view",
  },
  alerts: {
    path: "/alerts",
    code: "D10",
    title: "Security alerts",
    purpose: "Inbox by severity. The detail sheet shows the triggering scan, the rule, and a resolution note; an alert leaves the list only when resolved.",
    data: "GET /breach-alerts · stream/alerts",
    built: true,
    need: "alerts.view",
  },
  staff: {
    path: "/staff",
    code: "D11",
    title: "Staff & shifts",
    purpose: "Staff, roles, assigned checkpoint and shift. Overlapping assignments are rejected inline.",
    data: "GET /staff",
    need: "staff.manage",
  },
  gates: {
    path: "/gates",
    code: "D12",
    title: "Gate health",
    purpose: "Every checkpoint: link state, heartbeat age, queue depth, clock offset, throughput. Faults first.",
    data: "stream/scans · GET /checkpoints",
    built: true,
    need: "gates.view",
  },
  gateDetail: {
    path: "/gates/:id",
    code: "D12b",
    title: "Gate detail",
    purpose: "One checkpoint: link history, throughput by 5 minutes, failures by result, last 50 scans, assigned staff.",
    data: "GET /checkpoints/:id/scans",
    built: true,
    need: "gates.view",
  },
  reports: {
    path: "/reports",
    code: "D13",
    title: "Reports",
    purpose: "Generated reports with state and download. Export runs as a job with progress.",
    data: "GET /reports",
    need: "reports.view",
  },
  eventReport: {
    path: "/reports/:eventId",
    code: "D13b",
    title: "Event report",
    purpose: "One tab per report type, charted on the same hairline grid.",
    data: "GET /reports/:eventId · GET /reports/:eventId/:kind",
    need: "reports.view",
  },
  settings: {
    path: "/settings/:tab?",
    code: "D14",
    title: "Settings",
    purpose: "Organization, email, integrations and webhooks, retention and privacy, audit log, API keys.",
    data: "various",
    need: "settings.manage",
  },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenId = keyof typeof SCREENS;

const icon = (component: typeof LayoutGrid): ReactNode => createElement(component, { size: 16, strokeWidth: 1.5 });

/** What each event workspace tab needs (its screen's `need`), keyed by the tab's path segment. */
export const WORKSPACE_TAB_NEED = {
  overview: SCREENS.eventOverview.need,
  schedule: SCREENS.eventSchedule.need,
  rooms: SCREENS.eventRooms.need,
  attendees: SCREENS.eventAttendees.need,
  credentials: SCREENS.eventCredentials.need,
  staff: SCREENS.eventStaff.need,
  reports: SCREENS.eventReports.need,
  settings: SCREENS.eventSettings.need,
  summary: SCREENS.eventSummary.need,
} as const satisfies Record<string, Capability>;

export type WorkspaceTab = keyof typeof WORKSPACE_TAB_NEED;

export interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  /** What the signed-in role needs to see this entry (the screen it opens). */
  need: Capability;
}

export interface NavSection {
  label: string;
  items: NavEntry[];
}

/**
 * Three groups, in the order an operator's day runs (docs/06 §2.1): what is happening now (Live),
 * the event and its people (Event), and what is set up once (Setup). A role sees only what it may
 * open (`navFor`); a group left empty is dropped.
 */
export const NAV_GROUPS: NavSection[] = [
  {
    label: "Live",
    items: [
      { to: "/", label: "Command Center", icon: icon(LayoutGrid), end: true, need: SCREENS.command.need },
      { to: "/alerts", label: "Alerts", icon: icon(Bell), need: SCREENS.alerts.need },
      { to: "/gates", label: "Gate health", icon: icon(DoorOpen), need: SCREENS.gates.need },
      { to: "/access-log", label: "Access log", icon: icon(ScrollText), need: SCREENS.accessLog.need },
    ],
  },
  {
    label: "Event",
    items: [
      { to: "/events", label: "Events", icon: icon(CalendarDays), need: SCREENS.events.need },
      { to: "/attendees", label: "Attendees", icon: icon(Users), need: SCREENS.attendees.need },
      { to: "/desk", label: "Wristband desk", icon: icon(Nfc), need: SCREENS.desk.need },
      { to: "/reports", label: "Reports", icon: icon(ChartColumn), need: SCREENS.reports.need },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/venues", label: "Venues", icon: icon(Building), need: SCREENS.venues.need },
      { to: "/staff", label: "Staff & shifts", icon: icon(IdCard), need: SCREENS.staff.need },
      { to: "/settings", label: "Settings", icon: icon(Settings), need: SCREENS.settings.need },
    ],
  },
];

/**
 * Whether a role may open this path (after sign-in: stay on a deep link the role may open, or go
 * to where the role starts). Unknown paths answer false.
 */
export function mayOpen(pathname: string, can: (capability: Capability) => boolean): boolean {
  if (pathname === "/" || pathname === "") return true; // Home sends every role to its own start
  for (const screen of Object.values(SCREENS) as ScreenSpec[]) {
    if (screen.path === "/" || screen.path === SCREENS.signIn.path) continue;
    if (matchPath({ path: screen.path, end: true }, pathname)) {
      // A workspace tab opens inside the event workspace, whose own route needs events.view (App.tsx).
      const inWorkspace = screen.path.startsWith("/events/:id/") && screen.path !== SCREENS.eventSummary.path;
      return (!screen.need || can(screen.need)) && (!inWorkspace || can("events.view"));
    }
  }
  if (matchPath({ path: "/events/:id", end: true }, pathname)) return can("events.view");
  return false;
}

/**
 * The navigation a role sees: the entries it may open; a group with nothing left is dropped.
 * `Attendees` opens the selected event's attendee table for a role with the event workspace,
 * because the event is the context of every screen (docs/06 §2.2); a role without it (the
 * supervisor) gets the attendee lookup at `/attendees`.
 */
/**
 * Which navigation entry is active for a path: exactly one at a time. An entry is active on its
 * own path and the paths under it (Gate health on a gate's detail, Venues in the venue editor,
 * Alerts with an alert open). Inside an event workspace (`/events/:id/…`, its tabs and summary)
 * "Events" is the active entry and the workspace's own tabs say which tab you are on — so the
 * "Attendees" entry that leads into the workspace tab is never the active one; it is active only
 * as the top-level lookup at `/attendees`.
 */
export function navItemActive(item: { to: string; end?: boolean }, pathname: string): boolean {
  const to = item.to.split("?")[0] ?? item.to;
  if (/^\/events\/[^/]+\/attendees$/.test(to)) return false;
  if (item.end || to === "/") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function navFor(can: (capability: Capability) => boolean, eventId: string | null): NavSection[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => can(item.need))
      .map((item) =>
        item.to === "/attendees" && eventId && can("events.view") ? { ...item, to: `/events/${eventId}/attendees` } : item,
      ),
  })).filter((group) => group.items.length > 0);
}
