/**
 * The bottom status bar (docs/06 §2.2): WebSocket latency, the age of the last
 * state received, and queue depth across gates. Ages count up once a second.
 */
import { StatusBar, StatusItem } from "@synan/ui/shell";
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

  let queue = 0;
  let offline = 0;
  for (const gate of gates.values()) {
    queue += gate.queue_depth;
    if (gate.link_state === "offline") offline++;
  }
  const age = link.lastFrameAt === null ? null : now - link.lastFrameAt;
  const stale = link.status !== "live";
  const live = load.status === "ready";

  return (
    <StatusBar>
      <StatusItem label="WS latency">{live && link.latencyMs !== null ? `${link.latencyMs} ms` : "—"}</StatusItem>
      <StatusItem label="Last state">
        <span className={stale && live ? "text-warning" : undefined}>
          {live && age !== null ? (link.status !== "live" ? `${formatAge(age)} old` : "current") : "—"}
        </span>
      </StatusItem>
      <StatusItem label="Queued at gates">
        {live ? (
          <>
            <span className={queue > 0 ? "text-warning" : undefined}>{formatNumber(queue)}</span>
            <span className="text-muted-foreground">
              {" "}
              · {offline > 0 ? `${offline} offline of ${gates.size}` : `${gates.size} gates`}
            </span>
          </>
        ) : (
          "—"
        )}
      </StatusItem>
      <span className="flex-1" />
    </StatusBar>
  );
}
