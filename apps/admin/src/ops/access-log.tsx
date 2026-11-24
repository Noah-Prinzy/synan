/**
 * D9 · Access log `/access-log` (docs/06 §2.3). The live event's scans, newest first: time to
 * the millisecond (venue-local), checkpoint, tier, carrier, result, and the gate's decision time
 * or the offline flag. Filters by result, gate and room, and a text search over gate and result;
 * all of them live in the URL. A row opens a detail line under it that stays put while you read.
 *
 * New scans arrive at the top while the list is scrolled to the top. Scroll down, open a row or
 * press Pause, and they wait in a "N new scans" bar instead, so nothing moves under the reader.
 * At most 200 rows render; "Load older" pages back and drops the newest, and "Back to latest"
 * returns. Export defers to the report job (P-14).
 *
 * Who presented a pass is not shown: general scan lists carry no per-person id (03 §5).
 * States: loading, error, not live (with the post-purge wording for a closed event), no scans,
 * no match, last known (link down).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import type { ScanResult } from "@synan/contracts/enums";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { Button, Field, Select, TextInput, cn } from "@synan/ui/components";
import { ResultChip, SignalShape, StatusDot, formatNumber, formatOffset, resultLabel } from "@synan/ui/data";
import { CLOSED_EVENT, scanCursor, type OpsScan, type ScanLogQuery } from "@synan/mock/command";
import { Can, useSession } from "../access/session";
import { EmptyState, ErrorState, GUTTER_X, LoadingState, PageHeader, ROW_ACTION, TIER_LABEL, TYPE, formatDate, linkClass, useDocumentTitle, zoneLabel } from "../kit";
import { api, mode } from "../live/backend";
import { useCommand } from "../live/context";
import { useSlice } from "../live/slice";
import type { LiveScan } from "../live/store";
import type { CommandEvent, VenueLayout } from "../live/transport";
import { CARRIER_LABEL, LastKnown, LiveStates, formatScanTime, useLiveReady } from "./shared";

const PAGE = 100;
/** Rows rendered at most. */
const WINDOW = 200;
const FLUSH_MS = 250;
const RECONCILE_MS = 5_000;
const ANY = "any";
/** Every result, from the Zod-free copy module (the enums module would bundle Zod). */
const SCAN_RESULT_VALUES = Object.keys(SCAN_RESULT_COPY) as ScanResult[];

export default function AccessLogScreen() {
  const { event } = useCommand();
  useDocumentTitle(event ? `Access log · ${event.title}` : "Access log");
  const ready = useLiveReady();
  return (
    <div className="min-h-full pb-10">
      {ready && event ? (
        <AccessLog event={event} />
      ) : (
        <>
          <PageHeader code="D9" title="Access log" />
          <LiveStates what="the access log" notLive={notLiveWords} />
        </>
      )}
    </div>
  );
}

/** D9: after the post-event purge the log is empty by design, and says so (03 §6). */
function notLiveWords(event: CommandEvent) {
  if (event.state === "closed" || event.state === "archived") {
    if (event.slug === CLOSED_EVENT.slug) {
      return (
        <>
          Individual scan records for this event were deleted on{" "}
          <span className="font-mono text-foreground">{formatDate(CLOSED_EVENT.purged_at, event.timezone)}</span>, as the retention policy requires, so this log is empty by
          design. The event summary keeps the totals: attendance, gate throughput and alerts.
        </>
      );
    }
    return "Its scan records are kept until the scheduled purge, then deleted; the event summary keeps the totals. This log shows the live event's scans.";
  }
  return "The log fills from the first scan when doors open, and shows the live event's scans as they happen.";
}

/* ------------------------------------------------------------------ query */

interface Filters {
  q: string;
  result: ScanResult | null;
  gate: string | null;
  room: string | null;
}

function checkpointsFor(layout: VenueLayout | null, filters: Filters): string[] | undefined {
  if (!layout) return undefined;
  let ids: string[] | undefined;
  if (filters.room) ids = layout.checkpoints.filter((c) => c.room_id === filters.room).map((c) => c.id);
  if (filters.gate) ids = ids ? ids.filter((id) => id === filters.gate) : [filters.gate];
  return ids;
}

