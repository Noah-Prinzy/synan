/**
 * D4 · Events `/events` (docs/06 §2.3). Every event the organisation runs, drafts included:
 * title, venue, dates in the event's own zone, state, registrations and the last edit. Filter
 * by state and search by title, both kept in the URL (`?state=`, `?q=`) so a link lands on
 * the same view. Duplicate is a visible button on every row (most events are repeats): it
 * copies the event and opens the wizard on the copy. One primary action, New event.
 *
 * Opening a row: a draft resumes the wizard where it stopped; a closed or archived event
 * lands on its summary; any other on its workspace overview.
 *
 * States: loading (row skeleton), error with retry, no events at all, no match for the filter.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Plus, Search } from "lucide-react";
import type { EventState } from "@synan/contracts/enums";
import type { EventRow } from "@synan/mock/command";
import { ActionButton, Button, TextInput, buttonClass } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import {
  EVENT_STATE_VIEW,
  EmptyState,
  ErrorState,
  EventStateChip,
  FilterChips,
  LoadingState,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
  formatDateRange,
  formatStamp,
  linkClass,
  rowClass,
  useDocumentTitle,
  useResource,
  zoneLabel,
} from "../kit";
import { configure } from "../live/backend";

type StateFilter = "all" | EventState;
const STATES: EventState[] = ["draft", "published", "live", "closed", "archived"];

/** Where a row opens. A draft without a step resumes where it stopped (the wizard redirects). */
export function eventHref(row: { id: string; state: EventState }): string {
  if (row.state === "draft") return `/events/new?draft=${row.id}`;
  if (row.state === "closed" || row.state === "archived") return `/events/${row.id}/summary`;
  return `/events/${row.id}/overview`;
}

function NewEventLink() {
  return (
    <Link to="/events/new" className={buttonClass("primary", "compact")}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      New event
    </Link>
  );
}

