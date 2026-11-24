/**
 * The headline strip (docs/06 §2.3 D1, simplified at the owner's request 2026-11-24): four
 * figures, large and calm, each with a plain-word label — On site now · Checked in · Rooms
 * filling up · Open alerts. Under a figure there is at most one short line of words, and only
 * when it explains something (which rooms are full; the worst alert). No deltas, no sparklines:
 * the trend lives in Reports. Neutral when all is well; colour appears only on the two risk
 * figures, and only when they are above zero. The two counts are eased by the frame loop; the
 * two risk figures are small integers and render directly.
 *
 * Registered moved out of the strip: it is the denominator of "Checked in", shown as a share bar.
 */
import { KpiCell, formatNumber } from "@synan/ui/data";
import { SEVERITY_VIEW, severityRank } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import type { RoomLive } from "../live/store";
import { LiveNumber } from "./ui-state";

function countLevel(rooms: ReadonlyMap<string, RoomLive>, level: RoomLive["level"]): number {
  let n = 0;
  for (const room of rooms.values()) if (room.level === level) n++;
  return n;
}

export function KpiStrip({ loading }: { loading?: boolean }) {
  const { store } = useCommand();
  const summary = useSlice(store.summary);
  // Counts only: the strip re-renders when a room crosses a threshold, not on every delta.
  const warn = useSliceValue(store.rooms, (rooms) => countLevel(rooms, "warn"));
  const full = useSliceValue(store.rooms, (rooms) => countLevel(rooms, "block"));
  const alerts = useSlice(store.alerts);

  const filling = warn + full;
  const open = alerts.filter((a) => a.state === "open");
  const worst = [...open].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
  const ready = !loading && summary !== null;
  const dash = <span className="text-muted-foreground">—</span>;
  const share = summary && summary.registered > 0 ? summary.checked_in / summary.registered : null;

  const roomsWords =
    filling === 0
      ? "Every room has space"
      : [full > 0 ? `${full} full` : null, warn > 0 ? `${warn} nearly full` : null].filter(Boolean).join(" · ");

  return (
    <dl className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4" aria-busy={!ready}>
      <KpiCell label="On site now" value={ready ? <LiveNumber k="kpi:on_site" /> : dash} />
      <KpiCell
        label="Checked in"
        value={ready ? <LiveNumber k="kpi:checked_in" /> : dash}
        delta={
          ready && share !== null ? (
            // The share of registrations as a bar, not another figure.
            <span className="flex items-center gap-2">
              <span
                role="img"
                aria-label={`${Math.round(share * 100)}% of ${formatNumber(summary?.registered ?? 0)} registered`}
                className="relative block h-1 w-20 overflow-hidden bg-foreground/10"
              >
                <span className="absolute inset-y-0 left-0 bg-muted-foreground" style={{ width: `${Math.min(100, share * 100)}%` }} />
              </span>
              <span>of everyone registered</span>
            </span>
          ) : undefined
        }
      />
      <KpiCell
        label="Rooms filling up"
        value={ready ? formatNumber(filling) : dash}
        valueClassName={ready && full > 0 ? "text-destructive" : ready && warn > 0 ? "text-warning" : undefined}
        delta={ready ? roomsWords : undefined}
      />
      <KpiCell
        label="Open alerts"
        value={ready ? formatNumber(open.length) : dash}
        valueClassName={ready && worst ? SEVERITY_VIEW[worst.severity].text : undefined}
        delta={ready ? (worst ? `Most serious: ${SEVERITY_VIEW[worst.severity].label.toLowerCase()}` : "Nothing needs action") : undefined}
      />
    </dl>
  );
}
