/**
 * Real API shapes → the shapes the admin screens consume today (the mock's, `@synan/mock/command`).
 * Pure functions, types only from the mock (erased at build: no mock code reaches this path).
 *
 * Every difference is noted where it is bridged; index.ts lists them in one place.
 */
import type {
  CheckpointDirection,
  CredentialState,
  CarrierState,
  Role,
} from "@synan/contracts/enums";
import type {
  EventAdmin,
  EventAdminRow,
  EventLiveSummary,
  GateHealth,
  Organization,
  endpoints,
  ResponseOf,
  ScanRecord,
  StaffAssignment,
  Venue,
  VenueDetail as ContractVenueDetail,
  VenueListItem,
} from "@synan/contracts/rest";
import type {
  AssignmentRow,
  AttendeeListRow,
  CommandEvent,
  EventRecord,
  EventRow,
  GridPoint,
  LiveSummary,
  OpsScan,
  OperatorContext,
  PassTemplate,
  StaffRow,
  SummarySeries,
  VenueDetail,
  VenueLayout,
  VenueRow,
} from "@synan/mock/command";
import type { Issue } from "./failure";

type RegistrationRow = ResponseOf<(typeof endpoints)["eventRegistrations"]>["items"][number];

/** The editor's canvas when the server has no shapes yet (the mock's venues are 96 × 60). */
export const DEFAULT_GRID = { w: 96, h: 60 } as const;

/** The venue's own fields (the contract's additive layout fields stay on it, as optional). */
export function venueOf(v: Venue): Venue {
  return {
    id: v.id,
    org_id: v.org_id,
    name: v.name,
    address: v.address,
    timezone: v.timezone,
    city: v.city ?? null,
    floors: v.floors,
    capacity_default: v.capacity_default,
    layout_version: v.layout_version,
    layout_published_at: v.layout_published_at,
  };
}

/**
 * DIFFERENCE — `grid`: the mock's is the editor canvas (96 × 60); the server's is the bounding box
 * of the drawn shapes, or null. The canvas is at least the default and grows to hold every shape.
 */
export function canvasOf(grid: { w: number; h: number } | null | undefined): { w: number; h: number } {
  return { w: Math.max(DEFAULT_GRID.w, grid?.w ?? 0), h: Math.max(DEFAULT_GRID.h, grid?.h ?? 0) };
}

/** DIFFERENCE — floors: the mock always has them; a venue made before floors existed has none, so take the zones'. */
export function floorsOf(d: { floors?: string[] | undefined; zones: { floor: string | null }[] }): string[] {
  if (d.floors && d.floors.length > 0) return [...d.floors];
  const out: string[] = [];
  for (const zone of d.zones) if (zone.floor && !out.includes(zone.floor)) out.push(zone.floor);
  return out;
}

/** GET /venues/:id → the Command Center's layout. DIFFERENCE: `checkpoint_positions` is built from `checkpoints[].position`. */
export function toVenueLayout(d: ContractVenueDetail): VenueLayout {
  const positions: Record<string, GridPoint> = {};
  for (const checkpoint of d.checkpoints) if (checkpoint.position) positions[checkpoint.id] = checkpoint.position;
  return {
    venue: venueOf(d),
    zones: d.zones,
    rooms: d.rooms,
    checkpoints: d.checkpoints,
    grid: canvasOf(d.grid),
    checkpoint_positions: positions,
  };
}

/** GET /venues/:id → the venue editor's detail. DIFFERENCE: flat on the server, `{ venue, … }` in the mock. */
export function toVenueDetail(d: ContractVenueDetail): VenueDetail {
  return {
    venue: venueOf(d),
    floors: floorsOf(d),
    capacity_default: d.capacity_default ?? null,
    grid: canvasOf(d.grid),
    zones: d.zones,
    rooms: d.rooms,
    checkpoints: d.checkpoints,
    layout_version: d.layout_version ?? 0,
    layout_published_at: d.layout_published_at ?? null,
    events: d.events ?? [],
  };
}

/** One GET /venues item → D2's row. DIFFERENCE: counts nest under `counts` on the server. */
export function toVenueRow(item: VenueListItem): VenueRow {
  return {
    venue: venueOf(item),
    floors: item.floors ? [...item.floors] : [],
    zones: item.counts.zones,
    rooms: item.counts.rooms,
    capacity: item.counts.capacity,
    active_events: item.counts.active_events,
    events: item.counts.events,
    layout_published_at: item.layout_published_at ?? null,
  };
}

/**
 * DIFFERENCE — the layout publish's issues: the server names rows by index (`body.rooms.3.zone_id`)
 * and, when a zone or room in use would be removed, by id (`zone:<id>`, with 409 CONFLICT). The editor
 * reads `room:<id>` / `zone:<id>` keys, so index paths are turned into id keys against the body sent.
 */
