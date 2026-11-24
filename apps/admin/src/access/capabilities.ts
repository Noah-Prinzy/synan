/**
 * Who may do what in Admin Command (docs/01 §3, D-23): one map from role to capabilities.
 * Navigation, route guards, the landing page and every gated action read this file and
 * nothing else, so a role's view is changed here, once.
 *
 * Hiding is a convenience, never the control: the server checks the role on every request
 * (docs/03 §3). When the API's "who am I" (GET /me/operator) sends `capabilities`, the session
 * uses that list instead of this map (see `capabilitiesOf`); nothing else changes.
 */
import type { Role } from "@synan/contracts/enums";

/**
 * Every role a signed-in user can hold. `supervisor` and `desk_clerk` are not in the contracts'
 * `Role` enum yet (D-23); when they land, this line becomes `export type ConsoleRole = Role;`.
 */
export type ConsoleRole = Role | "supervisor" | "desk_clerk";

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
  /* events */
  "events.list", // D4 events and the event wizard's entry
  "events.view", // open an event's workspace (overview, schedule) to read
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
  "credentials.view", // band inventory and provisioning overview
  "credentials.review", // clear or revoke a pass under review (D-06)
  "desk.use", // the registration desk: find, bind, rebind, lost and replace, resend
  /* records */
  "reports.view",
  "reports.export",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL: readonly Capability[] = CAPABILITIES;

/** The map. An empty list means the role has no console (it is shown the "no console" page). */
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
  supervisor: [
    "live.view",
    "gates.view",
    "rooms.recount",
    "alerts.view",
    "alerts.acknowledge",
    "alerts.resolve",
    "scans.view",
    "events.view",
    "rules.view",
    "attendees.view",
    "credentials.review",
  ],
  desk_clerk: ["desk.use"],
  security_staff: [],
  speaker: [],
  crew: [],
};

/** The role in plain words, for the operator menu and the "not for your role" page. */
export const ROLE_LABEL: Record<ConsoleRole, string> = {
  admin: "Admin",
  organiser: "Organiser",
  supervisor: "Supervisor",
  desk_clerk: "Desk clerk",
  security_staff: "Security staff",
  speaker: "Speaker",
  crew: "Crew",
};

/** One line on what the role is for, shown where a role is explained. */
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
 * What the signed-in user may do: the server's list when it sends one, otherwise the map.
 * Unknown names from the server are ignored, so a newer server never breaks an older console.
 */
export function capabilitiesOf(user: { role: string; capabilities?: readonly string[] | null }): ReadonlySet<Capability> {
  if (user.capabilities) {
    const known = new Set<string>(CAPABILITIES);
    return new Set(user.capabilities.filter((c): c is Capability => known.has(c)));
  }
  return new Set(isConsoleRole(user.role) ? ROLE_CAPABILITIES[user.role] : []);
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
