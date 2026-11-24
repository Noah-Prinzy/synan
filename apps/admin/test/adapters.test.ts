/**
 * The real API's shapes turned into the shapes the admin screens read (api/adapters.ts), failures
 * turned into words and field messages (api/failure.ts, kit/errors.ts), and the layout publish's
 * problems pinned to the zone or room the editor marks (api/configure.ts publishLayout). Every
 * fixture is parsed through the contracts' schemas, so a contract change breaks these tests.
 */
import { describe, expect, it, vi } from "vitest";
import { ERROR_COPY, FAILURE_COPY } from "@synan/contracts/copy";
import { ErrorCode } from "@synan/contracts/errors";
import {
  EventAdmin,
  EventAdminRow,
  EventLiveSummary,
  GateHealth,
  RegistrationRow,
  ScanRecord,
  StaffAssignment,
  VenueDetail,
  VenueListItem,
} from "@synan/contracts/rest";
import {
  canvasOf,
  carrierCounts,
  heartbeatAt,
  layoutIssues,
  toAssignmentRow,
  toAttendeeRow,
  toCommandEvent,
  toEventRecord,
  toEventRow,
  toLiveSummary,
  toOperatorContext,
  toOpsScan,
  toPassTemplate,
  toVenueDetail,
  toVenueLayout,
  toVenueRow,
} from "../src/api/adapters";
import type { ApiClient } from "../src/api/client";
import { createSharedCache } from "../src/api/command";
import { createConfigureApi } from "../src/api/configure";
import { ApiFailure, failureCopy, fieldKey, fieldsOf } from "../src/api/failure";
import { errorCode, errorCopy, fieldErrors, noAnswer } from "../src/kit/errors";

const ORG = "abababab-abab-4bab-8bab-abababababab";
const VENUE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const EVENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ZONE_A = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
const ZONE_B = "a9a9a9a9-a9a9-49a9-89a9-a9a9a9a9a9a9";
const ROOM_1 = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const ROOM_2 = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const GATE = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const USER = "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1";
const T = "2026-12-01T10:00:00.000Z";
const tiers = { VIP: 1, ORDINARY: 2, PRIVATE_INVITE: 3, PUBLIC: 4 };

const venueDetail = (p: Record<string, unknown> = {}) =>
  VenueDetail.parse({
    id: VENUE,
    org_id: ORG,
    name: "Nexus Hall",
    address: "1 Quay",
    timezone: "Europe/London",
    city: "London",
    zones: [
      { id: ZONE_A, venue_id: VENUE, name: "Ground", floor: "G", geometry: { kind: "polygon", points: [[0, 0], [10, 0], [10, 10]] } },
      { id: ZONE_B, venue_id: VENUE, name: "Upper", floor: "1", geometry: null },
    ],
    rooms: [
      { id: ROOM_1, venue_id: VENUE, zone_id: ZONE_A, name: "Main", capacity: 200, continuous: false, geometry: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } },
    ],
    checkpoints: [
      { id: GATE, venue_id: VENUE, zone_id: ZONE_A, room_id: null, direction: "in", perimeter: true, hardware_id: null, label: "Gate 1", position: { x: 0, y: 5, side: "w" } },
    ],
    ...p,
  });

describe("venues", () => {
  it("turn GET /venues/:id into the Command Center's layout, with gate positions keyed by gate", () => {
    const layout = toVenueLayout(venueDetail({ grid: { w: 40, h: 30 } }));
    expect(layout.venue).toMatchObject({ id: VENUE, name: "Nexus Hall", city: "London" });
    expect(layout.checkpoint_positions).toEqual({ [GATE]: { x: 0, y: 5, side: "w" } });
    expect(layout.grid).toEqual({ w: 96, h: 60 });
    expect(layout.rooms[0]).toMatchObject({ warn_at_pct: 85, block_at_pct: 100, capacity_policy: "block" });
  });

  it("grow the editor's canvas to hold every shape, never below the default", () => {
    expect(canvasOf(null)).toEqual({ w: 96, h: 60 });
    expect(canvasOf({ w: 120, h: 20 })).toEqual({ w: 120, h: 60 });
  });

  it("take the floors from the zones for a venue made before floors existed", () => {
    expect(toVenueDetail(venueDetail()).floors).toEqual(["G", "1"]);
    expect(toVenueDetail(venueDetail({ floors: ["B", "G"] })).floors).toEqual(["B", "G"]);
    expect(toVenueDetail(venueDetail())).toMatchObject({ layout_version: 0, layout_published_at: null, events: [], capacity_default: null });
  });

  it("flatten GET /venues counts into the venues table's row", () => {
    const item = VenueListItem.parse({
      id: VENUE, org_id: ORG, name: "Nexus Hall", address: "1 Quay", timezone: "Europe/London",
      counts: { zones: 2, rooms: 5, checkpoints: 3, capacity: 900, events: 4, active_events: 1 },
    });
    expect(toVenueRow(item)).toMatchObject({ zones: 2, rooms: 5, capacity: 900, active_events: 1, events: 4, floors: [], layout_published_at: null });
  });
});

