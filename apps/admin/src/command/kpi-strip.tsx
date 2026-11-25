/**
 * The instrument strip (D-37, docs/06 §2.3 D1): the four headline figures in one tonal band —
 * On site now · Checked in · Rooms filling up · Open alerts. Each has a mono capital label, a
 * mono figure, and one short sans line under it that explains the figure. No deltas, no
 * sparklines: the trend lives in Reports. Neutral when all is well; colour appears only on the
 * two risk figures, and only when they are above zero. The two counts are eased by the frame
 * loop; the two risk figures are small integers and render directly.
 */
import type { ReactNode } from "react";
import { formatNumber } from "@synan/ui/data";
import { cn } from "@synan/ui/components";
import { SEVERITY_VIEW, severityRank } from "../live/alert-copy";
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import type { RoomLive } from "../live/store";
import { LiveNumber } from "./ui-state";

export function countLevel(rooms: ReadonlyMap<string, RoomLive>, level: RoomLive["level"]): number {
  let n = 0;
  for (const room of rooms.values()) if (room.level === level) n++;
  return n;
}

/** The strip's ground: one tonal band (a soft depth on light), four readouts held apart by space. */
export const STRIP = "grid grid-cols-2 gap-x-4 gap-y-6 bg-surface px-5 py-5 shadow-depth sm:px-7 sm:py-6 md:grid-cols-4";

/** One readout: a mono capital label, the figure, and a line of words under it. */
export function Figure({ label, value, note, tone }: { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow-mono truncate">{label}</dt>
      <dd className={cn("mt-2.5 truncate font-mono text-28 leading-none tracking-tight tabular-nums contain-content xl:text-40", tone)}>{value}</dd>
      {note ? <dd className="mt-2 truncate text-13 text-muted-foreground">{note}</dd> : null}
    </div>
  );
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

  const roomsWords =
    filling === 0
      ? "Every room has space"
      : [full > 0 ? `${full} full` : null, warn > 0 ? `${warn} nearly full` : null].filter(Boolean).join(" · ");

  return (
    <dl className={STRIP} aria-busy={!ready}>
      <Figure label="On site now" value={ready ? <LiveNumber k="kpi:on_site" /> : dash} note={ready ? "inside the venue now" : undefined} />
      <Figure
        label="Checked in"
        value={ready ? <LiveNumber k="kpi:checked_in" /> : dash}
        note={
          ready && summary ? (
            <>
              of <span className="font-mono tabular-nums">{formatNumber(summary.registered)}</span> registered
            </>
          ) : undefined
        }
      />
      <Figure
        label="Rooms filling up"
        value={ready ? formatNumber(filling) : dash}
        tone={ready && full > 0 ? "text-destructive" : ready && warn > 0 ? "text-warning" : undefined}
        note={ready ? roomsWords : undefined}
      />
      <Figure
        label="Open alerts"
        value={ready ? formatNumber(open.length) : dash}
        tone={ready && worst ? SEVERITY_VIEW[worst.severity].text : undefined}
        note={ready ? (worst ? `Most serious: ${SEVERITY_VIEW[worst.severity].label.toLowerCase()}` : "Nothing needs action") : undefined}
      />
    </dl>
  );
}
