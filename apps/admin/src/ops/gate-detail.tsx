/**
 * D12b · Gate detail `/gates/:id` (docs/06 §2.3). One checkpoint: its hardware, direction and
 * link state; link history for the shift; throughput by 5-minute bucket over the last hour;
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
import { EmptyState, ErrorState, errorCode, KeyValues, LoadingState, PageHeader, SectionHead, TIER_LABEL, formatStamp, linkClass, useDocumentTitle, useResource } from "../kit";
import { api, configure, mode } from "../live/backend";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { GateLive } from "../live/store";
import { useGateActivity } from "./gates";
import { maintenance, setMaintenance } from "./maintenance";
import { CARRIER_LABEL, DIRECTION_LABEL, LINK_VIEW, LastKnown, LiveStates, clockWrong, formatScanTime, gateSignal, useLiveReady } from "./shared";

const POLL_MS = 5_000;

export default function GateDetailScreen() {
  const { id = "" } = useParams();
  const { store, event } = useCommand();
  const layout = useSlice(store.layout);
  const ready = useLiveReady();
  const checkpoint = layout?.checkpoints.find((c) => c.id === id) ?? null;
  useDocumentTitle(checkpoint ? `${checkpoint.label} · Gate health` : "Gate detail");

  const back = (
    <Link to="/gates" className="hover:text-foreground">
      ← Gate health
    </Link>
  );

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
              Hardware <span className="font-mono text-12 text-foreground">{checkpoint.hardware_id ?? "not recorded"}</span>
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
            <Can I="staff.manage">
              <Link to={`/events/${eventId}/staff`} className={buttonClass("secondary", "compact")}>
                Reassign
              </Link>
            </Can>
          </span>
        }
      />
      <LastKnown />
      {test ? <TestReadLine test={test} gate={gate} /> : null}
      {marked !== undefined ? (
        <p className="border-b border-border px-4 py-2 text-12 text-muted-foreground sm:px-6">
          Maintenance marks are kept on this page only in this preview: other operators do not see them yet, and a reload clears them.
        </p>
      ) : null}

      {detail.status === "loading" ? (
        <LoadingState label="Loading the gate's scans…" rows={6} />
      ) : detail.status === "error" ? (
        <ErrorState title="Could not load this gate" error={detail.error} onRetry={() => detail.reload()} />
      ) : (
        <div className="xl:grid xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-8">
            <ThroughputChart detail={detail.data} timeZone={timeZone} />
            <Results detail={detail.data} />
            <LastScans scans={detail.data.last_scans} timeZone={timeZone} perimeter={checkpoint.perimeter} />
          </div>
          <aside aria-label="Status, link history and staff" className="min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
            <SectionHead title="Status" meta={gate ? "live" : undefined} />
            <KeyValues
              rows={[
                ["Link", gate ? <StatusDot state={LINK_VIEW[gate.link_state].state} label={LINK_VIEW[gate.link_state].label} showLabel /> : "—"],
                ["Heartbeat", <Heartbeat gate={gate} at={activity?.heartbeat_at ?? null} now={now} />],
                [
                  "Queue",
                  <span className={cn("font-mono text-12 tabular-nums", (gate?.queue_depth ?? 0) > 0 && "text-warning")}>
                    {formatNumber(gate?.queue_depth ?? 0)} {(gate?.queue_depth ?? 0) === 1 ? "scan" : "scans"} waiting to sync
                  </span>,
                ],
                [
                  "Clock",
                  gate && gate.clock_offset_ms !== null ? (
                    <span className={cn("font-mono text-12 tabular-nums", clockWrong(gate) && "text-warning")}>
                      {gate.clock_offset_ms === 0 ? "in sync" : formatOffset(gate.clock_offset_ms)}
                      {clockWrong(gate) ? <span className="font-sans"> · more than two minutes out</span> : null}
                    </span>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Last 15 min",
                  <span className="font-mono text-12 tabular-nums">{activity ? `${formatNumber(activity.scans_last_15m)} scans` : "—"}</span>,
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
      <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-12 text-muted-foreground sm:px-6">
        <SignalShape state="idle" />
        Test read is not available yet. To check this gate now, scan a test band or pass at it and watch it arrive in the last scans below.
      </p>
    );
  }
  if (test.failed || !test.result) {
    return (
      <p role="alert" className="flex items-center gap-2 border-b border-border px-4 py-2 text-12 text-destructive sm:px-6">
        <SignalShape state="stop" />
        {gate?.link_state === "offline"
          ? "The gate did not answer: it is offline. A test read needs the link; check power and network at the gate."
          : "The gate did not answer the test read. Try again, or check the device at the gate."}
      </p>
    );
  }
  const read = test.result;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-12 sm:px-6">
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
      <span className="font-mono text-12 text-destructive tabular-nums">
        {gate.offlineSince ? `none for ${formatAge(now - gate.offlineSince)}` : "never heard"}
      </span>
    );
  }
  if (!at) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono text-12 tabular-nums">{formatAge(now - Date.parse(at))} ago</span>;
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
        meta={
          <>
            last hour · <span className="font-mono tabular-nums">{formatNumber(total)}</span> scans · peak{" "}
            <span className="font-mono tabular-nums">{formatNumber(max)}</span>
          </>
        }
      />
      <div className="px-4 pt-4 pb-3 sm:px-6">
        <ol className="flex h-28 items-end gap-1 border-b border-border">
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
        <div aria-hidden="true" className="mt-1 flex gap-1 font-mono text-11 text-muted-foreground tabular-nums">
          {counts.map((_, i) => (
            <span key={i} className="min-w-0 flex-1 truncate">
              {i === last ? "now" : i % 3 === 0 ? formatClock(from + i * bucket_ms, timeZone, { seconds: false }) : ""}
            </span>
          ))}
        </div>
        <p className="mt-2 text-11 text-muted-foreground">The last bar is the five minutes in progress. Implied exits are not counted.</p>
      </div>
    </section>
  );
}

function Results({ detail }: { detail: GateDetail }) {
  const total = detail.results.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(1, ...detail.results.map((row) => row.count));
  return (
    <section aria-labelledby="gate-results" className="border-t border-border">
      <SectionHead id="gate-results" title="Results by code" meta="last hour" />
      {detail.results.length === 0 ? (
        <p className="px-4 py-3 text-13 text-muted-foreground sm:px-6">No scans at this gate in the last hour.</p>
      ) : (
        <ul className="py-1">
          {detail.results.map((row) => (
            <li key={row.result} className="grid h-8 grid-cols-[9.5rem_minmax(0,1fr)_3.5rem_3rem] items-center gap-3 px-4 sm:grid-cols-[11rem_minmax(0,1fr)_4rem_3.5rem] sm:px-6">
              <ResultChip result={row.result} className="truncate" />
              <span aria-hidden="true" className="h-1 bg-border">
                <span className="block h-full origin-left bg-foreground/40" style={{ transform: `scaleX(${row.count / max})` }} />
              </span>
              <span className="text-right font-mono text-12 tabular-nums">{formatNumber(row.count)}</span>
              <span className="text-right font-mono text-11 text-muted-foreground tabular-nums">{Math.round((row.count / Math.max(1, total)) * 100)}%</span>
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
        meta={
          <Can I="scans.view">
            <Link to={`/access-log?gate=${scans[0]?.checkpoint_id ?? ""}`} className={linkClass}>
              Open in the access log
            </Link>
          </Can>
        }
      />
      {scans.length === 0 ? (
        <p className="px-4 py-3 text-13 text-muted-foreground sm:px-6">
          No scans here yet.{perimeter ? "" : " Interior doors read wristbands only, so a quiet door is normal between sessions."}
        </p>
      ) : (
        <ol className="max-h-[32rem] overflow-y-auto">
          {scans.map((scan) => (
            <li
              key={scan.id}
              className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-4 py-1.5 text-12 sm:h-8 sm:grid-cols-[7.5rem_10rem_5rem_6.5rem_minmax(0,1fr)] sm:px-6 sm:py-0"
            >
              <span className="font-mono tabular-nums text-muted-foreground">{formatScanTime(scan.corrected_at, timeZone)}</span>
              <ResultChip result={scan.result} className="min-w-0 truncate" />
              <span className="text-right text-muted-foreground sm:order-last sm:text-left">
                {scan.offline ? "offline · synced" : scan.latency_ms !== null ? <span className="font-mono tabular-nums">{scan.latency_ms} ms</span> : "—"}
              </span>
              <span className="hidden text-muted-foreground sm:block">{scan.tier ? TIER_LABEL[scan.tier] : "—"}</span>
              <span className="hidden text-muted-foreground sm:block">{scan.carrier_kind ? CARRIER_LABEL[scan.carrier_kind] : "Unknown"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LinkHistory({ detail, timeZone }: { detail: GateDetail; timeZone: string }) {
  const rows = [...detail.link_history].reverse();
  return (
    <section aria-labelledby="gate-links" className="border-t border-border">
      <SectionHead id="gate-links" title="Link history" meta="this shift, newest first" />
      <ol className="py-1">
        {rows.map((change, i) => {
          const view = LINK_VIEW[change.link_state];
          const next = rows[i - 1];
          const lasted = next ? Date.parse(next.at) - Date.parse(change.at) : null;
          return (
            <li key={`${change.at}-${i}`} className="grid min-h-7 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 px-4 text-12">
              <span className="font-mono text-muted-foreground tabular-nums">{formatClock(change.at, timeZone)}</span>
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot state={view.state} label={view.label} showLabel />
                {lasted !== null ? <span className="truncate text-muted-foreground">for {formatAge(lasted)}</span> : <span className="text-muted-foreground">since</span>}
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
        <p className="px-4 py-3 text-12 text-muted-foreground">Loading…</p>
      ) : assignments.status === "error" && errorCode(assignments.error) === "FORBIDDEN" ? (
        // A supervisor may watch the gate but not read the shift plan (GET /staff-assignments is operators only).
        <p className="px-4 py-3 text-12 text-muted-foreground">Shift assignments are kept by the organisers and admins.</p>
      ) : assignments.status === "error" ? (
        <p className="px-4 py-3 text-12 text-destructive">
          Could not load the assignments.{" "}
          <button type="button" className={cn(linkClass, "text-foreground")} onClick={() => assignments.reload()}>
            Try again
          </button>
        </p>
      ) : mine.length === 0 ? (
        <p className="px-4 py-3 text-12 text-muted-foreground">
          {perimeter ? "No one is assigned to this gate." : "No one is assigned here: interior doors read wristbands on fixed readers."}
        </p>
      ) : (
        <ul className="py-1">
          {mine.map((a) => {
            const onShift = !a.handed_over_at && Date.parse(a.shift_start) <= now && now < Date.parse(a.shift_end);
            return (
              <li key={a.id} className="px-4 py-1.5 text-13">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate">{a.staff_name}</span>
                  <StatusDot state={onShift ? "ok" : "idle"} label={a.handed_over_at ? "Handed over" : onShift ? "On shift" : "Off shift"} showLabel className="text-12" />
                </span>
                <span className="block font-mono text-11 text-muted-foreground tabular-nums">
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

