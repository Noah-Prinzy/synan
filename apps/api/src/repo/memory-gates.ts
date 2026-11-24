/**
 * In-memory gate health and shift handover, mirroring @synan/db 0014 (device_heartbeat,
 * gate_health, staff_on_duty, shift_handover_summary, shift_handover).
 */
import type { MemoryTables } from "./memory.js";
import type { AuditRow, GateHealthDbRow, HandoverRow } from "./types.js";

const REFUSED = new Set(["denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"]);
const corrected = (s: { occurred_at: Date; clock_offset_ms: number }) => s.occurred_at.getTime() + s.clock_offset_ms;

export function memoryGateHealth(t: MemoryTables, venueId: string, eventId: string | null, now: Date): GateHealthDbRow[] {
  const at = now.getTime();
  const rows = [...t.checkpoints.values()]
    .filter((c) => c.venue_id === venueId)
    .map((c): GateHealthDbRow => {
      const hb = t.checkpointHealth.get(c.id) ?? null;
      const age = hb ? Math.floor((at - hb.at.getTime()) / 1000) : null;
      const depths = [...t.devices.values()].filter((d) => d.checkpoint_id === c.id && d.state === "active" && d.last_queue_depth !== null).map((d) => d.last_queue_depth!);
      // 0029: the oldest allowlist among active devices heard from in the last 15 minutes.
      const lists = [...t.devices.values()]
        .filter((d) => d.checkpoint_id === c.id && d.state === "active" && d.allowlist_issued_at && d.last_heartbeat_at && d.last_heartbeat_at.getTime() > at - 15 * 60_000)
        .map((d) => d.allowlist_issued_at!.getTime());
      const allowlist = lists.length ? new Date(Math.min(...lists)) : null;
      const scans = eventId ? [...t.scans.values()].filter((s) => s.event_id === eventId && s.checkpoint_id === c.id) : [];
      const times = scans.map(corrected);
      return {
        checkpoint_id: c.id, label: c.label, perimeter: c.perimeter_bool,
        link_state: !hb ? "unknown" : at - hb.at.getTime() > 60_000 ? "offline" : "online",
        last_heartbeat_at: hb?.at ?? null, heartbeat_age_s: age, clock_offset_ms: hb?.clockOffsetMs ?? null,
        clock_fault: hb?.clockOffsetMs != null && Math.abs(hb.clockOffsetMs) > 120_000,
        queue_depth: depths.length ? Math.max(...depths) : null,
        last_scan_at: times.length ? new Date(Math.max(...times)) : null,
        scans_last_15m: scans.filter((s) => s.result !== "implied_exit" && corrected(s) > at - 15 * 60_000 && corrected(s) <= at).length,
        staff_on_duty: [...t.staffAssignments.values()].filter(
          (a) => a.checkpoint_id === c.id && a.shift_start.getTime() <= at && at < a.shift_end.getTime() && (!a.handed_over_at || a.handed_over_at.getTime() > at),
        ).length,
        position: c.position_jsonb ? structuredClone(c.position_jsonb) : null,
        allowlist_issued_at: allowlist,
        allowlist_stale: allowlist !== null && allowlist.getTime() < at - 15 * 60_000,
      };
    });
  const down = (r: GateHealthDbRow) => (r.link_state === "online" ? 0 : 1);
  return rows.sort((a, b) => down(b) - down(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export function memoryHandoverSummary(t: MemoryTables, assignmentId: string): HandoverRow | null {
  const a = t.staffAssignments.get(assignmentId);
  if (!a) return null;
  const pend = a.handed_over_at && a.handed_over_at < a.shift_end ? a.handed_over_at : a.shift_end;
  const s = [...t.scans.values()].filter(
    (x) =>
      x.checkpoint_id === a.checkpoint_id && x.staff_user_id === a.user_id && (!a.event_id || x.event_id === a.event_id) &&
      corrected(x) >= a.shift_start.getTime() && corrected(x) < pend.getTime() && x.result !== "implied_exit",
  );
  // 0034: an undone scan (scan_voids) is not let through and not in by_result; it counts as undone.
  const voided = new Set(t.scanVoids.map((v) => `${v.event_id}|${v.scan_id}`));
  const isVoided = (x: (typeof s)[number]) => voided.has(`${x.event_id}|${x.id}`);
  const standing = s.filter((x) => !isVoided(x));
  const by: Record<string, number> = {};
  for (const x of standing) by[x.result] = (by[x.result] ?? 0) + 1;
  const times = s.map(corrected);
  return {
    assignment_id: a.id, checkpoint_id: a.checkpoint_id, user_id: a.user_id, period_start: a.shift_start, period_end: pend,
    scans: s.length, let_through: standing.filter((x) => x.result === "admitted" || x.result === "already_inside").length,
    refused: s.filter((x) => REFUSED.has(x.result)).length, duplicates: s.filter((x) => x.result === "duplicate_read").length,
    offline: s.filter((x) => x.offline_bool).length, late_synced: s.filter((x) => x.received_at >= pend).length, by_result: by,
    first_scan_at: times.length ? new Date(Math.min(...times)) : null, last_scan_at: times.length ? new Date(Math.max(...times)) : null,
    undone: s.length - standing.length,
  };
}

/** Stamps the handover once and audits it (`staff.handover`, the summary without ids), like shift_handover. */
export function memoryHandOver(
  t: MemoryTables,
  audit: (e: Pick<AuditRow, "actor_id" | "action" | "target" | "meta_jsonb" | "at">) => unknown,
  assignmentId: string,
  i: { actorId: string | null; now: Date },
): HandoverRow | "already_handed_over" | null {
  const a = t.staffAssignments.get(assignmentId);
  if (!a) return null;
  if (a.handed_over_at) return "already_handed_over";
  a.handed_over_at = i.now;
  const sum = memoryHandoverSummary(t, assignmentId)!;
  const { assignment_id: _a, checkpoint_id: _c, user_id: _u, by_result: _b, ...meta } = sum;
  audit({ actor_id: i.actorId, action: "staff.handover", target: `staff_assignment:${assignmentId}`, meta_jsonb: JSON.parse(JSON.stringify(meta)), at: i.now });
  return sum;
}