describe("events", () => {
  const admin = (p: Record<string, unknown> = {}) =>
    EventAdmin.parse({
      id: EVENT, slug: "summit", title: "Summit", starts_at: T, ends_at: T, timezone: "Europe/London", state: "draft",
      venue: { id: VENUE, name: "Nexus Hall", city: "London" }, on_site: null, description: null,
      rooms: [{ room_id: ROOM_1, name: "Main", zone_id: ZONE_A, capacity: 200, capacity_override: 150 }], sessions: [],
      org_id: ORG, listed: true, grace_buffer_hours: 72,
      ...p,
    });

  it("turn GET /events/:id/admin into the workspace's record, filling what a draft lacks", () => {
    const record = toEventRecord(admin({ pass_template: { layout: "standard" }, updated_by: { id: USER, name: "Ada" } }));
    expect(record).toMatchObject({
      venue_id: VENUE,
      description: "",
      rooms: [{ room_id: ROOM_1, capacity_override: 150 }],
      access_rules_version: 0,
      wizard_step: "basics",
      updated_by: "Ada",
      published_at: null,
      closed_at: null,
      pass_template: { headline: "Summit", note: "", show_tier: true, show_sessions: true, wallet: true },
    });
    expect(record.created_at).toBe(new Date(0).toISOString());
    expect(toEventRecord(admin({ venue: null })).venue_id).toBeNull();
  });

  it("read a free-form pass template, keeping only well-typed fields", () => {
    expect(toPassTemplate(null, "X")).toBeNull();
    expect(toPassTemplate({ headline: "Hi", show_tier: false, wallet: "yes" }, "X")).toEqual({ headline: "Hi", note: "", show_tier: false, show_sessions: true, wallet: true });
  });

  it("turn an event list row into the events table's row and the selector's entry", () => {
    const row = EventAdminRow.parse({
      id: EVENT, slug: "summit", title: "Summit", state: "live", starts_at: T, ends_at: T, timezone: "Europe/London", listed: true,
      venue: { id: VENUE, name: "Nexus Hall", city: null }, registrations: 10, checked_in: 4, wizard_step: "review",
      published_at: T, created_at: T, updated_at: T, updated_by: null,
    });
    expect(toEventRow(row)).toMatchObject({ registrations: 10, checked_in: 4, updated_by: "" });
    expect(toCommandEvent(row)).toMatchObject({ id: EVENT, venue_name: "Nexus Hall", state: "live" });
    expect(toCommandEvent({ ...row, state: "draft" })).toBeNull();
    expect(toCommandEvent({ ...row, starts_at: null })).toBeNull();
    expect(toCommandEvent({ ...row, venue: null })?.venue_name).toBe("—");
  });

  it("give the KPI strip a one-bucket series per figure when the server sends none", () => {
    const summary = toLiveSummary(
      EventLiveSummary.parse({ event_id: EVENT, registered: 10, checked_in: 5, on_site: 3, by_tier: tiers, open_alerts: 1, as_of: "2026-12-01T10:00:42.000Z", series: [] }),
    );
    expect(summary.series).toEqual({
      bucket_ms: 60_000, from: "2026-12-01T10:00:00.000Z",
      registered: [10], checked_in: [5], on_site: [3], capacity_risk: [0], open_alerts: [1],
    });
  });
});