function newerFirst(a: OpsScan, b: OpsScan): number {
  return b.corrected_at.localeCompare(a.corrected_at) || b.id.localeCompare(a.id);
}

function merge(incoming: readonly OpsScan[], rows: readonly OpsScan[]): OpsScan[] {
  const byId = new Map<string, OpsScan>();
  for (const row of rows) byId.set(row.id, row);
  // A server record replaces a streamed one: it has the latency the stream does not carry.
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort(newerFirst);
}

/** A streamed scan as a log row. NOT IN CONTRACTS: the stream has no latency; the next reconcile fills it in. */
function fromStream(scan: LiveScan): OpsScan {
  return {
    id: scan.scan_id,
    event_id: scan.event_id,
    checkpoint_id: scan.checkpoint_id,
    ephemeral_id: null,
    carrier_kind: scan.carrier_kind,
    result: scan.result,
    occurred_at: scan.corrected_at,
    received_at: scan.corrected_at,
    clock_offset_ms: 0,
    offline: scan.offline,
    tier: scan.tier,
    corrected_at: scan.corrected_at,
    latency_ms: null,
  };
}

type Load = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready" };

/* -------------------------------------------------------------------- log */

function AccessLog({ event }: { event: CommandEvent }) {
  const { store } = useCommand();
  const layout = useSlice(store.layout);
  const linkLive = useSlice(store.link).status === "live";
  const [params, setParams] = useSearchParams();
  const timeZone = event.timezone;
  const { can } = useSession();
  // The real API searches for one pass (credential or band), only for a role holding
  // `scans.search` (admins and organisers), and writes each search to the audit log; the mock
  // searches gate and result words for everyone.
  const passSearch = mode === "api";
  const canSearch = !passSearch || can("scans.search");

  const filters = useMemo<Filters>(() => {
    const result = params.get("result");
    const gate = params.get("gate");
    const room = params.get("room");
    return {
      q: canSearch ? (params.get("q") ?? "") : "",
      result: (SCAN_RESULT_VALUES as readonly string[]).includes(result ?? "") ? (result as ScanResult) : null,
      gate: gate && layout?.checkpoints.some((c) => c.id === gate) ? gate : null,
      room: room && layout?.rooms.some((r) => r.id === room) ? room : null,
    };
  }, [params, layout, canSearch]);
  const filtered = Boolean(filters.q || filters.result || filters.gate || filters.room);

  const update = useCallback(
    (patch: Partial<Record<keyof Filters, string | null>>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "" || value === undefined) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The search box writes to the URL a moment after typing stops.
  const [typed, setTyped] = useState(filters.q);
  useEffect(() => setTyped(filters.q), [filters.q]);
  useEffect(() => {
    if (typed === filters.q) return;
    const timer = window.setTimeout(() => update({ q: typed.trim() || null }), 250);
    return () => window.clearTimeout(timer);
  }, [typed, filters.q, update]);

  const gateIds = useMemo(() => checkpointsFor(layout, filters), [layout, filters]);
  const query = useMemo<ScanLogQuery>(
    () => ({ checkpoint_ids: gateIds, result: filters.result ?? undefined, q: filters.q || undefined }),
    [gateIds, filters.result, filters.q],
  );
  const labels = useMemo(() => new Map(layout?.checkpoints.map((c) => [c.id, c.label]) ?? []), [layout]);
  const rooms = useMemo(() => new Map(layout?.rooms.map((r) => [r.id, r.name]) ?? []), [layout]);
  const roomOf = useMemo(() => new Map(layout?.checkpoints.map((c) => [c.id, c.room_id]) ?? []), [layout]);

  const matches = useCallback(
    (scan: OpsScan) => {
      if (query.checkpoint_ids && !query.checkpoint_ids.includes(scan.checkpoint_id)) return false;
      if (query.result && scan.result !== query.result) return false;
      if (query.q) {
        // A pass search is the server's to answer: the reconcile below brings its matches in.
        if (passSearch) return false;
        const q = query.q.toLowerCase();
        const label = labels.get(scan.checkpoint_id)?.toLowerCase() ?? "";
        if (!label.includes(q) && !scan.result.replace(/_/g, " ").includes(q) && !resultLabel(scan.result).toLowerCase().includes(q)) return false;
      }
      return true;
    },
    [query, labels, passSearch],
  );

  /* ------------------------------------------------------------ the rows */

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [rows, setRows] = useState<OpsScan[]>([]);
  const [total, setTotal] = useState(0);
  /** False when the server stopped counting (over 10,000): the total is then a floor. */
  const [exact, setExact] = useState(true);
  const [older, setOlder] = useState(false);
  const [history, setHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [pending, setPending] = useState<OpsScan[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  const paused = held || history || !atTop || expanded !== null;

  const loadLatest = useCallback(() => {
    const mine = ++generation.current;
    setLoad({ status: "loading" });
    setPending([]);
    setHistory(false);
    setOlderFailed(false);
    api.scans(event.id, { ...query, limit: PAGE }).then(
      (page) => {
        if (mine !== generation.current) return;
        setRows(page.items);
        setTotal(page.total);
        setExact((page as { total_exact?: boolean }).total_exact !== false);
        setOlder(page.next_cursor !== null);
        setLoad({ status: "ready" });
      },
      (error: unknown) => mine === generation.current && setLoad({ status: "error", error }),
    );
  }, [event.id, query]);

  useEffect(() => {
    setExpanded(null);
    loadLatest();
  }, [loadLatest, attempt]);

  // Live head: buffer at scan rate, render at ≤ 4 Hz.
  const buffer = useRef<OpsScan[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const off = store.subscribeScans((scan) => {
      const row = fromStream(scan);
      if (matches(row)) buffer.current.push(row);
    });
    const timer = window.setInterval(() => {
      if (buffer.current.length === 0) return;
      const batch = buffer.current.splice(0);
      setTotal((n) => n + batch.length);
      if (pausedRef.current) setPending((current) => merge(batch, current));
      else setRows((current) => merge(batch, current).slice(0, WINDOW));
    }, FLUSH_MS);
    return () => {
      off();
      window.clearInterval(timer);
      buffer.current = [];
    };
  }, [store, matches]);

  // Reconcile with the server every few seconds while live: fills in latency, and catches scans
  // a dropped link missed.
  useEffect(() => {
    if (paused || load.status !== "ready" || !linkLive) return;
    const timer = window.setInterval(() => {
      const mine = generation.current;
      api.scans(event.id, { ...query, limit: 50 }).then(
        (page) => {
          if (mine !== generation.current || pausedRef.current) return;
          setRows((current) => merge(page.items, current).slice(0, WINDOW));
          setTotal(page.total);
          setExact((page as { total_exact?: boolean }).total_exact !== false);
        },
        () => undefined,
      );
    }, RECONCILE_MS);
    return () => window.clearInterval(timer);
  }, [paused, load.status, linkLive, event.id, query]);

  // Back at the top with nothing open: what arrived meanwhile slides in.
  useEffect(() => {
    if (!paused && pending.length > 0) {
      setRows((current) => merge(pending, current).slice(0, WINDOW));
      setPending([]);
    }
  }, [paused, pending]);

  const sentinel = useRef<HTMLDivElement>(null);
  // "At the top" = the head of the list is in view in its scroll container (the shell's main).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target: HTMLElement | Window = scroller ?? window;
    const check = () => {
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      setAtTop(el.getBoundingClientRect().top >= top - 4);
    };
    check();
    target.addEventListener("scroll", check, { passive: true });
    return () => target.removeEventListener("scroll", check);
  }, [load.status]);

  const loadOlder = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const mine = generation.current;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const page = await api.scans(event.id, { ...query, limit: PAGE, cursor: scanCursor(last) });
      if (mine !== generation.current) return;
      setOlder(page.next_cursor !== null);
      setRows((current) => {
        const next = merge(page.items, current);
        return next.length <= WINDOW ? next : next.slice(next.length - WINDOW);
      });
      // Past the window the newest rows drop off: the list is now history, not the live head.
      if (rows.length + page.items.length > WINDOW) setHistory(true);
    } catch {
      if (mine === generation.current) setOlderFailed(true);
    } finally {
      if (mine === generation.current) setLoadingOlder(false);
    }
  };

  const showLatest = () => {
    if (history) loadLatest();
    else {
      setRows((current) => merge(pending, current).slice(0, WINDOW));
      setPending([]);
    }
    setHeld(false);
    setExpanded(null);
    sentinel.current?.scrollIntoView({ block: "start" });
  };

  const clearFilters = () => {
    setTyped("");
    update({ q: null, result: null, gate: null, room: null });
  };

  /* ------------------------------------------------------------- layout */

  const gateOptions = useMemo(
    () => [{ value: ANY, label: "Any gate" }, ...(layout?.checkpoints ?? []).map((c) => ({ value: c.id, label: c.label }))],
    [layout],
  );
  const roomOptions = useMemo(
    () => [
      { value: ANY, label: "Any room" },
      ...(layout?.rooms ?? []).filter((r) => layout?.checkpoints.some((c) => c.room_id === r.id)).map((r) => ({ value: r.id, label: r.name })),
    ],
    [layout],
  );
  const resultOptions = useMemo(() => [{ value: ANY, label: "Any result" }, ...SCAN_RESULT_VALUES.map((r) => ({ value: r, label: sentence(resultLabel(r)) }))], []);

  return (
    <>
      <PageHeader
        code="D9"
        title="Access log"
        meta={
          <>
            {event.title} · newest first · times in {zoneLabel(timeZone, store.now())}, to the millisecond
          </>
        }
        actions={
          <span className="flex items-center gap-3">
            <StatusDot
              state={paused ? "idle" : linkLive ? "ok" : "warn"}
              label={!linkLive ? "Link down" : history ? "Showing older scans" : paused ? "Paused" : "Live"}
              showLabel
              className="text-12"
            />
            <Button variant="secondary" size="compact" aria-pressed={held} onClick={() => setHeld((h) => !h)}>
              {held ? "Resume" : "Pause"}
            </Button>
          </span>
        }
      />
      <LastKnown />

      <div className={cn("flex flex-wrap items-end gap-3 border-b border-border pt-3 pb-4", GUTTER_X)}>
        {canSearch ? (
          <Field
            label={passSearch ? "Find a pass" : "Search"}
            aside={passSearch ? "each search is recorded" : undefined}
            className="w-full sm:w-72"
          >
            <TextInput
              type="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={passSearch ? "Band number, or its last four (••••81BF)" : "Gate or result"}
              suffix={<Search size={16} strokeWidth={1.5} aria-hidden="true" />}
            />
          </Field>
        ) : null}
        <Field label="Result" className="w-[calc(50%-0.375rem)] sm:w-44">
          <Select options={resultOptions} value={filters.result ?? ANY} onChange={(v) => update({ result: v === ANY ? null : v })} />
        </Field>
        <Field label="Gate" className="w-[calc(50%-0.375rem)] sm:w-48">
          <Select options={gateOptions} value={filters.gate ?? ANY} onChange={(v) => update({ gate: v === ANY ? null : v })} />
        </Field>
        <Field label="Room" className="w-[calc(50%-0.375rem)] sm:w-44">
          <Select options={roomOptions} value={filters.room ?? ANY} onChange={(v) => update({ room: v === ANY ? null : v })} />
        </Field>
        {filtered ? (
          <button type="button" onClick={clearFilters} className={ROW_ACTION}>
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
            Clear filters
          </button>
        ) : null}
      </div>

      <Notes eventId={event.id} />

      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {load.status === "loading" ? (
        <LoadingState label="Loading scans…" rows={10} className={GUTTER_X} />
      ) : load.status === "error" ? (
        <ErrorState title="Could not load the access log" error={load.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No scans match"
            className={GUTTER_X}
            action={
              <Button variant="secondary" size="compact" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            Nothing in the log matches {filters.q ? <>“{filters.q}”</> : "these filters"}. New scans that match appear here as they happen.
          </EmptyState>
        ) : (
          <EmptyState title="No scans yet" className={GUTTER_X}>
            The first scan at any gate appears here the moment it is read.</EmptyState>
        )
      ) : (
        <section aria-label="Scans">
          {pending.length > 0 || history ? (
            <div className={cn("sticky top-0 z-[2] flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-background py-1.5 text-12", GUTTER_X)}>
              <span className="text-muted-foreground" role="status">
                {history ? "Showing older scans; new ones are not added while you browse." : null}
                {!history && pending.length > 0 ? (
                  <>
                    <span className="font-mono text-foreground tabular-nums">{formatNumber(pending.length)}</span> new {pending.length === 1 ? "scan" : "scans"} waiting
                    {held ? " while paused" : expanded ? " while a row is open" : " above"}
                  </>
                ) : null}
              </span>
              <Button variant="secondary" size="compact" onClick={showLatest}>
                {history ? "Back to latest" : "Show new scans"}
              </Button>
            </div>
          ) : null}
          <div aria-hidden="true" className={cn("hidden h-9 items-center gap-x-4 border-b border-border md:grid", LOG_COLS, GUTTER_X, TYPE.label)}>
            <span>Time</span>
            <span>Checkpoint</span>
            <span>Tier</span>
            <span>Carrier</span>
            <span>Result</span>
            <span className="text-right">Decided in</span>
          </div>
          <ol>
            {rows.map((scan) => (
              <ScanRow
                key={scan.id}
                scan={scan}
                label={labels.get(scan.checkpoint_id) ?? "Unknown gate"}
                room={rooms.get(roomOf.get(scan.checkpoint_id) ?? "") ?? null}
                timeZone={timeZone}
                open={expanded === scan.id}
                onToggle={() => setExpanded((id) => (id === scan.id ? null : scan.id))}
              />
            ))}
          </ol>
          <footer className={cn("flex min-h-14 flex-wrap items-center justify-between gap-3 py-3 text-12 text-muted-foreground", GUTTER_X)}>
            <span>
              Showing <span className="font-mono tabular-nums">{formatNumber(rows.length)}</span> of{" "}
              {/* The server counts exactly up to 10,000; past that its total is a floor. */}
              {exact ? null : "at least "}
              <span className="font-mono tabular-nums">{formatNumber(Math.max(total, rows.length))}</span>
              {filtered ? " matching" : ""} scans{rows.length >= WINDOW ? ` · ${WINDOW} at a time` : ""}
            </span>
            {older ? (
              <Button variant="secondary" size="compact" loading={loadingOlder} onClick={() => void loadOlder()}>
                {olderFailed ? "Could not load · try again" : "Load older"}
              </Button>
            ) : (
              <span>Start of the log</span>
            )}
          </footer>
        </section>
      )}
    </>
  );
}