export function layoutIssues(issues: readonly Issue[], body: { zones: { id: string }[]; rooms: { id: string }[] }): Issue[] {
  return issues.map((issue) => {
    const m = /^body\.(zones|rooms)\.(\d+)(?:\.|$)/.exec(issue.path);
    if (!m) return issue;
    const row = m[1] === "zones" ? body.zones[Number(m[2])] : body.rooms[Number(m[2])];
    return row ? { path: `${m[1] === "zones" ? "zone" : "room"}:${row.id}`, message: issue.message } : issue;
  });
}

/**
 * DIFFERENCE — `pass_template`: free-form on the server (`Record<string, unknown>`; the dev seed's is
 * `{ layout: "standard" }`); the mock types it. Missing fields take the wizard's defaults.
 */
export function toPassTemplate(raw: Record<string, unknown> | null | undefined, title: string): PassTemplate | null {
  if (!raw) return null;
  const text = (key: string, fallback: string) => (typeof raw[key] === "string" ? (raw[key] as string) : fallback);
  const flag = (key: string, fallback: boolean) => (typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback);
  return {
    headline: text("headline", title),
    note: text("note", ""),
    show_tier: flag("show_tier", true),
    show_sessions: flag("show_sessions", true),
    wallet: flag("wallet", true),
  };
}

/** GET /events/:id/admin → the workspace's record. */
export function toEventRecord(e: EventAdmin): EventRecord {
  const created = e.created_at ?? e.published_at ?? new Date(0).toISOString();
  return {
    id: e.id,
    org_id: e.org_id,
    slug: e.slug,
    title: e.title,
    description: e.description ?? "",
    state: e.state,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    timezone: e.timezone,
    // DIFFERENCE: the server nests the venue ({ id, name, city }); the mock keeps its id.
    venue_id: e.venue?.id ?? null,
    listed: e.listed,
    grace_buffer_hours: e.grace_buffer_hours,
    // DIFFERENCE: rooms carry name, zone and the capacity in force too; the mock keeps id + override.
    rooms: e.rooms.map((room) => ({ room_id: room.room_id, capacity_override: room.capacity_override ?? null })),
    pass_template: toPassTemplate(e.pass_template, e.title),
    access_rules_version: e.access_rules_version ?? 0,
    wizard_step: e.wizard_step ?? "basics",
    created_at: created,
    updated_at: e.updated_at ?? created,
    // DIFFERENCE: an OperatorRef ({ id, name }) on the server; the mock keeps the name.
    updated_by: e.updated_by?.name ?? "",
    published_at: e.published_at ?? null,
    closed_at: e.closed_at ?? null,
  };
}

/** One GET /admin/events item → D4's row. DIFFERENCE: `updated_by` is an OperatorRef on the server. */
export function toEventRow(r: EventAdminRow): EventRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    state: r.state,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    timezone: r.timezone,
    venue: r.venue,
    registrations: r.registrations,
    checked_in: r.checked_in,
    listed: r.listed,
    updated_at: r.updated_at,
    updated_by: r.updated_by?.name ?? "",
  };
}

/** An event row → the selector's entry. Drafts and events without dates are not in the selector (as in the mock). */
export function toCommandEvent(r: {
  id: string;
  slug: string;
  title: string;
  state: CommandEvent["state"];
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue: { name: string } | null;
}): CommandEvent | null {
  if (r.state === "draft" || !r.starts_at || !r.ends_at) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    state: r.state,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    venue_name: r.venue?.name ?? "—",
    timezone: r.timezone,
  };
}

/**
 * GET /events/:id/summary → the KPI strip's summary. DIFFERENCE: the server's `series` is per-minute
 * gate throughput and the per-figure series is `kpi_series`; the mock's `series` is the per-figure one.
 * Without `kpi_series` (series_minutes=0) each figure is a one-bucket series of its value now.
 */
export function toLiveSummary(s: EventLiveSummary): LiveSummary {
  const { series: _throughput, kpi_series, ...rest } = s;
  const series: SummarySeries = kpi_series
    ? { ...kpi_series }
    : {
        bucket_ms: 60_000,
        from: new Date(Math.floor(Date.parse(s.as_of) / 60_000) * 60_000).toISOString(),
        registered: [s.registered],
        checked_in: [s.checked_in],
        on_site: [s.on_site],
        capacity_risk: [s.capacity_risk ?? 0],
        open_alerts: [s.open_alerts],
      };
  return { ...rest, series };
}

