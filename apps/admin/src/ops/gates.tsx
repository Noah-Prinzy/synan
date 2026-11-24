/**
 * D12 · Gate health `/gates` (docs/06 §2.3). Every checkpoint as a row — label, direction,
 * perimeter or interior, hardware ID, link state, heartbeat age, queue depth, clock offset
 * (flagged past two minutes, D-14), last scan, and throughput over the last 15 minutes as a
 * sparkline — sorted faults first. At ≥1280 a wall view shows one hairline cell per gate for a
 * display across the room. Below 1024 each gate is a stacked block, so a phone never scrolls
 * sideways. Every gate links to D12b.
 *
 * Live state (link, queue, clock) comes from the CommandStore — the same gate.health stream
 * the Command Center rail reads. Heartbeat, last scan and the 15-minute series are polled every
 * five seconds (NOT IN CONTRACTS as one call: `gateActivity`). Link down → "last known".
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Checkpoint } from "@synan/contracts/rest";
import { cn } from "@synan/ui/components";
import { SignalShape, Sparkline, StatusDot, formatAge, formatNumber, formatOffset } from "@synan/ui/data";
import type { GateActivity } from "@synan/mock/command";
import { FilterChips, PageHeader, Table, Td, Th, linkClass, rowClass, useDocumentTitle } from "../kit";
import { api } from "../live/backend";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { GateLive } from "../live/store";
import { WIDE_QUERY, useMediaQuery } from "../shell/admin-shell";
import { maintenance } from "./maintenance";
import { DIRECTION_LABEL, LINK_VIEW, LastKnown, LiveStates, Num, clockWrong, faultRank, gateSignal, isFault, useLiveReady } from "./shared";

const POLL_MS = 5_000;
/** Devices heartbeat every 15 s; two missed beats is worth a look before the 60 s offline rule. */
const HEARTBEAT_LATE_MS = 30_000;

export default function GatesScreen() {
  const { event } = useCommand();
  useDocumentTitle(event ? `Gate health · ${event.title}` : "Gate health");
  const ready = useLiveReady();
  return (
    <div className="min-h-full pb-10">
      {ready ? (
        <GateBoard />
      ) : (
        <>
          <PageHeader code="D12" title="Gate health" />
          <LiveStates
            what="gate health"
            notLive={() => "Gate health is shown only while an event is live: link state, heartbeats, queued scans and scanner clocks come from the gates on shift."}
          />
        </>
      )}
    </div>
  );
}

/** Heartbeat, last scan and the 15-minute series per gate, re-read every five seconds. */
export function useGateActivity(eventId: string | undefined): { byId: ReadonlyMap<string, GateActivity> | null; failed: boolean } {
  const [byId, setById] = useState<ReadonlyMap<string, GateActivity> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    const read = () =>
      api.gateActivity(eventId).then(
        (rows) => {
          if (!alive) return;
          setById(new Map(rows.map((row) => [row.checkpoint_id, row])));
          setFailed(false);
        },
        () => alive && setFailed(true),
      );
    void read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [eventId]);
  return { byId, failed };
}

interface GateRow {
  checkpoint: Checkpoint;
  gate: GateLive | undefined;
  activity: GateActivity | undefined;
  maintenanceSince: number | undefined;
}

