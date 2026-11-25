/**
 * D12 · Gate health `/gates` (docs/06 §2.3). Every checkpoint as a row — label, direction,
 * perimeter or interior, hardware ID, link state, heartbeat age, queue depth, clock offset
 * (flagged past two minutes, D-14), last scan, and throughput over the last 15 minutes as a
 * sparkline — sorted faults first. At ≥1280 a wall view shows one hairline cell per gate for a
 * display across the room. Below 1024 each gate is a stacked block, so a phone never scrolls
 * sideways. Every gate links to D12b.
 *
 * An overview, so it says how a gate is in words and keeps one figure per gate (scans in the
 * last 15 minutes): heartbeat, queue and clock read "in sync" until one of them is off, and only
 * then show their figure. Exact heartbeat ages, offsets and the last scan stay on D12b.
 *
 * Live state (link, queue, clock) comes from the CommandStore — the same gate.health stream
 * the Command Center rail reads. Heartbeat, last scan and the 15-minute series are polled every
 * five seconds (NOT IN CONTRACTS as one call: `gateActivity`). Link down → "last known".
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Checkpoint } from "@synan/contracts/rest";
import { cn } from "@synan/ui/components";
import { SignalShape, Sparkline, StatusDot, formatAge, formatNumber, formatOffset } from "@synan/ui/data";
import type { GateActivity } from "@synan/mock/command";
import { FilterChips, GUTTER_X, PROSE, PageHeader, Table, Td, Th, linkClass, rowClass, useDocumentTitle } from "../kit";
import { api } from "../live/backend";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice } from "../live/slice";
import type { GateLive } from "../live/store";
import { WIDE_QUERY, useMediaQuery } from "../shell/admin-shell";
import { maintenance } from "./maintenance";
import { DIRECTION_LABEL, LastKnown, LiveStates, Num, allowlistStale, clockWrong, faultRank, gateSignal, isFault, roughAge, useLiveReady } from "./shared";

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
            {faults === 0 ? (
              <>
                All <Num value={rows.length} /> gates online
              </>
            ) : (
              <span className="text-warning">
                <Num value={faults} /> of <Num value={rows.length} /> gates need attention
                {offline > 0 ? (
                  <>
                    {" "}
                    · <Num value={offline} /> offline
                  </>
                ) : null}
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
        <p role="status" className={cn("flex min-h-10 items-center gap-2 border-b border-border py-2 text-12 text-muted-foreground", GUTTER_X)}>
          <SignalShape state="warn" className="shrink-0 text-warning" />
          Heartbeats and throughput could not be refreshed; showing the last values read. Retrying every five seconds.
        </p>
      ) : null}
      <div className={cn(stale && "opacity-70")}>
        {wall ? <Wall rows={rows} now={now} /> : <Rows rows={rows} now={now} loading={byId === null} />}
      </div>
      <p className={cn("pt-5 text-12 leading-relaxed text-muted-foreground", GUTTER_X, PROSE)}>
        A gate is offline after 60 seconds without a heartbeat; it keeps scanning on its allowlist and queues scans until it reconnects. A clock more than two minutes out is flagged
        and its scans are ordered by corrected time. A pass list more than 15 minutes old is out of date: offline, the gate still lets known
        passes in, and each one raises an alert. Open a gate for its exact heartbeat, clock offset and last scans.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ cells */

type Tone = "muted" | "warn" | "stop";
const TONE_TEXT: Record<Tone, string> = { muted: "text-muted-foreground", warn: "text-warning", stop: "text-destructive" };

/**
 * What is off with a gate, in words, worst first: the lost link, a late heartbeat, scans queued,
 * a wrong clock, a pass list out of date. A gate with nothing off reads "In sync".
 */
function gateChecks(row: GateRow, now: number): { text: string; tone: Tone }[] {
  const gate = row.gate;
  if (!gate) return [{ text: "No report yet", tone: "muted" }];
  const checks: { text: string; tone: Tone }[] = [];
  if (gate.link_state === "offline") {
    checks.push({ text: gate.offlineSince ? `Link lost ${roughAge(now - gate.offlineSince)}` : "Never heard from", tone: "stop" });
  } else {
    const at = row.activity?.heartbeat_at ?? gate.last_heartbeat_at ?? null;
    const age = at ? now - Date.parse(at) : null;
    if (age !== null && age > HEARTBEAT_LATE_MS) checks.push({ text: `Heartbeat ${formatAge(age)} ago`, tone: "warn" });
  }
  if (gate.queue_depth > 0) checks.push({ text: `${formatNumber(gate.queue_depth)} queued`, tone: "warn" });
  if (clockWrong(gate)) checks.push({ text: `Clock ${gate.clock_offset_ms !== null ? formatOffset(gate.clock_offset_ms) : "wrong"}`, tone: "warn" });
  if (allowlistStale(gate)) checks.push({ text: "Pass list out of date", tone: "warn" });
  return checks.length > 0 ? checks : [{ text: "In sync", tone: "muted" }];
}

function Checks({ row, now, className, queueShown = false }: { row: GateRow; now: number; className?: string; queueShown?: boolean }) {
  // The wall already shows an offline gate's queue as its big figure.
  const checks = gateChecks(row, now).filter((check) => !(queueShown && check.text.endsWith("queued")));
  return (
    <span className={cn("min-w-0", className)}>
      {checks.map((check, i) => (
        <Fragment key={check.text}>
          {i > 0 ? <span className="text-muted-foreground"> · </span> : null}
          <span className={TONE_TEXT[check.tone]}>{check.text}</span>
        </Fragment>
      ))}
    </span>
  );
}