/**
 * GET /me/operator → who is signed in. DIFFERENCES: no display name on the server (the email stands
 * in); `shift` is the current staff assignment or null (an admin rarely has one: the sign-in session
 * stands in, labelled "Signed in"); `event_ids` comes from `desk_event_ids` for a desk clerk.
 */
export function toOperatorContext(
  p: {
    id: string;
    email: string;
    role: Role;
    current_shift: (StaffAssignment & { checkpoint_label: string }) | null;
    capabilities?: string[] | undefined;
    desk_event_ids?: string[] | undefined;
  },
  session: { signed_in_at: number; refresh_expires_at: number } | null,
  now: number,
): OperatorContext {
  const shift = p.current_shift
    ? { label: p.current_shift.checkpoint_label || "Shift", starts_at: p.current_shift.shift_start, ends_at: p.current_shift.shift_end }
    : {
        label: "Signed in",
        starts_at: new Date(session?.signed_in_at ?? now).toISOString(),
        ends_at: new Date(session?.refresh_expires_at ?? now).toISOString(),
      };
  return {
    id: p.id,
    name: p.email,
    email: p.email,
    role: p.role,
    shift,
    event_ids: p.role === "desk_clerk" ? (p.desk_event_ids ?? []) : null,
    ...(p.capabilities ? { capabilities: p.capabilities } : {}),
  };
}

/** One GET /events/:id/registrations item → D6.4's row. DIFFERENCE: `last_scan_at` is not served (null). */
export function toAttendeeRow(r: RegistrationRow): AttendeeListRow {
  return {
    registration_id: r.id,
    attendee_id: r.attendee.id,
    full_name: r.attendee.full_name,
    email: r.attendee.email,
    tier: r.tier,
    state: r.state,
    credential_state: r.credential_state ?? null,
    band_hint: r.band_hint ?? null,
    checked_in: !!r.checked_in_at,
    last_scan_at: null,
  };
}

/** GET /staff item → StaffRow. DIFFERENCE: `display_name` (nullable) instead of `name`; the email stands in. */
export function toStaffRow(m: { id: string; email: string; role: Role; mfa_enrolled: boolean; display_name?: string | null | undefined }): StaffRow {
  return { id: m.id, name: m.display_name || m.email, email: m.email, role: m.role, mfa_enrolled: m.mfa_enrolled };
}

/** GET /staff-assignments item → AssignmentRow. DIFFERENCE: the labels are optional on the server. */
export function toAssignmentRow(a: StaffAssignment): AssignmentRow {
  return {
    id: a.id,
    user_id: a.user_id,
    checkpoint_id: a.checkpoint_id,
    shift_start: a.shift_start,
    shift_end: a.shift_end,
    event_id: a.event_id ?? null,
    handed_over_at: a.handed_over_at ?? null,
    staff_name: a.staff_name ?? "Unknown",
    checkpoint_label: a.checkpoint_label ?? "Unknown gate",
  };
}

const CARRIER_STATES: readonly CarrierState[] = ["stock", "assigned", "bound", "active", "retired", "lost"];
const CREDENTIAL_STATES: readonly CredentialState[] = ["issued", "active", "suspended_review", "revoked", "replaced"];

/** Every state present (the server may leave out a state with no members). */
export function fullCounts<S extends string>(states: readonly S[], counts: Partial<Record<S, number>> | undefined): Record<S, number> {
  return Object.fromEntries(states.map((state) => [state, counts?.[state] ?? 0])) as Record<S, number>;
}
export const carrierCounts = (counts: Partial<Record<CarrierState, number>> | undefined) => fullCounts(CARRIER_STATES, counts);
export const credentialCounts = (counts: Partial<Record<CredentialState, number>> | undefined) => fullCounts(CREDENTIAL_STATES, counts);

/**
 * A ScanRecord → the access log's row. DIFFERENCES: `tier` is not on GET /scans (null);
 * `corrected_at` is derived as occurred_at + clock_offset_ms (the server's ordering time);
 * `latency_ms` is not served (null).
 */
export function toOpsScan(s: ScanRecord): OpsScan {
  return {
    ...s,
    tier: null,
    corrected_at: new Date(Date.parse(s.occurred_at) + s.clock_offset_ms).toISOString(),
    latency_ms: null,
  };
}

/** The organisation's time zone, for a new draft that names none. */
export function zoneOf(org: Organization | null): string {
  return org?.timezone ?? "UTC";
}

/** GateHealth with the heartbeat age turned into a time (the server may send only the age). */
export function heartbeatAt(g: GateHealth, now: number): string | null {
  if (g.last_heartbeat_at) return g.last_heartbeat_at;
  return g.heartbeat_age_s == null ? null : new Date(now - g.heartbeat_age_s * 1000).toISOString();
}

export type { CheckpointDirection };