function GateBoard() {
  const { store, event } = useCommand();
  const layout = useSlice(store.layout);
  const gates = useSlice(store.gates);
  const marked = useSlice(maintenance);
  const stale = useSlice(store.link).status !== "live";
  const wide = useMediaQuery(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const wall = wide && params.get("view") === "wall";
  const { byId, failed } = useGateActivity(event?.id);
  const now = useNow(1000);

  const rows = useMemo<GateRow[]>(() => {
    const checkpoints = layout?.checkpoints ?? [];
    const order = new Map(checkpoints.map((c, i) => [c.id, i]));
    return checkpoints
      .map((checkpoint) => ({
        checkpoint,
        gate: gates.get(checkpoint.id),
        activity: byId?.get(checkpoint.id),
        maintenanceSince: marked.get(checkpoint.id),
      }))
      .sort(
        (a, b) =>
          (a.gate ? faultRank(a.gate) : 3) - (b.gate ? faultRank(b.gate) : 3) ||
          (order.get(a.checkpoint.id) ?? 0) - (order.get(b.checkpoint.id) ?? 0),
      );
  }, [layout, gates, byId, marked]);

  const faults = rows.filter((row) => row.gate && isFault(row.gate)).length;
  const offline = rows.filter((row) => row.gate?.link_state === "offline").length;
  const recent = byId ? [...byId.values()].reduce((sum, row) => sum + row.scans_last_15m, 0) : null;

  return (
    <>
      <PageHeader
        code="D12"
        title="Gate health"
        meta={
          <>
            <Num value={rows.length} /> checkpoints ·{" "}
            {faults === 0 ? (
              "all online"
            ) : (
              <span className="text-warning">
                <Num value={faults} /> need attention{offline > 0 ? <> · <Num value={offline} /> offline</> : null}
              </span>
            )}
            {recent !== null ? (
              <>
                {" "}
                · <Num value={recent} /> scans in the last 15 min
              </>
            ) : null}
          </>
        }
        actions={
          wide ? (
            <FilterChips
              label="View"
              value={wall ? "wall" : "rows"}
              onChange={(value) =>
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    if (value === "wall") next.set("view", "wall");
                    else next.delete("view");
                    return next;
                  },
                  { replace: true },
                )
              }
              options={[
                { value: "rows", label: "Rows" },
                { value: "wall", label: "Wall" },
              ]}
            />
          ) : undefined
        }
      />
      <LastKnown />
      {failed ? (
        <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-12 text-muted-foreground sm:px-6">
          <SignalShape state="warn" className="text-warning" />
          Heartbeats and throughput could not be refreshed; showing the last values read. Retrying every five seconds.
        </p>
      ) : null}
      <div className={cn(stale && "opacity-70")}>
        {wall ? <Wall rows={rows} now={now} /> : <Rows rows={rows} now={now} loading={byId === null} />}
      </div>
      <p className="px-4 pt-4 text-12 text-muted-foreground sm:px-6">
        A gate is offline after 60 seconds without a heartbeat; it keeps scanning on its allowlist and queues scans until it reconnects. A clock more than two minutes out is flagged
        and its scans are ordered by corrected time.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ cells */

function heartbeatText(row: GateRow, now: number): { text: string; tone: string } {
  const gate = row.gate;
  if (gate?.link_state === "offline") {
    return gate.offlineSince ? { text: `lost ${formatAge(now - gate.offlineSince)}`, tone: "text-destructive" } : { text: "never heard", tone: "text-destructive" };
  }
  const at = row.activity?.heartbeat_at ?? gate?.last_heartbeat_at ?? null;
  if (!at) return { text: "—", tone: "text-muted-foreground" };
  const age = now - Date.parse(at);
  return { text: `${formatAge(age)} ago`, tone: age > HEARTBEAT_LATE_MS ? "text-warning" : "" };
}

function clockText(gate: GateLive | undefined): { text: string; tone: string } {
  if (!gate || gate.clock_offset_ms === null) return { text: "—", tone: "text-muted-foreground" };
  if (clockWrong(gate)) return { text: `${formatOffset(gate.clock_offset_ms)} · wrong`, tone: "text-warning" };
  return { text: gate.clock_offset_ms === 0 ? "in sync" : formatOffset(gate.clock_offset_ms), tone: "text-muted-foreground" };
}

function lastScanText(row: GateRow, now: number): string {
  const at = row.activity?.last_scan_at;
  return at ? `${formatAge(now - Date.parse(at))} ago` : "—";
}

function LinkWord({ gate }: { gate: GateLive | undefined }) {
  if (!gate) return <StatusDot state="idle" label="Unknown" showLabel className="text-12" />;
  const { state, words } = gateSignal(gate);
  const link = LINK_VIEW[gate.link_state];
  // The link word, then what else is wrong (a queue draining, a clock) as the rail says it.
  return <StatusDot state={state} label={words === link.label ? link.label : `${link.label} · ${words.toLowerCase()}`} showLabel className="text-12 whitespace-nowrap" />;
}

function Throughput({ row, className }: { row: GateRow; className?: string }) {
  const values = row.activity?.per_minute ?? [];
  return (
    <span className={cn("grid grid-cols-[minmax(3rem,1fr)_auto] items-center gap-2", className)}>
      <Sparkline values={values} label={`${row.checkpoint.label}, scans per minute, last 15 minutes`} toneClassName="text-muted-foreground" />
      <span className="w-9 text-right font-mono text-12 tabular-nums">{row.activity ? formatNumber(row.activity.scans_last_15m) : "—"}</span>
    </span>
  );
}

function Maintenance({ since }: { since: number | undefined }) {
  if (since === undefined) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-11 text-muted-foreground" title="Marked on this page only (mock)">
      <SignalShape state="idle" /> maintenance
    </span>
  );
}