describe("people, gates and scans", () => {
  it("name the operator by display name, else email, invent no shift, and give a desk clerk only their events", () => {
    const base = { id: USER, email: "op@example.com", role: "organiser" as const, current_shift: null };
    expect(toOperatorContext({ ...base, display_name: "  " })).toMatchObject({ name: "op@example.com", shift: { label: "", starts_at: "", ends_at: "" }, event_ids: null });
    expect(toOperatorContext({ ...base, role: "desk_clerk", desk_event_ids: [EVENT] }).event_ids).toEqual([EVENT]);
    expect(toOperatorContext({ ...base, role: "desk_clerk" }).event_ids).toEqual([]);
    expect(toOperatorContext({ ...base, capabilities: ["dashboard"] }).capabilities).toEqual(["dashboard"]);
    expect("capabilities" in toOperatorContext(base)).toBe(false);
    const shift = { ...StaffAssignment.parse({ id: USER, user_id: USER, checkpoint_id: GATE, shift_start: T, shift_end: T }), checkpoint_label: "Gate 1" };
    expect(toOperatorContext({ ...base, current_shift: shift, shift_label: "Doors" }).shift).toEqual({ label: "Doors", starts_at: T, ends_at: T });
  });

  it("turn a registration into the attendee table's row", () => {
    const row = RegistrationRow.parse({
      id: USER, event_id: EVENT, tier: "VIP", state: "confirmed", zone_presence_consent_at: null, created_at: T,
      attendee: { id: USER, full_name: null, email: "a@example.com" }, checked_in_at: T, band_hint: "••81BF",
    });
    expect(toAttendeeRow(row)).toMatchObject({ checked_in: true, credential_state: null, band_hint: "••81BF", full_name: null, last_scan_at: null });
  });

  it("name an assignment's gate and person even when the server leaves the labels out", () => {
    const a = StaffAssignment.parse({ id: USER, user_id: USER, checkpoint_id: GATE, shift_start: T, shift_end: T });
    expect(toAssignmentRow(a)).toMatchObject({ staff_name: "Unknown", checkpoint_label: "Unknown gate", event_id: null, handed_over_at: null });
  });

  it("order a scan by the server's corrected time, and date a heartbeat from its age when only the age is sent", () => {
    const s = ScanRecord.parse({ id: USER, event_id: EVENT, checkpoint_id: GATE, ephemeral_id: null, carrier_kind: "nfc", result: "admitted", occurred_at: T, received_at: T, clock_offset_ms: -90_000, offline: true });
    expect(toOpsScan(s).corrected_at).toBe("2026-12-01T09:58:30.000Z");
    const g = GateHealth.parse({ checkpoint_id: GATE, label: "Gate 1", link_state: "offline", heartbeat_age_s: 30, last_heartbeat_at: null, queue_depth: 0, clock_offset_ms: null, clock_fault: false, scans_last_minute: 0 });
    expect(heartbeatAt(g, Date.parse(T))).toBe("2026-12-01T09:59:30.000Z");
    expect(heartbeatAt({ ...g, heartbeat_age_s: null }, Date.parse(T))).toBeNull();
  });

  it("show every band state, zero when the server leaves one out", () => {
    expect(carrierCounts({ bound: 3 })).toEqual({ stock: 0, assigned: 0, bound: 3, active: 0, retired: 0, lost: 0 });
  });
});

