/**
 * S3 · Recent (docs/06 §3.2): the last 50 scans at this gate, newest first, each with its
 * result, who, when, and whether it has reached the server. An admission made in error
 * can be undone for 60 seconds; the undo is a correction record, the scan is kept.
 */
import { useEffect, useState } from "react";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { ResultChip } from "@synan/ui/data";
import { ActionButton } from "@synan/ui/components";
import { tierLabel } from "../components/verdict";
import { undo, undoDeadline, useScanner, type Scan } from "../data/store";

/** Who the scan was for, as far as the device knows: the name (mock), else the tier; null when neither. */
const holder = (scan: Scan): string | null => scan.name ?? (scan.tier ? tierLabel[scan.tier] : null);

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function Recent() {
  const { scans, gateId } = useScanner();
  const list = scans.filter((scan) => scan.gateId === gateId && SCAN_RESULT_COPY[scan.result].shownAtGate).slice(0, 50);

  // Re-render each second while an undo window is open, so the button leaves on time.
  const [now, setNow] = useState(() => Date.now());
  // Offered only while it can succeed: 60 s on the mock; API mode, the runtime's deadline (own
  // admission, own shift at this gate, inside the server's window).
  const until = (scan: (typeof list)[number]) => undoDeadline(scan);
  const anyUndoable = list.some((scan) => (until(scan) ?? 0) > now);
  useEffect(() => {
    if (!anyUndoable) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyUndoable]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-6 pb-4 sm:px-6">
        <h1 className="text-28 font-medium leading-tight">Recent scans</h1>
        <p className="mt-1 text-15 text-muted-foreground">The last 50 at this gate. Newest first.</p>
      </div>
      {list.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-17 text-muted-foreground sm:px-6">No scans at this gate yet.</p>
      ) : (
        <ul className="border-t border-border">
          {list.map((scan) => {
            const deadline = until(scan);
            const undoable = deadline !== null && now < deadline;
            return (
              <li key={scan.id} className="border-b border-border px-4 py-3 sm:px-6">
                <div className="flex min-h-10 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ResultChip result={scan.result} className="text-12" />
                    {scan.undone ? <span className="text-13 text-muted-foreground">Undone</span> : null}
                  </p>
                  {/* No name on the real API (the outcome names nobody, 03 §5): the tier, else the identifier alone. */}
                  <p className="mt-1 truncate text-15">
                    {holder(scan)}
                    <span className="font-mono text-13 text-muted-foreground">
                      {holder(scan) ? " · " : ""}
                      {scan.identifier}
                    </span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-13">{time(scan.at)}</p>
                  {scan.refused ? (
                    <p className="mt-1 flex items-center justify-end gap-1.5 text-13 text-destructive" title={scan.refused}>
                      <span aria-hidden="true" className="size-1.5 bg-destructive" />
                      Not sent
                    </p>
                  ) : scan.heldBack ? (
                    <p className="mt-1 flex items-center justify-end gap-1.5 text-13 text-muted-foreground" title="Undone before it was sent. Kept on this device.">
                      <span aria-hidden="true" className="size-1.5 bg-muted-foreground" />
                      Not sent
                    </p>
                  ) : (
                    <p className={`mt-1 flex items-center justify-end gap-1.5 text-13 ${scan.synced ? "text-muted-foreground" : "text-warning"}`}>
                      <span aria-hidden="true" className={`size-1.5 ${scan.synced ? "bg-muted-foreground" : "bg-warning"}`} />
                      {scan.synced ? (scan.lateSynced ? "Sent late" : "Sent") : "Waiting"}
                    </p>
                  )}
                </div>
                </div>
                {scan.undoNote ? <p className="mt-1 text-13 text-muted-foreground">{scan.undoNote}</p> : null}
                {/* UndoStrip: for 60 s after an admission, in case it was a mistake. */}
                {undoable ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-13 text-muted-foreground">
                      Let in by mistake? <span className="font-mono">{Math.ceil(((deadline ?? now) - now) / 1000)} s</span>
                    </p>
                    <ActionButton
                      action={() => undo(scan.id)}
                      doneLabel="Undone"
                      keepDone
                      className="min-h-12 shrink-0 px-5 text-15"
                      aria-label={`Undo admission of ${scan.name ?? scan.identifier}`}
                    >
                      Undo
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
