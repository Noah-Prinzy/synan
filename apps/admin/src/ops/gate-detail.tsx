/**
 * D12b · Gate detail `/gates/:id` (docs/06 §2.3). One checkpoint: its hardware, direction and
 * link state and pass-list age; link history for the shift; throughput by 5-minute bucket over the last hour;
 * results by code; the last 50 scans; who is assigned now. Actions: `Test read` (a synthetic read
 * that is never logged as attendance), `Mark for maintenance` (MOCK: this page only) and
 * `Reassign` (to the event's staff tab; staff.manage only — absent otherwise).
 *
 * Live link, queue and clock come from the CommandStore; the rest is polled every five seconds.
 * States: loading, error, not live, not found (a bad id), last known (link down).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { Checkpoint } from "@synan/contracts/rest";
import { ActionButton, Button, RewardMoment, buttonClass, cn } from "@synan/ui/components";
import { ResultChip, SignalShape, StatusDot, formatAge, formatClock, formatNumber, formatOffset } from "@synan/ui/data";
import type { GateDetail, OpsScan, TestRead } from "@synan/mock/command";
import { Can } from "../access/session";
import {
  BackLink,
  EmptyState,
  ErrorState,
  errorCode,
  GUTTER_X,
  KeyValues,
  LoadingState,
  PageHeader,
  SPLIT,
  SectionHead,
  TIER_LABEL,
  TYPE,
  Table,
  Td,
  Th,
  formatStamp,
  linkClass,
  rowClass,
  useDocumentTitle,
  useResource,
} from "../kit";
import { api, configure, mode } from "../live/backend";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { GateLive } from "../live/store";
import { useGateActivity } from "./gates";
import { maintenance, setMaintenance } from "./maintenance";
import { CARRIER_LABEL, DIRECTION_LABEL, LINK_VIEW, LastKnown, LiveStates, allowlistStale, clockWrong, formatScanTime, gateSignal, useLiveReady } from "./shared";

const POLL_MS = 5_000;

export default function GateDetailScreen() {
  const { id = "" } = useParams();
  const { store, event } = useCommand();
  const layout = useSlice(store.layout);
  const ready = useLiveReady();
  const checkpoint = layout?.checkpoints.find((c) => c.id === id) ?? null;
  useDocumentTitle(checkpoint ? `${checkpoint.label} · Gate health` : "Gate detail");

  const back = <BackLink to="/gates">Gate health</BackLink>;

  if (!ready || !event) {
    return (
      <div className="min-h-full pb-10">
        <PageHeader back={back} code="D12b" title="Gate detail" />
        <LiveStates what="the gate" notLive={() => "Gate detail is shown only while an event is live: link history, throughput and recent scans come from the gates on shift."} />
      </div>
    );
  }
  if (!checkpoint) {
    return (
      <div className="min-h-full pb-10">
        <PageHeader back={back} code="D12b" title="Gate not found" />
        <EmptyState
          title="No gate with that ID at this venue"
          className={GUTTER_X}
          action={
            <Link to="/gates" className={buttonClass("secondary", "compact")}>
              See every gate
            </Link>
          }
        >
          The link may be for a gate at another venue, or one that was removed from the layout. {event.venue_name} has{" "}
          <span className="font-mono tabular-nums">{layout?.checkpoints.length ?? 0}</span> checkpoints.
        </EmptyState>
      </div>
    );
  }
  return <GateView key={checkpoint.id} checkpoint={checkpoint} eventId={event.id} timeZone={event.timezone} back={back} />;
}

function GateView({ checkpoint, eventId, timeZone, back }: { checkpoint: Checkpoint; eventId: string; timeZone: string; back: ReactNode }) {
  const { store } = useCommand();
  const gates = useSlice(store.gates);
  const gate = gates.get(checkpoint.id);
  const marked = useSlice(maintenance).get(checkpoint.id);
  const now = useNow(1000);
  const detail = useResource(() => api.gateDetail(eventId, checkpoint.id), [eventId, checkpoint.id]);
  const assignments = useResource(() => configure.assignments(eventId), [eventId]);
  const { byId } = useGateActivity(eventId);
  const activity = byId?.get(checkpoint.id);
  const [test, setTest] = useState<TestState | null>(null);

  const reload = detail.reload;
  useEffect(() => {
    const timer = window.setInterval(() => reload(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const signal = gate ? gateSignal(gate) : null;
  const room = useSlice(store.layout)?.rooms.find((r) => r.id === checkpoint.room_id);

  return (
    <div className="min-h-full pb-10">
      <PageHeader
        back={back}
        code="D12b"
        title={checkpoint.label}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {signal ? <StatusDot state={signal.state} label={signal.words} showLabel /> : null}
            <span aria-hidden="true">·</span>
            <span>{DIRECTION_LABEL[checkpoint.direction]}</span>
            <span aria-hidden="true">·</span>
            <span>{checkpoint.perimeter ? "Perimeter" : `Interior${room ? ` · ${room.name}` : ""}`}</span>
            <span aria-hidden="true">·</span>
            <span>
              {checkpoint.hardware_id ? (
                <>
                  Hardware <span className="font-mono text-foreground tabular-nums">{checkpoint.hardware_id}</span>
                </>
              ) : (
                "No hardware ID recorded"
              )}
            </span>
            {marked !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <SignalShape state="idle" /> Marked for maintenance {formatAge(now - marked)} ago
                </span>
              </>
            ) : null}
          </span>
        }
        actions={
          // The header keeps its action box at full width; on a phone the buttons wrap inside the screen.
          <span className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
            {mode === "api" ? (
              // The real API has no test read yet (index.ts ★): say so calmly, no "No answer" alarm.
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  setTest(null);
                  api.testRead(eventId, checkpoint.id).then(
                    (result) => setTest({ result, failed: false }),
                    (error: unknown) =>
                      setTest(errorCode(error) === "NOT_IMPLEMENTED" ? { result: null, failed: false, unavailable: true } : { result: null, failed: true }),
                  );
                }}
              >
                Test read
              </Button>
            ) : (
            <ActionButton
              variant="quiet"
              size="compact"
              reward
              doneLabel="Reader answered"
              failedLabel="No answer"
              action={async () => {
                setTest(null);
                try {
                  const result = await api.testRead(eventId, checkpoint.id);
                  setTest({ result, failed: false });
                } catch (error) {
                  setTest({ result: null, failed: true });
                  throw error;
                }
              }}
            >
              Test read
            </ActionButton>
            )}
            <Button
              variant="secondary"
              size="compact"
              aria-pressed={marked !== undefined}
              onClick={() => setMaintenance(checkpoint.id, marked === undefined, store.now())}
            >
              {marked === undefined ? "Mark for maintenance" : "End maintenance"}
            </Button>
            {/* The Staff tab lives in the event workspace: opening it needs both. */}
            <Can I="events.view">
              <Can I="staff.manage">
                <Link to={`/events/${eventId}/staff`} className={buttonClass("secondary", "compact")}>
                  Reassign
                </Link>
              </Can>
            </Can>
          </span>
        }
      />
      <LastKnown />
      {test ? <TestReadLine test={test} gate={gate} /> : null}
      {marked !== undefined ? (
        <p className={cn("border-b border-border py-2.5 text-12 text-muted-foreground", GUTTER_X)}>
          Maintenance marks are kept on this page only in this preview: other operators do not see them yet, and a reload clears them.
        </p>
      ) : null}

      {detail.status === "loading" ? (
        <LoadingState label="Loading the gate's scans…" rows={6} className={GUTTER_X} />
      ) : detail.status === "error" ? (
        <ErrorState title="Could not load this gate" error={detail.error} onRetry={() => detail.reload()} />
      ) : (
        <div className={SPLIT}>
          <div className="min-w-0">
            <ThroughputChart detail={detail.data} timeZone={timeZone} />
            <Results detail={detail.data} />
            <LastScans scans={detail.data.last_scans} timeZone={timeZone} perimeter={checkpoint.perimeter} />
          </div>
          <aside aria-label="Status, link history and staff" className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
            <SectionHead title="Status" meta={gate ? "Live" : undefined} />
            <KeyValues
              rows={[
                ["Link", gate ? <StatusDot state={LINK_VIEW[gate.link_state].state} label={LINK_VIEW[gate.link_state].label} showLabel /> : "—"],
                ["Heartbeat", <Heartbeat gate={gate} at={activity?.heartbeat_at ?? null} now={now} />],
                [
                  "Queue",
                  (gate?.queue_depth ?? 0) > 0 ? (
                    <span className="text-warning">
                      <span className={TYPE.value}>{formatNumber(gate?.queue_depth ?? 0)}</span> {(gate?.queue_depth ?? 0) === 1 ? "scan" : "scans"} waiting to sync
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Nothing waiting to sync</span>
                  ),
                ],
                [
                  "Clock",
                  gate && gate.clock_offset_ms !== null ? (
                    gate.clock_offset_ms === 0 ? (
                      "In sync"
                    ) : (
                      <span className={cn(clockWrong(gate) && "text-warning")}>
                        <span className={TYPE.value}>{formatOffset(gate.clock_offset_ms)}</span>
                        {clockWrong(gate) ? " · more than two minutes out" : null}
                      </span>
                    )
                  ) : (
                    "—"
                  ),
                ],
                ["Pass list", <PassList gate={gate} now={now} />],
                [
                  "Last 15 min",
                  activity ? (
                    <span>
                      <span className={TYPE.value}>{formatNumber(activity.scans_last_15m)}</span> scans
                    </span>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
            <LinkHistory detail={detail.data} timeZone={timeZone} />
            <Staff checkpointId={checkpoint.id} perimeter={checkpoint.perimeter} assignments={assignments} timeZone={timeZone} now={now} />
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

type TestState = { result: TestRead | null; failed: boolean; unavailable?: boolean };

function TestReadLine({ test, gate }: { test: TestState; gate: GateLive | undefined }) {
  if (test.unavailable) {
    return (
      <p role="status" className={cn("flex min-h-10 items-center gap-2 border-b border-border py-2 text-12 text-muted-foreground", GUTTER_X)}>
        <SignalShape state="idle" className="shrink-0" />
        Test read is not available yet. To check this gate now, scan a test band or pass at it and watch it arrive in the last scans below.
      </p>
    );
  }
  if (test.failed || !test.result) {
    return (
      <p role="alert" className={cn("flex min-h-10 items-center gap-2 border-b border-border py-2 text-12 text-destructive", GUTTER_X)}>
        <SignalShape state="stop" className="shrink-0" />
        {gate?.link_state === "offline"
          ? "The gate did not answer: it is offline. A test read needs the link; check power and network at the gate."
          : "The gate did not answer the test read. Try again, or check the device at the gate."}
      </p>
    );
  }
  const read = test.result;
  return (
    <div className={cn("flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-2 text-12", GUTTER_X)}>
      <RewardMoment>
        Reader answered in <span className="font-mono tabular-nums">{read.round_trip_ms} ms</span>
      </RewardMoment>
      <span className="text-muted-foreground">
        {read.reader === "camera" ? "Camera" : "Wristband reader"} · test token would show
      </span>
      <ResultChip result={read.result} />
      <span className="text-muted-foreground">Not logged as attendance; no count changed.</span>
    </div>
  );
}

function Heartbeat({ gate, at, now }: { gate: GateLive | undefined; at: string | null; now: number }) {
  if (gate?.link_state === "offline") {
    return (
      <span className="text-destructive">
        {gate.offlineSince ? (
          <>
            None for <span className={TYPE.value}>{formatAge(now - gate.offlineSince)}</span>
          </>
        ) : (
          "Never heard from"
        )}
      </span>
    );
  }
  if (!at) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <span className={TYPE.value}>{formatAge(now - Date.parse(at))}</span> ago
    </span>
  );
}

/** The age of the gate's signed pass list (allowlist), and whether it is out of date (O-05). */
function PassList({ gate, now }: { gate: GateLive | undefined; now: number }) {
  const issued = gate?.allowlist_issued_at ? Date.parse(gate.allowlist_issued_at) : null;
  const stale = gate ? allowlistStale(gate) : false;
  if (issued === null && !stale) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(stale && "text-warning")}>
      {issued !== null ? (
        <>
          Issued <span className={TYPE.value}>{formatAge(now - issued)}</span> ago
        </>
      ) : null}
      {stale ? (issued !== null ? " · out of date" : "Out of date") : null}
    </span>
  );
}

function ThroughputChart({ detail, timeZone }: { detail: GateDetail; timeZone: string }) {
  const { counts, bucket_ms } = detail.throughput;
  const from = Date.parse(detail.throughput.from);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((sum, n) => sum + n, 0);
  const last = counts.length - 1;
  return (
    <section aria-labelledby="gate-throughput">
      <SectionHead
        id="gate-throughput"
        title="Throughput by 5 minutes"
        className={GUTTER_X}
        meta={
          <>
            Last hour · <span className="font-mono tabular-nums">{formatNumber(total)}</span> scans · peak{" "}
            <span className="font-mono tabular-nums">{formatNumber(max)}</span>
          </>
        }
      />
      <div className={cn("pt-5 pb-4", GUTTER_X)}>
        <ol className="flex h-32 items-end gap-1 border-b border-border">
          {counts.map((count, i) => {
            const start = from + i * bucket_ms;
            return (
              <li key={start} className="relative flex h-full min-w-0 flex-1 items-end" title={`${formatClock(start, timeZone, { seconds: false })}: ${count} scans`}>
                <span
                  aria-hidden="true"
                  className={cn("block h-full w-full origin-bottom", i === last ? "bg-foreground/15" : "bg-foreground/35")}
                  style={{ transform: `scaleY(${count / max})` }}
                />
                <span className="sr-only">
                  {formatClock(start, timeZone, { seconds: false })} to {formatClock(start + bucket_ms, timeZone, { seconds: false })}: {count} {count === 1 ? "scan" : "scans"}
                  {i === last ? " so far" : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <div aria-hidden="true" className="mt-1.5 flex gap-1 font-mono text-12 text-muted-foreground tabular-nums">
          {counts.map((_, i) => (
            <span key={i} className="min-w-0 flex-1 truncate">
              {i === last ? "now" : i % 3 === 0 ? formatClock(from + i * bucket_ms, timeZone, { seconds: false }) : ""}
            </span>
          ))}
        </div>
        <p className="mt-3 text-12 text-muted-foreground">The last bar is the five minutes in progress. Implied exits are not counted.</p>
      </div>
    </section>
  );
}

function Results({ detail }: { detail: GateDetail }) {
  const total = detail.results.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(1, ...detail.results.map((row) => row.count));
  return (
    <section aria-labelledby="gate-results" className="border-t border-border">
      <SectionHead id="gate-results" title="Results by code" meta="Last hour" className={GUTTER_X} />
      {detail.results.length === 0 ? (
        <p className={cn("py-4 text-13 text-muted-foreground", GUTTER_X)}>No scans at this gate in the last hour.</p>
      ) : (
        <ul className="py-2">
          {detail.results.map((row) => (
            <li key={row.result} className={cn("grid h-9 grid-cols-[10rem_minmax(0,1fr)_3.5rem_3rem] items-center gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_4rem_3.5rem]", GUTTER_X)}>
              <ResultChip result={row.result} className="truncate" />
              <span aria-hidden="true" className="h-1 bg-border">
                <span className="block h-full origin-left bg-foreground/40" style={{ transform: `scaleX(${row.count / max})` }} />
              </span>
              <span className={cn("text-right", TYPE.value)}>{formatNumber(row.count)}</span>
              <span className="text-right font-mono text-12 text-muted-foreground tabular-nums">{Math.round((row.count / Math.max(1, total)) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LastScans({ scans, timeZone, perimeter }: { scans: OpsScan[]; timeZone: string; perimeter: boolean }) {
  return (
    <section aria-labelledby="gate-scans" className="border-t border-border">
      <SectionHead
        id="gate-scans"
        title="Last 50 scans"
        className={GUTTER_X}
        meta={
          <Can I="scans.view">
            <Link to={`/access-log?gate=${scans[0]?.checkpoint_id ?? ""}`} className={linkClass}>
              Open in the access log
            </Link>
          </Can>
        }
      />
      {scans.length === 0 ? (
        <p className={cn("py-4 text-13 text-muted-foreground", GUTTER_X)}>
          No scans here yet.{perimeter ? "" : " Interior doors read wristbands only, so a quiet door is normal between sessions."}
        </p>
      ) : (
        <div className="max-h-128 overflow-y-auto">
          <Table label="Last 50 scans at this gate, newest first">
            <thead>
              <tr>
                <Th fit>Time</Th>
                <Th fit>Result</Th>
                <Th className="max-sm:hidden">Tier</Th>
                <Th className="max-sm:hidden">Carrier</Th>
                <Th fit numeric>
                  Decided in
                </Th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className={rowClass}>
                  <Td fit className="font-mono text-12 text-muted-foreground tabular-nums">
                    {formatScanTime(scan.corrected_at, timeZone)}
                  </Td>
                  <Td fit>
                    <ResultChip result={scan.result} />
                  </Td>
                  <Td className="text-muted-foreground max-sm:hidden">{scan.tier ? TIER_LABEL[scan.tier] : "—"}</Td>
                  <Td className="text-muted-foreground max-sm:hidden">{scan.carrier_kind ? CARRIER_LABEL[scan.carrier_kind] : "Unknown"}</Td>
                  <Td fit className="text-right text-muted-foreground">
                    {scan.offline ? "Offline, synced" : scan.latency_ms !== null ? <span className={TYPE.value}>{scan.latency_ms} ms</span> : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}

function LinkHistory({ detail, timeZone }: { detail: GateDetail; timeZone: string }) {
  const rows = [...detail.link_history].reverse();
  return (
    <section aria-labelledby="gate-links" className="border-t border-border">
      <SectionHead id="gate-links" title="Link history" meta="This shift, newest first" />
      <ol className="py-2">
        {rows.map((change, i) => {
          const view = LINK_VIEW[change.link_state];
          const next = rows[i - 1];
          const lasted = next ? Date.parse(next.at) - Date.parse(change.at) : null;
          return (
            <li key={`${change.at}-${i}`} className="grid min-h-9 grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 px-4 text-13 sm:px-5">
              <span className="font-mono text-12 text-muted-foreground tabular-nums">{formatClock(change.at, timeZone)}</span>
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot state={view.state} label={view.label} showLabel />
                {lasted !== null ? <span className="truncate text-muted-foreground">for {formatAge(lasted)}</span> : <span className="text-muted-foreground">since then</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Staff({
  checkpointId,
  perimeter,
  assignments,
  timeZone,
  now,
}: {
  checkpointId: string;
  perimeter: boolean;
  assignments: ReturnType<typeof useResource<Awaited<ReturnType<typeof configure.assignments>>>>;
  timeZone: string;
  now: number;
}) {
  const mine = useMemo(
    () => (assignments.status === "ready" ? assignments.data.filter((a) => a.checkpoint_id === checkpointId) : []),
    [assignments, checkpointId],
  );
  return (
    <section aria-labelledby="gate-staff" className="border-t border-border">
      <SectionHead id="gate-staff" title="Assigned staff" />
      {assignments.status === "loading" ? (
        <p className="px-4 py-3 text-13 text-muted-foreground sm:px-5">Loading…</p>
      ) : assignments.status === "error" ? (
        <p className="px-4 py-3 text-13 text-destructive sm:px-5">
          Could not load the assignments.{" "}
          <button type="button" className={cn(linkClass, "text-foreground")} onClick={() => assignments.reload()}>
            Try again
          </button>
        </p>
      ) : mine.length === 0 ? (
        <p className="px-4 py-3 text-13 text-muted-foreground sm:px-5">
          {perimeter ? "No one is assigned to this gate." : "No one is assigned here: interior doors read wristbands on fixed readers."}
        </p>
      ) : (
        <ul>
          {mine.map((a) => {
            const onShift = !a.handed_over_at && Date.parse(a.shift_start) <= now && now < Date.parse(a.shift_end);
            return (
              <li key={a.id} className="border-b border-border px-4 py-3 text-13 last:border-b-0 sm:px-5">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate">{a.staff_name}</span>
                  <StatusDot state={onShift ? "ok" : "idle"} label={a.handed_over_at ? "Handed over" : onShift ? "On shift" : "Off shift"} showLabel />
                </span>
                <span className="mt-0.5 block font-mono text-12 text-muted-foreground tabular-nums">
                  {formatStamp(a.shift_start, timeZone)} – {formatClock(a.shift_end, timeZone, { seconds: false })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