describe("failures", () => {
  it.each(ErrorCode.options)("show the contracts' words for %s", (code) => {
    const copy = failureCopy(new ApiFailure(code, ERROR_COPY[code].status));
    expect(copy).toMatchObject({ code, title: ERROR_COPY[code].title, message: ERROR_COPY[code].message, network: false });
    expect(errorCopy(new ApiFailure(code, 400))).toMatchObject({ code, title: ERROR_COPY[code].title });
  });

  it("say offline or unreachable when nothing answered", () => {
    expect(failureCopy(new ApiFailure("INTERNAL", 0, { kind: "network", offline: true }))).toMatchObject({ title: FAILURE_COPY.offline.title, message: FAILURE_COPY.offline.message, network: true, code: "INTERNAL" });
    expect(failureCopy(new ApiFailure("INTERNAL", 0, { kind: "network" }))).toMatchObject({ title: FAILURE_COPY.network.title, network: true });
    expect(noAnswer(new ApiFailure("INTERNAL", 0, { kind: "network" }))).toBe("unreachable");
    expect(errorCopy(new ApiFailure("INTERNAL", 0, { kind: "network", offline: true })).title).toBe(FAILURE_COPY.offline.title);
  });

  it("degrade to the generic message for anything that is not a known failure", () => {
    for (const thrown of [new Error("boom"), "boom", null, { code: "SOMETHING_NEW" }]) {
      expect(errorCode(thrown)).toBe("INTERNAL");
      expect(failureCopy(thrown)).toMatchObject({ code: "INTERNAL", title: ERROR_COPY.INTERNAL.title });
    }
    expect(errorCode(new Error("NOT_FOUND"))).toBe("NOT_FOUND");
  });

  it("key field messages by field: the request prefix dropped, the first message kept, the head filled too", () => {
    expect(fieldKey("body.rooms.3.zone_id")).toBe("rooms.3.zone_id");
    expect(fieldKey("zone:abc")).toBe("zone:abc");
    expect(fieldKey("body")).toBe("form");
    expect(
      fieldsOf([
        { path: "body.rules.3.room_id", message: "Unknown room" },
        { path: "body.rules.4.room_id", message: "Second" },
        { path: "query.q", message: "Too long" },
      ]),
    ).toEqual({ "rules.3.room_id": "Unknown room", rules: "Unknown room", "rules.4.room_id": "Second", q: "Too long" });
    expect(fieldErrors(new ApiFailure("VALIDATION_FAILED", 400, { issues: [{ path: "body.title", message: "Required" }] }))).toEqual({ title: "Required" });
  });
});

describe("publishing a layout", () => {
  const body = {
    expected_version: 4,
    floors: ["G"],
    zones: [{ id: ZONE_A, name: "Ground", floor: "G", geometry: null }],
    rooms: [
      { id: ROOM_1, zone_id: ZONE_A, name: "Main", capacity: 200, warn_at_pct: 85, block_at_pct: 100, continuous: false, capacity_policy: "block" as const, geometry: null },
      { id: ROOM_2, zone_id: ZONE_A, name: "Side", capacity: 0, warn_at_pct: 85, block_at_pct: 100, continuous: false, capacity_policy: "block" as const, geometry: null },
    ],
  };

  function publish(failure: ApiFailure) {
    const client = { call: vi.fn(async () => Promise.reject(failure)) } as unknown as ApiClient;
    return createConfigureApi(client, createSharedCache()).publishLayout(VENUE, body as never).then(
      () => {
        throw new Error("expected a failure");
      },
      (error: unknown) => error as ApiFailure,
    );
  }

  it("pins a row's problem to that room or zone by id", () => {
    expect(layoutIssues([{ path: "body.rooms.1.capacity", message: "Too small" }, { path: "body.zones.0", message: "Bad" }], body)).toEqual([
      { path: `room:${ROOM_2}`, message: "Too small" },
      { path: `zone:${ZONE_A}`, message: "Bad" },
    ]);
    // An index the body does not have, or another field, is left as it is.
    expect(layoutIssues([{ path: "body.rooms.9.capacity", message: "x" }, { path: "body.floors", message: "y" }], body)).toEqual([
      { path: "body.rooms.9.capacity", message: "x" },
      { path: "body.floors", message: "y" },
    ]);
  });

  it("marks the room with the problem when the server refuses the layout", async () => {
    const error = await publish(new ApiFailure("VALIDATION_FAILED", 400, { issues: [{ path: "body.rooms.1.capacity", message: "Too small" }] }));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.fields[`room:${ROOM_2}`]).toBe("Too small");
  });

  it("marks a zone still in use as a problem with that zone, not as someone else's publish", async () => {
    const error = await publish(new ApiFailure("CONFLICT", 409, { issues: [{ path: `zone:${ZONE_B}`, message: "An event uses it" }] }));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.serverCode).toBe("CONFLICT");
    expect(error.fields[`zone:${ZONE_B}`]).toBe("An event uses it");
  });

  it("keeps a stale version as CONFLICT: someone else published first", async () => {
    const error = await publish(new ApiFailure("CONFLICT", 409, { issues: [{ path: "body.expected_version", message: "Stale" }] }));
    expect(error.code).toBe("CONFLICT");
  });
});