/* ------------------------------------------------------------------- rows */

function Rows({ rows, now, loading }: { rows: GateRow[]; now: number; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden lg:block">
        <Table label="Gates, faults first">
          <thead>
            <tr>
              <Th>Gate</Th>
              <Th>Direction</Th>
              <Th>Position</Th>
              <Th>Hardware ID</Th>
              <Th>Link</Th>
              <Th numeric>Heartbeat</Th>
              <Th numeric>Queue</Th>
              <Th numeric>Clock</Th>
              <Th numeric>Last scan</Th>
              <Th className="w-44">Last 15 min{loading ? " …" : ""}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const beat = heartbeatText(row, now);
              const clock = clockText(row.gate);
              const queue = row.gate?.queue_depth ?? 0;
              return (
                <tr key={row.checkpoint.id} className={cn(rowClass, "cursor-pointer")} onClick={() => navigate(`/gates/${row.checkpoint.id}`)}>
                  <Td className="max-w-64">
                    <span className="flex min-w-0 items-center">
                      <Link to={`/gates/${row.checkpoint.id}`} onClick={(e) => e.stopPropagation()} className={cn(linkClass, "truncate")}>
                        {row.checkpoint.label}
                      </Link>
                      <Maintenance since={row.maintenanceSince} />
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{DIRECTION_LABEL[row.checkpoint.direction]}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{row.checkpoint.perimeter ? "Perimeter" : "Interior"}</Td>
                  <Td className="font-mono text-12 whitespace-nowrap text-muted-foreground">{row.checkpoint.hardware_id ?? "—"}</Td>
                  <Td>
                    <LinkWord gate={row.gate} />
                  </Td>
                  <Td numeric className={cn("whitespace-nowrap", beat.tone)}>
                    {beat.text}
                  </Td>
                  <Td numeric className={queue > 0 ? "text-warning" : "text-muted-foreground"}>
                    {formatNumber(queue)}
                  </Td>
                  <Td numeric className={cn("whitespace-nowrap", clock.tone)}>
                    {clock.text}
                  </Td>
                  <Td numeric className="whitespace-nowrap text-muted-foreground">
                    {lastScanText(row, now)}
                  </Td>
                  <Td>
                    <Throughput row={row} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Below 1024: one stacked block per gate, nothing wider than the screen. */}
      <ul aria-label="Gates, faults first" className="lg:hidden">
        {rows.map((row) => {
          const beat = heartbeatText(row, now);
          const clock = clockText(row.gate);
          const queue = row.gate?.queue_depth ?? 0;
          return (
            <li key={row.checkpoint.id} className="relative border-b border-border px-4 py-3 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <Link
                  to={`/gates/${row.checkpoint.id}`}
                  className="min-w-0 truncate text-13 font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:after:outline focus-visible:after:-outline-offset-1 focus-visible:after:outline-brand"
                >
                  {row.checkpoint.label}
                </Link>
                <LinkWord gate={row.gate} />
              </div>
              <p className="mt-0.5 truncate text-12 text-muted-foreground">
                {DIRECTION_LABEL[row.checkpoint.direction]} · {row.checkpoint.perimeter ? "Perimeter" : "Interior"}
                {row.checkpoint.hardware_id ? <span className="font-mono"> · {row.checkpoint.hardware_id}</span> : null}
                <Maintenance since={row.maintenanceSince} />
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-12">
                <Fact label="Heartbeat" value={beat.text} tone={beat.tone} />
                <Fact label="Queue" value={formatNumber(queue)} tone={queue > 0 ? "text-warning" : ""} />
                <Fact label="Clock" value={clock.text} tone={clock.tone} />
                <Fact label="Last scan" value={lastScanText(row, now)} />
                <div className="col-span-2 min-w-0">
                  <dt className="text-11 text-muted-foreground">Last 15 min</dt>
                  <dd>
                    <Throughput row={row} />
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Fact({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-11 text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-mono tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------- wall */

/** One hairline cell per gate, for a display across the room. Faults first, so they sit top-left. */
function Wall({ rows, now }: { rows: GateRow[]; now: number }) {
  return (
    <ul aria-label="Gates, faults first" className="grid grid-cols-3 gap-px border-b border-border bg-border 2xl:grid-cols-4">
      {rows.map((row) => {
        const gate = row.gate;
        const beat = heartbeatText(row, now);
        const clock = clockText(gate);
        const signal = gate ? gateSignal(gate) : null;
        const perMinute = row.activity?.per_minute ?? [];
        const lastFull = perMinute.length > 1 ? (perMinute[perMinute.length - 2] ?? 0) : null;
        return (
          <li key={row.checkpoint.id} className="relative bg-background">
            {signal && signal.state !== "ok" ? (
              <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-0.5", signal.state === "stop" ? "bg-destructive" : "bg-warning")} />
            ) : null}
            <Link
              to={`/gates/${row.checkpoint.id}`}
              className="block px-4 pt-3 pb-3 outline-none transition-colors duration-120 ease-standard hover:bg-foreground/3 focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-brand motion-reduce:transition-none"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-13 font-medium">{row.checkpoint.label}</span>
                <LinkWord gate={gate} />
              </span>
              <span className="mt-0.5 block truncate text-12 text-muted-foreground">
                {DIRECTION_LABEL[row.checkpoint.direction]} · {row.checkpoint.perimeter ? "Perimeter" : "Interior"}
                {row.checkpoint.hardware_id ? <span className="font-mono"> · {row.checkpoint.hardware_id}</span> : null}
                <Maintenance since={row.maintenanceSince} />
              </span>
              <span className="mt-3 flex items-end justify-between gap-4">
                {gate?.link_state === "offline" ? (
                  <span className="font-mono text-21 leading-none text-destructive tabular-nums">
                    {formatNumber(gate.queue_depth)}
                    <span className="ml-1.5 font-sans text-12">queued</span>
                  </span>
                ) : (
                  <span className="font-mono text-28 leading-none tabular-nums">
                    {lastFull === null ? "—" : formatNumber(lastFull)}
                    <span className="ml-1.5 font-sans text-12 text-muted-foreground">/min</span>
                  </span>
                )}
                <Sparkline values={perMinute} label={`${row.checkpoint.label}, scans per minute, last 15 minutes`} className="w-28" toneClassName="text-muted-foreground" />
              </span>
              <span className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-2 text-11 text-muted-foreground">
                <span className="min-w-0">
                  Heartbeat
                  <span className={cn("block truncate font-mono text-12 tabular-nums", beat.tone || "text-foreground")}>{beat.text}</span>
                </span>
                <span className="min-w-0">
                  Queue
                  <span className={cn("block font-mono text-12 tabular-nums", (gate?.queue_depth ?? 0) > 0 ? "text-warning" : "text-foreground")}>
                    {formatNumber(gate?.queue_depth ?? 0)}
                  </span>
                </span>
                <span className="min-w-0">
                  Clock
                  <span className={cn("block truncate font-mono text-12 tabular-nums", clock.tone === "text-warning" ? "text-warning" : "text-foreground")}>{clock.text}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
