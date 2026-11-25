/**
 * Who sees what in Admin Command (access/capabilities.ts, routes.ts, D-23): for every role, exactly
 * the navigation entries and the routes it may open; one active navigation entry for every route;
 * the server's capability list only ever narrowing a role; and the role map agreeing with the
 * contracts' access lists, so a screen is never offered to a role the server would refuse.
 */
import { describe, expect, it } from "vitest";
import { Role } from "@synan/contracts/enums";
import { endpoints, type EndpointName } from "@synan/contracts/rest";
import {
  CAPABILITIES,
  CAPABILITY_ENDPOINT,
  capabilitiesOf,
  hasConsoleRole,
  landingPath,
  ROLE_CAPABILITIES,
  type Capability,
  type ConsoleRole,
} from "../src/access/capabilities";
import { mayOpen, NAV_GROUPS, navFor, navItemActive, SCREENS, WORKSPACE_TAB_NEED } from "../src/routes";

const can = (role: ConsoleRole) => {
  const set = capabilitiesOf({ role });
  return (capability: Capability) => set.has(capability);
};
const labels = (role: ConsoleRole, eventId: string | null = null) => navFor(can(role), eventId).flatMap((g) => g.items.map((i) => i.label));

describe("the role map", () => {
  it("covers every role the contracts define", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...Role.options].sort());
  });

  it("names only known capabilities, each granted by an endpoint that exists in the contracts", () => {
    for (const list of Object.values(ROLE_CAPABILITIES)) for (const capability of list) expect(CAPABILITIES).toContain(capability);
    for (const capability of CAPABILITIES) expect(endpoints).toHaveProperty(CAPABILITY_ENDPOINT[capability]);
  });

  it("never gives a role a screen whose endpoint the server refuses that role", () => {
    for (const role of Role.options) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        const def = endpoints[CAPABILITY_ENDPOINT[capability] as EndpointName];
        expect(def.access, `${role} · ${capability}`).toContain(role);
      }
    }
  });

  it("opens the console only for admin, organiser, supervisor and desk clerk", () => {
    expect(Role.options.filter(hasConsoleRole).sort()).toEqual(["admin", "desk_clerk", "organiser", "supervisor"]);
  });

  it("starts each role where its work is", () => {
    expect(landingPath(capabilitiesOf({ role: "admin" }))).toBe("/");
    expect(landingPath(capabilitiesOf({ role: "organiser" }))).toBe("/");
    expect(landingPath(capabilitiesOf({ role: "supervisor" }))).toBe("/");
    expect(landingPath(capabilitiesOf({ role: "desk_clerk" }))).toBe("/desk");
  });
});

describe("the server's capability list", () => {
  const all = Object.keys(endpoints);

  it("can take a capability away", () => {
    const organiser = capabilitiesOf({ role: "organiser", capabilities: all.filter((name) => name !== "exportReport") });
    expect(organiser.has("reports.export")).toBe(false);
    expect(organiser.has("reports.view")).toBe(true);
  });

  it("can never add one, even when it lists every endpoint", () => {
    expect([...capabilitiesOf({ role: "desk_clerk", capabilities: all })]).toEqual(["desk.use"]);
    expect([...capabilitiesOf({ role: "supervisor", capabilities: all })].sort()).toEqual([...ROLE_CAPABILITIES.supervisor].sort());
  });

  it("gives a role without a console nothing, whatever it lists", () => {
    for (const role of ["security_staff", "speaker", "crew", "not-a-role"]) expect(capabilitiesOf({ role, capabilities: all }).size).toBe(0);
  });

  it("leaves the role's map as it is when absent, and takes everything away when empty", () => {
    expect(capabilitiesOf({ role: "organiser" }).size).toBe(ROLE_CAPABILITIES.organiser.length);
    expect(capabilitiesOf({ role: "organiser", capabilities: null }).size).toBe(ROLE_CAPABILITIES.organiser.length);
    expect(capabilitiesOf({ role: "organiser", capabilities: [] }).size).toBe(0);
  });
});

