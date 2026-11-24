/**
 * The KPI strip (docs/06 §2.3 D1): Registered · Checked in · On site now · Capacity
 * risk · Open alerts. Mono numerals at 40px; the change over 15 minutes and an
 * hour's sparkline beneath. The three counts are eased by the frame loop; the two
 * risk figures are small integers and render directly.
 */
import { KpiCell, SignalShape, Sparkline, formatNumber } from "@synan/ui/data";
import { SEVERITY_VIEW, severityRank } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import type { RoomLive } from "../live/store";

function countLevel(rooms: ReadonlyMap<string, RoomLive>, level: RoomLive["level"]): number {
  let n = 0;
  for (const room of rooms.values()) if (room.level === level) n++;
  return n;
}
import type { LiveSummary } from "../live/transport";
import { LiveNumber } from "./ui-state";

const WINDOW = 15;

function delta(values: readonly number[] | undefined): string {
  if (!values || values.length < 2) return "—";
  const last = values[values.length - 1] as number;
  const back = values[Math.max(0, values.length - 1 - WINDOW)] as number;
  return `${formatNumber(last - back, { signed: true })} · ${WINDOW} min`;
}

/** The series with "now" as its last point, so the line ends where the numeral is. */
function withNow(values: readonly number[] | undefined, now: number): number[] {
  if (!values || values.length === 0) return [now];
  return [...values.slice(0, -1), now];
}

export function KpiStrip({ loading }: { loading?: boolean }) {
  const { store } = useCommand();
  const summary = useSlice(store.summary);
  // Counts only: the strip re-renders when a room crosses a threshold, not on every delta.
  const warn = useSliceValue(store.rooms, (rooms) => countLevel(rooms, "warn"));
  const stop = useSliceValue(store.rooms, (rooms) => countLevel(rooms, "block"));
  const alerts = useSlice(store.alerts);

  const risk = warn + stop;
  const open = alerts.filter((a) => a.state === "open");
  const worst = [...open].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
  const bySeverity = (["critical", "high", "medium", "low"] as const)
    .map((severity) => ({ severity, n: open.filter((a) => a.severity === severity).length }))
    .filter((entry) => entry.n > 0);
  const series: LiveSummary["series"] | undefined = summary?.series;
  const ready = !loading && summary !== null;
  const dash = <span className="text-muted-foreground">—</span>;

  return (
    <dl className="grid shrink-0 grid-cols-3 gap-px border-b border-border bg-border md:grid-cols-5" aria-busy={!ready}>
      <KpiCell
        label="Registered"
        value={ready ? <LiveNumber k="kpi:registered" /> : dash}
        delta={ready ? delta(series?.registered) : ""}
        spark={ready ? <Sparkline values={series?.registered ?? []} label="Registered, last 60 minutes" /> : null}
      />
      <KpiCell
        label="Checked in"
        value={ready ? <LiveNumber k="kpi:checked_in" /> : dash}
        delta={ready ? delta(series?.checked_in) : ""}
        spark={ready ? <Sparkline values={series?.checked_in ?? []} label="Checked in, last 60 minutes" /> : null}
      />
      <KpiCell
        label="On site now"
        value={ready ? <LiveNumber k="kpi:on_site" /> : dash}
        delta={ready ? delta(series?.on_site) : ""}
        spark={ready ? <Sparkline values={series?.on_site ?? []} label="On site, last 60 minutes" /> : null}
      />
      <KpiCell
        className="col-span-1"
        label="Capacity risk"
        value={ready ? formatNumber(risk) : dash}
        valueClassName={ready && stop > 0 ? "text-destructive" : ready && warn > 0 ? "text-warning" : undefined}
        delta={ready ? (risk === 0 ? "all under warn" : `${stop} stop · ${warn} warn`) : ""}
        spark={
          ready ? (
            <Sparkline values={withNow(series?.capacity_risk, risk)} label="Rooms over warn, last 60 minutes" />
          ) : null
        }
      />
      <KpiCell
        className="col-span-2 md:col-span-1"
        label="Open alerts"
        value={ready ? formatNumber(open.length) : dash}
        valueClassName={ready && worst ? SEVERITY_VIEW[worst.severity].text : undefined}
        delta={
          ready
            ? bySeverity.length === 0
              ? "none open"
              : bySeverity.map((entry) => `${entry.n} ${SEVERITY_VIEW[entry.severity].label.toLowerCase()}`).join(" · ")
            : ""
        }
        spark={ready ? <Sparkline values={withNow(series?.open_alerts, open.length)} label="Open alerts, last 60 minutes" /> : null}
      />
    </dl>
  );
}
