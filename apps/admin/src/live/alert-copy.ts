/**
 * Words for alert kinds and severities.
 *
 * Belongs in `@synan/contracts/copy` next to SCAN_RESULT_COPY (02 §7: UI copy is
 * declared once, never retyped per screen). Requested from the backend; until it
 * lands it lives here, checked against the enums so a new kind is a type error.
 */
import type { AlertKind, Severity } from "@synan/contracts/enums";
import type { SignalState } from "@synan/ui/data";

export const ALERT_KIND_LABEL = {
  invalid_qr: "Invalid QR",
  pass_replayed: "Pass replayed",
  unauthorised_tier: "Unauthorised tier",
  impossible_travel: "Impossible travel",
  capacity_warn: "Near capacity",
  capacity_exceeded: "Capacity exceeded",
  offline_conflict_pass_reuse: "Offline conflict · pass reused",
  offline_conflict_passback: "Offline conflict · pass-back",
  offline_conflict_capacity: "Offline conflict · capacity",
  clock_skew: "Scanner clock wrong",
  gate_offline: "Gate offline",
  rogue_scanner: "Scanner outside assignment",
  stale_allowlist: "Stale allowlist",
  reconciliation_fault: "Count reconciliation",
  band_reported_lost: "Wristband reported lost",
} as const satisfies Record<AlertKind, string>;

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_VIEW = {
  critical: { label: "Critical", state: "stop", text: "text-destructive" },
  high: { label: "High", state: "stop", text: "text-destructive" },
  medium: { label: "Medium", state: "warn", text: "text-warning" },
  low: { label: "Low", state: "idle", text: "text-muted-foreground" },
} as const satisfies Record<Severity, { label: string; state: SignalState; text: string }>;

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}