describe("navigation", () => {
  it("shows each role exactly its entries", () => {
    expect(labels("admin")).toEqual([
      "Command Center", "Alerts", "Gate health", "Access log",
      "All events", "New event",
      "Attendees", "Wristband desk", "Staff & shifts",
      "Venues", "Reports", "Settings",
    ]);
    expect(labels("organiser")).toEqual(["Command Center", "Alerts", "Gate health", "Access log", "All events", "New event", "Attendees", "Wristband desk", "Reports"]);
    expect(labels("supervisor")).toEqual(["Command Center", "Alerts", "Gate health", "Access log", "Attendees"]);
    expect(labels("desk_clerk")).toEqual(["Wristband desk"]);
    for (const role of ["security_staff", "speaker", "crew"] as const) expect(navFor(can(role), null)).toEqual([]);
  });

  it("drops a group with nothing left in it", () => {
    expect(navFor(can("supervisor"), null).map((g) => g.label)).toEqual(["Live", "People"]);
    expect(navFor(can("desk_clerk"), null).map((g) => g.label)).toEqual(["People"]);
  });

  it("sends Attendees into the selected event's table for a role with the workspace, and to the lookup otherwise", () => {
    const find = (role: ConsoleRole) => navFor(can(role), "e1").flatMap((g) => g.items).find((i) => i.label === "Attendees")?.to;
    expect(find("organiser")).toBe("/events/e1/attendees");
    expect(find("supervisor")).toBe("/attendees");
  });

  it("marks exactly one entry active on every route that has one", () => {
    const expected: Record<string, string | null> = {
      "/": "Command Center",
      "/alerts": "Alerts",
      "/gates": "Gate health",
      "/gates/g1": "Gate health",
      "/access-log": "Access log",
      "/events": "All events",
      "/events/new": "New event",
      "/events/new/venue": "New event",
      "/events/e1": "All events",
      "/events/e1/overview": "All events",
      "/events/e1/attendees": "All events",
      "/events/e1/summary": "All events",
      "/attendees": "Attendees",
      "/desk": "Wristband desk",
      "/reports": "Reports",
      "/reports/e1": "Reports",
      "/venues": "Venues",
      "/venues/new": "Venues",
      "/venues/v1": "Venues",
      "/staff": "Staff & shifts",
      "/settings": "Settings",
      "/settings/audit": "Settings",
      "/setup": null,
      "/events-archive": null,
      "/desks": null,
    };
    for (const eventId of [null, "e1"]) {
      const items = navFor(can("admin"), eventId).flatMap((g) => g.items);
      for (const [path, label] of Object.entries(expected)) {
        const active = items.filter((item) => navItemActive(item, path)).map((item) => item.label);
        // With an event selected, Attendees leads into the workspace, and the bare lookup at
        // /attendees (reached only by a typed link) lights no entry.
        const want = path === "/attendees" && eventId ? null : label;
        expect(active, `${path} (event ${eventId})`).toEqual(want ? [want] : []);
      }
    }
  });
});

describe("routes", () => {
  /** A concrete path for every screen. */
  const sample: Record<keyof typeof SCREENS, string> = {
    command: "/",
    setup: "/setup",
    signIn: "/sign-in",
    venues: "/venues",
    venueNew: "/venues/new",
    venueEditor: "/venues/v1",
    events: "/events",
    eventNew: "/events/new/basics",
    eventOverview: "/events/e1/overview",
    eventSchedule: "/events/e1/schedule",
    eventRooms: "/events/e1/rooms",
    eventAttendees: "/events/e1/attendees",
    eventCredentials: "/events/e1/credentials",
    eventStaff: "/events/e1/staff",
    eventReports: "/events/e1/reports",
    eventSummary: "/events/e1/summary",
    eventSettings: "/events/e1/settings",
    attendees: "/attendees",
    desk: "/desk",
    accessLog: "/access-log",
    alerts: "/alerts",
    staff: "/staff",
    gates: "/gates",
    gateDetail: "/gates/g1",
    reports: "/reports",
    eventReport: "/reports/e1",
    settings: "/settings/audit",
  };

  it("open for a role exactly when the router lets it in: the screen's capability, and the workspace's for a workspace tab", () => {
    // As App.tsx nests them: every tab under /events/:id sits inside the workspace route (events.view).
    const workspaceTabs = new Set(Object.keys(WORKSPACE_TAB_NEED).filter((tab) => tab !== "summary").map((tab) => `/events/e1/${tab}`));
    for (const role of Role.options) {
      for (const [id, path] of Object.entries(sample) as [keyof typeof SCREENS, string][]) {
        if (id === "command" || id === "signIn") continue;
        const need = (SCREENS[id] as { need?: Capability }).need;
        const router = (need ? can(role)(need) : true) && (!workspaceTabs.has(path) || can(role)("events.view"));
        expect(mayOpen(path, can(role)), `${role} ${path}`).toBe(router);
      }
    }
  });

  it("keep the desk clerk to the desk and the supervisor out of the event workspace", () => {
    const clerk = can("desk_clerk");
    expect(Object.values(sample).filter((path) => path !== "/" && path !== "/sign-in" && mayOpen(path, clerk))).toEqual(["/desk"]);
    const supervisor = can("supervisor");
    for (const path of ["/events", "/events/e1", "/events/e1/overview", "/events/e1/attendees", "/venues", "/reports"]) {
      expect(mayOpen(path, supervisor), path).toBe(false);
    }
    expect(mayOpen("/attendees", supervisor)).toBe(true);
  });

  it("send everyone home to their own start, and refuse a path that is not a screen", () => {
    for (const role of Role.options) expect(mayOpen("/", can(role))).toBe(true);
    expect(mayOpen("/no-such-screen", can("admin"))).toBe(false);
    expect(mayOpen("/events/e1/no-such-tab", can("admin"))).toBe(false);
  });

  it("guard each workspace tab with its screen's capability", () => {
    expect(WORKSPACE_TAB_NEED.overview).toBe("events.view");
    expect(WORKSPACE_TAB_NEED.staff).toBe("staff.manage");
    expect(WORKSPACE_TAB_NEED.settings).toBe("events.edit");
    for (const tab of Object.keys(WORKSPACE_TAB_NEED)) {
      expect(mayOpen(`/events/e1/${tab}`, can("organiser"))).toBe(can("organiser")(WORKSPACE_TAB_NEED[tab as keyof typeof WORKSPACE_TAB_NEED]));
    }
  });

  it("put every navigation entry on a route the same role may open", () => {
    for (const role of Role.options) {
      for (const item of navFor(can(role), "e1").flatMap((g) => g.items)) expect(mayOpen(item.to, can(role)), `${role} ${item.to}`).toBe(true);
    }
    expect(NAV_GROUPS.flatMap((g) => g.items)).toHaveLength(12);
  });
});
