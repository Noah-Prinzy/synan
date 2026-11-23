import type { ReportKind } from "@synan/contracts/enums";

/** Report names (01 §10). Belongs in `@synan/contracts/copy` with the alert kinds; requested. */
export const REPORT_LABEL = {
  attendance: "Attendance",
  dwell_flow: "Dwell and flow",
  peak_occupancy: "Peak occupancy",
  breach_compliance: "Breach and compliance",
  gate_throughput: "Gate throughput",
} as const satisfies Record<ReportKind, string>;