/**
 * Time · checkpoint · tier · carrier · result · decided in. Shared by the column head and every row.
 * The checkpoint keeps a reading width; spare room on a wide screen goes before "Decided in".
 */
const LOG_COLS = "md:grid-cols-[7.5rem_minmax(9rem,18rem)_6rem_7rem_12rem_minmax(5rem,1fr)]";

function sentence(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function Notes({ eventId }: { eventId: string }) {
  const { can } = useSession();
  // The event's attendee table is in the event workspace; a role without it (the supervisor)
  // finds people in the attendee lookup instead (routes.ts, D-23).
  const workspace = can("events.view");
  return (
    <p className={cn("border-b border-border py-2.5 text-12 leading-relaxed text-muted-foreground", GUTTER_X)}>
      Who presented a pass is not shown here.{" "}
      {can("attendees.view") ? (
        <>
          To find one person, open{" "}
          <Link to={workspace ? `/events/${eventId}/attendees` : "/attendees"} className={linkClass}>
            Attendees
          </Link>
          : it shows their pass, band and last scan.
        </>
      ) : null}
      {workspace && can("reports.view") ? (
        <>
          {" "}
          To export scans, start a{" "}
          <Link to={`/events/${eventId}/reports`} className={linkClass}>
            report
          </Link>
          : exports run as a job.
        </>
      ) : null}
    </p>
  );
}

function ScanRow({
  scan,
  label,
  room,
  timeZone,
  open,
  onToggle,
}: {
  scan: OpsScan;
  label: string;
  room: string | null;
  timeZone: string;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = `scan-${scan.id}`;
  return (
    <li className={cn("border-b border-border", open && "bg-foreground/4")}>
      <div
        className={cn(
          "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2 transition-colors duration-120 ease-standard hover:bg-foreground/3 motion-reduce:transition-none md:h-10 md:py-0",
          LOG_COLS,
          GUTTER_X,
        )}
      >
        {open ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={onToggle}
          className="text-left font-mono text-12 tabular-nums outline-none after:absolute after:inset-0 focus-visible:after:outline focus-visible:after:-outline-offset-1 focus-visible:after:outline-brand md:text-13"
        >
          {formatScanTime(scan.corrected_at, timeZone)}
          <span className="sr-only">
            , {label}, {resultLabel(scan.result)}
          </span>
        </button>
        <ResultChip result={scan.result} className="justify-self-end md:order-5 md:justify-self-start" />
        <span className="col-span-2 flex min-w-0 gap-x-2 text-12 text-muted-foreground md:contents md:text-13">
          <span className="truncate md:order-2 md:text-foreground">{label}</span>
          <span className="shrink-0 truncate md:order-3">{scan.tier ? TIER_LABEL[scan.tier] : "—"}</span>
          <span className="shrink-0 truncate md:order-4">{scan.carrier_kind ? CARRIER_LABEL[scan.carrier_kind] : "Unknown"}</span>
          <span className="ml-auto shrink-0 text-right md:order-6 md:ml-0">
            {scan.offline ? (
              <span className="inline-flex items-center gap-1.5">
                <SignalShape state="idle" /> Offline
              </span>
            ) : scan.latency_ms !== null ? (
              <span className="font-mono tabular-nums">{scan.latency_ms} ms</span>
            ) : (
              "—"
            )}
          </span>
        </span>
      </div>
      {open ? (
        <dl id={detailId} className={cn("grid grid-cols-2 gap-x-6 gap-y-3 pt-1 pb-4 text-13 sm:grid-cols-3 lg:grid-cols-4", GUTTER_X, "md:pl-[calc(1.5rem+7.5rem+1rem)] 2xl:pl-[calc(2rem+7.5rem+1rem)]")}>
          <Detail label="Corrected time" value={formatScanTime(scan.corrected_at, timeZone)} mono />
          <Detail label="Device time" value={formatScanTime(scan.occurred_at, timeZone)} mono />
          <Detail label="Received" value={formatScanTime(scan.received_at, timeZone)} mono />
          <Detail label="Clock offset" value={scan.clock_offset_ms === 0 ? "In sync" : formatOffset(scan.clock_offset_ms)} mono={scan.clock_offset_ms !== 0} />
          <Detail label="Decided" value={scan.offline ? "Offline, on the gate's allowlist; synced later" : "Online"} />
          <Detail label="Room" value={room ?? "Venue perimeter"} />
          <Detail label="Scan ID" value={scan.id} mono />
          <Can I="gates.view">
            <div className="min-w-0">
              <dt className="text-12 text-muted-foreground">Gate</dt>
              <dd>
                <Link to={`/gates/${scan.checkpoint_id}`} className={linkClass}>
                  Open {label}
                </Link>
              </dd>
            </div>
          </Can>
        </dl>
      ) : null}
    </li>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-12 text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate", mono && "font-mono tabular-nums")} title={value}>
        {value}
      </dd>
    </div>
  );
}

