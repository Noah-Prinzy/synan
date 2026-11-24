/**
 * S4 · Offline queue (docs/06 §3.2, docs/01 §8): what is waiting to be sent, how old the
 * oldest is, what kind of results they are, Retry now, a hard warning when the allowlist
 * is past the fail-open window, the device clock offset (D-14), and conflicts the server
 * found at the last sync (D-13).
 */
import { useEffect, useState } from "react";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import type { ScanResult } from "@synan/contracts/enums";
import { ResultChip } from "@synan/ui/data";
import { ActionButton } from "@synan/ui/components";
import { STALE_MS, sync, useOnline, useScanner } from "../data/store";
import { useApi } from "../data/world";

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
      <dt className="text-15 text-muted-foreground">{label}</dt>
      <dd className="text-right text-17">{children}</dd>
    </div>
  );
}

export default function Queue() {
  const { scans, lastSyncAt, allowlistAt, clockOffsetMs } = useScanner();
  const online = useOnline();
  const api = useApi();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const waiting = scans.filter((scan) => !scan.synced);
  const oldest = waiting.reduce<number | null>((min, scan) => (min === null || scan.at < min ? scan.at : min), null);
  const byResult = new Map<ScanResult, number>();
  for (const scan of waiting) byResult.set(scan.result, (byResult.get(scan.result) ?? 0) + 1);
  // API mode with no trusted list: every offline read is refused (fail closed), nothing fails open.
  const stale = allowlistAt !== null && now - allowlistAt > STALE_MS;
  const clockFault = Math.abs(clockOffsetMs) > 120_000;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-6 pb-4 sm:px-6">
        <h1 className="text-28 font-medium leading-tight">Waiting to send</h1>
        <p className="mt-1 text-15 text-muted-foreground">
          {online ? "Online. Scans are sent as they happen." : "Offline. Verdicts are still instant; scans are sent when the link returns."}
        </p>
      </div>

      {stale && !online ? (
        <p role="alert" className="mx-4 mb-4 border border-destructive px-4 py-3 text-15 sm:mx-6">
          <span aria-hidden="true" className="mr-2 font-mono text-destructive">✕</span>
          The pass list on this device is <span className="font-mono">{age(now - (allowlistAt ?? now))}</span> old. Known passes are
          still let in, and each one raises an alert. Call your supervisor.
        </p>
      ) : null}

      <dl className="border-t border-border">
        <Row label="Waiting">
          <span className="font-mono text-28">{waiting.length}</span>
        </Row>
        <Row label="Oldest">{oldest === null ? "—" : <span className="font-mono">{age(now - oldest)}</span>}</Row>
        <Row label="Last sent">{lastSyncAt === null ? "Not yet" : <span className="font-mono">{age(now - lastSyncAt)} ago</span>}</Row>
        <Row label="Pass list">
          {allowlistAt === null ? "—" : <span className={`font-mono ${stale ? "text-destructive" : ""}`}>{age(now - allowlistAt)} old</span>}
        </Row>
        <Row label="Clock offset">
          <span className={`font-mono ${clockFault ? "text-warning" : ""}`}>
            {clockOffsetMs >= 0 ? "+" : "−"}
            {Math.abs(Math.round(clockOffsetMs / 1000))} s
          </span>
          {clockFault ? <span className="block text-13 text-warning">More than two minutes out. Tell your supervisor.</span> : null}
        </Row>
      </dl>

      {byResult.size > 0 ? (
        <ul aria-label="Waiting, by result" className="border-b border-border px-4 py-4 sm:px-6">
          {[...byResult].map(([result, count]) => (
            <li key={result} className="flex items-center justify-between py-1.5">
              <ResultChip result={result} className="text-12" />
              <span className="font-mono text-15">{count}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {api && (api.earlier.waiting > 0 || api.earlier.held > 0 || api.earlier.sentLate > 0) ? (
        <section aria-labelledby="earlier" className="border-b border-border px-4 py-5 sm:px-6">
          <h2 id="earlier" className="text-17 font-medium">From an earlier shift</h2>
          <p className="mt-1 text-15 text-muted-foreground">
            {api.earlier.waiting + api.earlier.held > 0
              ? api.earlier.canSend
                ? "Scans another staff member made on this device. They count for their shift and are sent from here now that you are on shift at their gate."
                : "Scans another staff member made on this device. They stay here and are sent when staff on shift at their gate sign in on this device."
              : "Scans another staff member made on this device. The server has them."}
          </p>
          <dl className="mt-3 border-t border-border">
            {api.earlier.waiting > 0 ? (
              <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2">
                <dt className="text-15 text-muted-foreground">Waiting</dt>
                <dd className="font-mono text-17">{api.earlier.waiting}</dd>
              </div>
            ) : null}
            {api.earlier.held > 0 ? (
              <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2">
                <dt className="text-15 text-muted-foreground">Refused for now, kept</dt>
                <dd className="font-mono text-17">{api.earlier.held}</dd>
              </div>
            ) : null}
            {api.earlier.sentLate > 0 ? (
              <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2">
                <dt className="text-15 text-muted-foreground">Sent after their shift</dt>
                <dd className="font-mono text-17">{api.earlier.sentLate}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <div className="px-4 py-5 sm:px-6">
        <ActionButton
          variant="primary"
          className="min-h-14 w-full text-17"
          action={sync}
          doneLabel="Sent"
          failedLabel="Still offline — it will send on its own"
          disabled={waiting.length === 0}
        >
          Retry now
        </ActionButton>
      </div>

      <section aria-labelledby="conflicts" className="border-t border-border px-4 py-5 sm:px-6">
        <h2 id="conflicts" className="text-17 font-medium">Conflicts found at the last sync</h2>
        {api && api.conflicts.length > 0 ? (
          <ul className="mt-3 border-t border-border">
            {api.conflicts.map((c) => (
              <li key={c.id} className="border-b border-border py-3">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ResultChip result={c.shown} className="text-12" />
                  {c.recorded && c.recorded !== c.shown ? (
                    <>
                      <span aria-hidden="true" className="text-muted-foreground">→</span>
                      <ResultChip result={c.recorded} className="text-12" />
                    </>
                  ) : null}
                  <span className="font-mono text-13 text-muted-foreground">{c.identifier}</span>
                </p>
                <p className="mt-1 text-15 text-muted-foreground">
                  {c.refused ?? (c.alerts > 0 ? `Raised ${c.alerts === 1 ? "an alert" : `${c.alerts} alerts`} for the supervisor.` : "Recorded differently by the server.")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-15 text-muted-foreground">
            {lastSyncAt === null
              ? "None yet. If another gate admitted the same pass while both were offline, it is listed here after sync."
              : "None. Every scan from this device matched what the server knew."}
          </p>
        )}
        <p className="sr-only">{SCAN_RESULT_COPY.offline_queued.instruction}</p>
      </section>
    </div>
  );
}
