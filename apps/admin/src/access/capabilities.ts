/**
 * Who may do what in Admin Command (docs/01 §3, D-23): one map from role to capabilities.
 * Navigation, route guards, the landing page and every gated action read this file and
 * nothing else, so a role's view is changed here, once.
 *
 * Hiding is a convenience, never the control: the server checks the role on every request
 * (docs/03 §3). The map mirrors the server's matrix. When the "who am I" response
 * (GET /me/operator) carries `capabilities` — the contract endpoint names the role may call —
 * the session narrows the role's map by that list (`capabilitiesOf`, through
 * `CAPABILITY_ENDPOINT`): the server can take a capability away, never add one.
 */
// Types only from the enums module (its runtime would bring Zod into the bundle); the copy
// module is plain data.
import type { Role } from "@synan/contracts/enums";
import { ROLE_COPY } from "@synan/contracts/copy";

/** Every role a signed-in user can hold (D-23 landed in contracts). */
export type ConsoleRole = Role;

export const CAPABILITIES = [
  /* watch */
  "live.view", // Command Center, live pill, status bar
  "gates.view", // D12 gate health, D12b gate detail
  "rooms.recount", // set a room's count to a headcount (D-10)
  /* response */
  "alerts.view", // the alert strip and D10
  "alerts.acknowledge",
  "alerts.resolve",
  "scans.view", // D9 access log
  "scans.search", // D9 "Find a pass": one pass's scans, a credential access-history lookup (audited)
  /* events */
  "events.list", // D4 events
  "events.view", // open an event's workspace (overview, schedule, attendees table)
  "events.edit", // create, edit, publish, close; schedule; event settings
  "rules.view", // the tier × room matrix, read
  "rules.edit", // change and republish access rules
  /* venues and organisation */
  "venues.edit", // D2, D2b, D3
  "staff.manage", // D11, workspace Staff tab
  "settings.manage", // D14 organisation settings
  "setup.run", // D0 first run
  /* people and credentials */
  "attendees.view", // find an attendee, read their registration and pass
  "attendees.manage", // resend, revoke, rebind, change tier from the attendee console (D7)
  "credentials.view", // band inventory and credential states
  "credentials.review", // clear or revoke a pass under review (D-06)
  "desk.use", // the registration desk: find, bind, rebind, lost and replace, resend
  /* records */
  "reports.view",
  "reports.export",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * The contract endpoint (registry key) that grants each capability, so the server's
 * `capabilities` list can drive the console. One endpoint per capability: the one the screen
 * cannot work without.
 */
export const CAPABILITY_ENDPOINT: Record<Capability, string> = {
  "live.view": "dashboard",
  "gates.view": "gateHealth",
  "rooms.recount": "recountRoom",
  "alerts.view": "listAlerts",
  "alerts.acknowledge": "ackAlert",
  "alerts.resolve": "resolveAlert",
  "scans.view": "listScans",
  // No endpoint of its own: the server answers `q` on GET /scans for admins and organisers only.
  "scans.search": "listScans",
  "events.list": "listEventsAdmin",
  "events.view": "getEventAdmin",
  "events.edit": "updateEvent",
  "rules.view": "getAccessRules",
  "rules.edit": "putAccessRules",
  "venues.edit": "publishLayout",
  "staff.manage": "createAssignment",
  "settings.manage": "createOrganization",
  "setup.run": "createOrganization",
  "attendees.view": "eventRegistrations",
  "attendees.manage": "changeTier",
  "credentials.view": "listCredentials",
  "credentials.review": "clearReview",
  "desk.use": "rebindCarrier",
  "reports.view": "listReports",
  "reports.export": "exportReport",
};

const ALL: readonly Capability[] = CAPABILITIES;

/**
 * The map, mirroring the server (contracts' access lists, D-23). A role with an empty list has
 * no console and is shown the "no console" page.
 */
export const ROLE_CAPABILITIES: Record<ConsoleRole, readonly Capability[]> = {
  admin: ALL,
  organiser: [
    "live.view",
    "gates.view",
    "rooms.recount",
    "alerts.view",
    "alerts.acknowledge",
    "alerts.resolve",
    "scans.view",
    "scans.search",
    "events.list",
    "events.view",
    "events.edit",
    "rules.view",
    "rules.edit",
    "attendees.view",
    "attendees.manage",
    "credentials.view",
    "credentials.review",
    "desk.use",
    "reports.view",
    "reports.export",
  ],
  // The live event only: no event workspace (GET /events/:id/admin is operators only), no
  // editing, no export. Attendees are looked up, not browsed.
  supervisor: [
    "live.view",
    "gates.view",
    "rooms.recount",
    "alerts.view",
    "alerts.acknowledge",
    "alerts.resolve",
    "scans.view",
    "attendees.view",
    "credentials.view",
    "credentials.review",
  ],
  desk_clerk: ["desk.use"],
  security_staff: [],
  speaker: [],
  crew: [],
};

/** The role in plain words, from the contracts' copy. */
export const ROLE_LABEL = Object.fromEntries(
  (Object.keys(ROLE_COPY) as ConsoleRole[]).map((role) => [role, ROLE_COPY[role].label]),
) as Record<ConsoleRole, string>;

/** What a console role covers, in the words of "your console covers …". */
export const ROLE_PURPOSE: Record<ConsoleRole, string> = {
  admin: "Everything, including venues, staff and organisation settings.",
  organiser: "Events, attendees, credentials and reports.",
  supervisor: "The live event: Command Center, alerts, gates, the access log and attendee lookup.",
  desk_clerk: "The registration desk for the events you are assigned to.",
  security_staff: "Gate scanning at your assigned checkpoints, in the Gate Scanner.",
  speaker: "A credential with access to the rooms you speak in.",
  crew: "A credential with access to the areas you work in.",
};

export const CONSOLE_ROLES = Object.keys(ROLE_CAPABILITIES) as ConsoleRole[];

export function isConsoleRole(role: string): role is ConsoleRole {
  return role in ROLE_CAPABILITIES;
}

/**
 * Roles that may open the console at all: the ones with a non-empty list above, which is the
 * contracts' `CONSOLE_ROLES` (admin, organiser, supervisor, desk clerk).
 */
export function hasConsoleRole(role: string): boolean {
  return isConsoleRole(role) && ROLE_CAPABILITIES[role].length > 0;
}

/**
 * What the signed-in user may do: the role's map, narrowed by the server's endpoint list when it
 * sends one (a capability whose endpoint the server withholds is dropped). A role outside the console roles gets nothing, whatever the list says
 * (security staff may call some console endpoints from the scanner, but have no console).
 */
export function capabilitiesOf(user: { role: string; capabilities?: readonly string[] | null }): ReadonlySet<Capability> {
  if (!hasConsoleRole(user.role)) return new Set();
  const byRole = isConsoleRole(user.role) ? ROLE_CAPABILITIES[user.role] : [];
  if (user.capabilities) {
    // The server's list can only narrow the role's console, never widen it: an endpoint a role may
    // call for one screen (a desk clerk reads registrations for the desk) does not open another
    // screen built on it (the attendee lookup). Verified against the real API on 2026-11-24.
    const endpoints = new Set(user.capabilities);
    return new Set(byRole.filter((capability) => endpoints.has(CAPABILITY_ENDPOINT[capability])));
  }
  return new Set(byRole);
}

/** Where a role starts (D-23): the live picture if it watches, the desk if it works one. */
export function landingPath(can: ReadonlySet<Capability>): string {
  if (can.has("live.view")) return "/";
  if (can.has("desk.use")) return "/desk";
  if (can.has("events.list")) return "/events";
  return "/";
}

/** The landing page's name, for "Go to …" links. */
export function landingLabel(can: ReadonlySet<Capability>): string {
  if (can.has("live.view")) return "the Command Center";
  if (can.has("desk.use")) return "the desk";
  if (can.has("events.list")) return "Events";
  return "the start";
}
