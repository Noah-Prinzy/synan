/**
 * The bottom status bar (docs/06 §2.2, simplified 2026-11-24): one quiet line in words — the
 * data is live, or how old it is while the connection is down, and scans waiting at gates only
 * when there are any. The technical figures (round trip, exact age, queue across gates) are one
 * click away under "Details", and in the development panel.
 */
import { useState } from "react";
import { StatusBar } from "@synan/ui/shell";
import { formatAge, formatNumber } from "@synan/ui/data";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";

export function AdminStatusBar() {
  const { store } = useCommand();
  const link = useSlice(store.link);
  const gates = useSlice(store.gates);
  const load = useSlice(store.load);
  const now = useNow(1000);
  const [details, setDetails] = useState(false);

  let queue = 0;
  let offline = 0;
  for (const gate of gates.values()) {
    queue += gate.queue_depth;
    if (gate.link_state === "offline") offline++;
  }
  const age = link.lastFrameAt === null ? null : now - link.lastFrameAt;
  const live = load.status === "ready";
  const current = link.status === "live";

  const line = !live
    ? "No live data for this event"
    : current
      ? "Counts are live"
      : `Showing the last known counts${age !== null ? `, ${formatAge(age)} old` : ""}`;

  return (
    <StatusBar>
      <span className={`flex items-center gap-2 px-3 ${live && !current ? "text-warning" : ""}`}>{line}</span>
      {live && queue > 0 ? (
        <span className="flex items-center px-3 text-warning">
          {formatNumber(queue)} {queue === 1 ? "scan" : "scans"} waiting to sync{offline > 0 ? ` · ${offline} ${offline === 1 ? "gate" : "gates"} offline` : ""}
        </span>
      ) : null}
      <span className="flex-1" />
      {details && live ? (
        <span className="flex items-center gap-3 px-3 font-mono tabular-nums">
          <span>round trip {link.latencyMs !== null ? `${link.latencyMs} ms` : "—"}</span>
          <span>last update {age !== null ? `${formatAge(age)} ago` : "—"}</span>
          <span>
            {formatNumber(queue)} queued · {gates.size} {gates.size === 1 ? "gate" : "gates"}
          </span>
        </span>
      ) : null}
      {live ? (
        <button
          type="button"
          aria-expanded={details}
          onClick={() => setDetails((d) => !d)}
          className="px-3 hover:bg-surface-2 hover:text-foreground focus-visible:-outline-offset-2"
        >
          {details ? "Hide details" : "Details"}
        </button>
      ) : null}
    </StatusBar>
  );
}