function LinkWord({ gate, className }: { gate: GateLive | undefined; className?: string }) {
  if (!gate) return <StatusDot state="idle" label="Unknown" showLabel className={cn("whitespace-nowrap", className)} />;
  const { state, words } = gateSignal(gate);
  return <StatusDot state={state} label={words} showLabel className={cn("whitespace-nowrap", className)} />;
}

function kindOf(checkpoint: Checkpoint): string {
  return `${DIRECTION_LABEL[checkpoint.direction]} · ${checkpoint.perimeter ? "Perimeter" : "Interior"}`;
}

function Throughput({ row, className }: { row: GateRow; className?: string }) {
  const values = row.activity?.per_minute ?? [];
  return (
    <span className={cn("grid grid-cols-[minmax(4rem,1fr)_2.5rem] items-center gap-3", className)}>
      <Sparkline values={values} label={`${row.checkpoint.label}, scans per minute, last 15 minutes`} toneClassName="text-muted-foreground" />
      <span className="text-right font-mono text-13 tabular-nums">{row.activity ? formatNumber(row.activity.scans_last_15m) : "—"}</span>
    </span>
  );
}

function Maintenance({ since }: { since: number | undefined }) {
  if (since === undefined) return null;
  return (
    <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 text-12 text-muted-foreground" title="Marked for maintenance">
      <SignalShape state="idle" /> Maintenance
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
              {/* The gate keeps a reading width; spare room on a wide screen goes to Checks. */}
              <Th className="w-80">Gate</Th>
              <Th fit>Kind</Th>
              <Th fit>Hardware ID</Th>
              <Th fit>State</Th>
              <Th>Checks</Th>
              <Th className="w-56">Scans, last 15 min{loading ? " …" : ""}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.checkpoint.id} className={cn(rowClass, "cursor-pointer")} onClick={() => navigate(`/gates/${row.checkpoint.id}`)}>
                <Td>
                  <span className="flex min-w-0 items-center">
                    <Link to={`/gates/${row.checkpoint.id}`} onClick={(e) => e.stopPropagation()} className={cn(linkClass, "truncate")}>
                      {row.checkpoint.label}
                    </Link>
                    <Maintenance since={row.maintenanceSince} />
                  </span>
                </Td>
                <Td fit className="text-muted-foreground">
                  {kindOf(row.checkpoint)}
                </Td>
                <Td fit className="font-mono text-muted-foreground tabular-nums">
                  {row.checkpoint.hardware_id ?? "—"}
                </Td>
                <Td fit>
                  <LinkWord gate={row.gate} />
                </Td>
                <Td>
                  <Checks row={row} now={now} className="block truncate" />
                </Td>
                <Td>
                  <Throughput row={row} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {/* Below 1024: one stacked block per gate, nothing wider than the screen. */}
      <ul aria-label="Gates, faults first" className="lg:hidden">
        {rows.map((row) => (
          <li key={row.checkpoint.id} className={cn("relative border-b border-border py-3.5 transition-colors duration-120 ease-standard hover:bg-foreground/3 motion-reduce:transition-none", GUTTER_X)}>
            <div className="flex items-center justify-between gap-3">
              <Link
                to={`/gates/${row.checkpoint.id}`}
                className="min-w-0 truncate text-13 font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:after:outline focus-visible:after:-outline-offset-1 focus-visible:after:outline-brand"
              >
                {row.checkpoint.label}
              </Link>
              <LinkWord gate={row.gate} className="text-13" />
            </div>
            <p className="mt-0.5 flex min-w-0 items-center text-12 text-muted-foreground">
              <span className="truncate">
                {kindOf(row.checkpoint)}
                {row.checkpoint.hardware_id ? <span className="font-mono"> · {row.checkpoint.hardware_id}</span> : null}
              </span>
              <Maintenance since={row.maintenanceSince} />
            </p>
            <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(8rem,11rem)] items-center gap-4">
              <Checks row={row} now={now} className="truncate text-12" />
              <Throughput row={row} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------- wall */

/** One hairline cell per gate, for a display across the room. Faults first, so they sit top-left. */
function Wall({ rows, now }: { rows: GateRow[]; now: number }) {
  return (
    <ul aria-label="Gates, faults first" className="grid grid-cols-3 gap-px border-b border-border bg-border 2xl:grid-cols-4">
      {rows.map((row) => {
        const gate = row.gate;
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
              className="flex h-full flex-col px-5 pt-4 pb-4 outline-none transition-colors duration-120 ease-standard hover:bg-foreground/3 focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-brand motion-reduce:transition-none"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-15 font-medium">{row.checkpoint.label}</span>
                <LinkWord gate={gate} className="text-13" />
              </span>
              <span className="mt-1 flex min-w-0 items-center text-12 text-muted-foreground">
                <span className="truncate">{kindOf(row.checkpoint)}</span>
                <Maintenance since={row.maintenanceSince} />
              </span>
              <span className="mt-5 flex items-end justify-between gap-6">
                {gate?.link_state === "offline" ? (
                  <span className="font-mono text-28 leading-none text-destructive tabular-nums">
                    {formatNumber(gate.queue_depth)}
                    <span className="ml-2 font-sans text-12">queued</span>
                  </span>
                ) : (
                  <span className="font-mono text-28 leading-none tabular-nums">
                    {lastFull === null ? "—" : formatNumber(lastFull)}
                    <span className="ml-2 font-sans text-12 text-muted-foreground">per min</span>
                  </span>
                )}
                <Sparkline values={perMinute} label={`${row.checkpoint.label}, scans per minute, last 15 minutes`} className="mb-1 w-32" toneClassName="text-muted-foreground" />
              </span>
              <Checks row={row} now={now} queueShown={gate?.link_state === "offline"} className="mt-4 block truncate border-t border-border pt-3 text-13" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
