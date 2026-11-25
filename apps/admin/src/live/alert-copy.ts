/**
 * Words for alert kinds and severities.
 *
 * Alert kinds use `@synan/contracts/copy` ALERT_KIND_COPY, the one source (02 §7: UI copy is
 * declared once, never retyped per screen), so the console says what the contracts say.
 */
import { ALERT_KIND_COPY } from "@synan/contracts/copy";
import type { AlertKind, Severity } from "@synan/contracts/enums";
import type { SignalState } from "@synan/ui/data";

export const ALERT_KIND_LABEL = Object.fromEntries(
  (Object.keys(ALERT_KIND_COPY) as AlertKind[]).map((kind) => [kind, ALERT_KIND_COPY[kind].label]),
) as { readonly [K in AlertKind]: (typeof ALERT_KIND_COPY)[K]["label"] };

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