export default function EventList() {
  useDocumentTitle("Events");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const events = useResource(() => configure.eventRows(), []);
  // A line from the wizard: a draft saved and closed, or deleted.
  const [arrival] = useState(() => {
    const state = location.state as { savedDraft?: string; deletedDraft?: string } | null;
    if (state?.savedDraft) return `Draft “${state.savedDraft}” saved. Open it from the list to carry on.`;
    if (state?.deletedDraft) return `Draft “${state.deletedDraft}” deleted.`;
    return null;
  });
  // Said once: a refresh should not repeat it.
  useEffect(() => {
    if (location.state) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rawState = params.get("state");
  const state: StateFilter = rawState && (STATES as string[]).includes(rawState) ? (rawState as EventState) : "all";
  const q = params.get("q") ?? "";

  const update = (key: "state" | "q", value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (!value || value === "all") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const rows = events.status === "ready" ? events.data : [];
  const counts = useMemo(() => {
    const out: Record<StateFilter, number> = { all: rows.length, draft: 0, published: 0, live: 0, closed: 0, archived: 0 };
    for (const row of rows) out[row.state] += 1;
    return out;
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((row) => (state === "all" || row.state === state) && (!needle || row.title.toLowerCase().includes(needle)));

  const duplicate = async (row: EventRow) => {
    const copy = await configure.duplicateEvent(row.id);
    navigate(`/events/new/basics?draft=${copy.id}`, { state: { duplicatedFrom: row.title } });
  };

  const live = counts.live;

  return (
    <div className="min-h-full pb-8">
      <PageHeader
        code="D4"
        title="Events"
        meta={
          events.status === "ready" && rows.length > 0 ? (
            <>
              <span className="font-mono tabular-nums">{formatNumber(rows.length)}</span> {rows.length === 1 ? "event" : "events"}
              {live > 0 ? (
                <>
                  {" "}
                  · <span className="font-mono tabular-nums">{live}</span> live now
                </>
              ) : null}
              {counts.draft > 0 ? (
                <>
                  {" "}
                  · <span className="font-mono tabular-nums">{counts.draft}</span> {counts.draft === 1 ? "draft" : "drafts"}
                </>
              ) : null}
            </>
          ) : (
            "Everything your organisation runs, from first draft to archive."
          )
        }
        actions={<NewEventLink />}
      />
      {arrival ? (
        <div className="px-4 pt-3 sm:px-6">
          <Notice className="max-w-160">{arrival}</Notice>
        </div>
      ) : null}

      {events.status === "loading" ? <LoadingState label="Loading events…" rows={6} /> : null}
      {events.status === "error" ? <ErrorState title="Could not load the events" error={events.error} onRetry={() => events.reload()} /> : null}

      {events.status === "ready" && rows.length === 0 ? (
        <EmptyState title="No events yet" action={<NewEventLink />}>
          <p>
            An event takes five short steps: its name and dates, the venue and rooms it uses, who may enter which room, the pass
            attendees carry, and a final check before registration opens.
          </p>
          <p className="mt-2">Drafts are saved at every step, so you can stop and come back.</p>
        </EmptyState>
      ) : null}

      {events.status === "ready" && rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <FilterChips<StateFilter>
              label="Filter by state"
              value={state}
              onChange={(value) => update("state", value)}
              options={[
                { value: "all", label: "All", count: counts.all },
                ...STATES.map((s) => ({ value: s, label: EVENT_STATE_VIEW[s].label, count: counts[s] })),
              ]}
            />
            <div className="relative w-full sm:w-64">
              <Search size={14} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
              <TextInput
                type="search"
                aria-label="Search events by title"
                placeholder="Search by title"
                value={q}
                onChange={(event) => update("q", event.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              title="No events match"
              action={
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() =>
                    setParams(
                      (current) => {
                        const next = new URLSearchParams(current);
                        next.delete("state");
                        next.delete("q");
                        return next;
                      },
                      { replace: true },
                    )
                  }
                >
                  Clear filters
                </Button>
              }
            >
              <p>
                Nothing {state !== "all" ? <>is {EVENT_STATE_VIEW[state].label.toLowerCase()}</> : null}
                {state !== "all" && needle ? " and " : null}
                {needle ? <>has “{q.trim()}” in its title</> : null}.
              </p>
            </EmptyState>
          ) : (
            <EventTable rows={shown} onDuplicate={duplicate} />
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {shown.length} {shown.length === 1 ? "event" : "events"} shown
          </p>
        </>
      ) : null}
    </div>
  );
}

function EventTable({
  rows,
  onDuplicate,
}: {
  rows: EventRow[];
  onDuplicate: (row: EventRow) => Promise<void>;
}) {
  return (
    <Table label="Events">
      <thead>
        <tr>
          <Th>Title</Th>
          <Th>Venue</Th>
          <Th>Dates</Th>
          <Th>State</Th>
          <Th numeric>Registrations</Th>
          <Th>Last edited</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={rowClass}>
            <Td className="max-w-80">
              <Link to={eventHref(row)} className={`${linkClass} block truncate`}>
                {row.title || <span className="text-muted-foreground">Untitled draft</span>}
              </Link>
            </Td>
            <Td className="max-w-52 text-muted-foreground">
              {row.venue ? (
                <span className="block truncate" title={row.venue.city ? `${row.venue.name} · ${row.venue.city}` : row.venue.name}>
                  <span className="text-foreground/90">{row.venue.name}</span>
                  {row.venue.city ? <> · {row.venue.city}</> : null}
                </span>
              ) : (
                "—"
              )}
            </Td>
            <Td className="whitespace-nowrap">
              {row.starts_at && row.ends_at ? (
                <>
                  <span className="font-mono text-12 tabular-nums">{formatDateRange(row.starts_at, row.ends_at, row.timezone)}</span>
                  {/* The zone, so dates read as event-local: "UTC+3" with the city on hover and for screen readers. */}
                  <span className="ml-2 text-11 text-muted-foreground" title={zoneLabel(row.timezone, Date.parse(row.starts_at))}>
                    <span className="sr-only">{zoneLabel(row.timezone, Date.parse(row.starts_at)).split(" · ")[0]} · </span>
                    {zoneLabel(row.timezone, Date.parse(row.starts_at)).split(" · ")[1]}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Dates not set</span>
              )}
            </Td>
            <Td>
              <EventStateChip state={row.state} />
            </Td>
            <Td numeric className={row.registrations === 0 ? "text-muted-foreground" : undefined}>
              {row.state === "draft" ? "—" : formatNumber(row.registrations)}
            </Td>
            <Td className="py-1 whitespace-nowrap text-11 leading-tight text-muted-foreground">
              <span className="block font-mono text-12 tabular-nums text-foreground/80">{formatStamp(row.updated_at, row.timezone)}</span>
              <span className="block">{row.updated_by}</span>
            </Td>
            <Td className="w-0 text-right">
              <ActionButton
                action={() => onDuplicate(row)}
                doneLabel="Copied"
                failedLabel="Try again"
                variant="quiet"
                size="compact"
                aria-label={`Duplicate ${row.title || "untitled draft"}`}
              >
                <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
                Duplicate
              </ActionButton>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
