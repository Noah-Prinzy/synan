/**
 * D2 · Venues `/venues` (docs/06 §2.3). Every building the organisation runs events in: name,
 * city, floors, zones, rooms, total capacity, active events and the state of its layout. A
 * venue with no zones is flagged quietly: it still needs drawing before an event can use it.
 * One primary action, New venue.
 *
 * States: loading (row skeleton), error with retry, empty (no venues yet; try `?setup=fresh`).
 */
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { buttonClass } from "@synan/ui/components";
import { SignalShape, formatNumber } from "@synan/ui/data";
import type { VenueRow } from "@synan/mock/command";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  Td,
  Th,
  formatDate,
  linkClass,
  rowClass,
  useDocumentTitle,
  useResource,
} from "../kit";
import { configure } from "../live/backend";

function NewVenueLink() {
  return (
    <Link to="/venues/new" className={buttonClass("primary", "compact")}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      New venue
    </Link>
  );
}

export default function VenueList() {
  useDocumentTitle("Venues");
  const venues = useResource(() => configure.venues(), []);

  const rows = venues.status === "ready" ? venues.data : [];
  const places = rows.reduce((sum, row) => sum + row.capacity, 0);
  const undrawn = rows.filter((row) => row.zones === 0).length;

  return (
    <div className="min-h-full pb-8">
      <PageHeader
        code="D2"
        title="Venues"
        meta={
          venues.status === "ready" && rows.length > 0 ? (
            <>
              <span className="font-mono tabular-nums">{formatNumber(rows.length)}</span> {rows.length === 1 ? "venue" : "venues"} ·{" "}
              <span className="font-mono tabular-nums">{formatNumber(places)}</span> places across every room
              {undrawn > 0 ? (
                <>
                  {" "}
                  · <span className="font-mono tabular-nums">{undrawn}</span> still to draw
                </>
              ) : null}
            </>
          ) : (
            "The buildings your events are held in."
          )
        }
        actions={<NewVenueLink />}
      />

      {venues.status === "loading" ? <LoadingState label="Loading venues…" rows={4} /> : null}
      {venues.status === "error" ? <ErrorState title="Could not load the venues" error={venues.error} onRetry={() => venues.reload()} /> : null}
      {venues.status === "ready" && rows.length === 0 ? (
        <EmptyState title="No venues yet" action={<NewVenueLink />}>
          <p>
            A venue is the building an event happens in. You name it and list its floors, then draw it on a simple grid: zones
            for the large areas (a hall, a wing, a garden) and rooms inside them, each with its own capacity.
          </p>
          <p className="mt-2">Gates, capacity alerts and the Command Center map all work from that drawing.</p>
        </EmptyState>
      ) : null}
      {venues.status === "ready" && rows.length > 0 ? <VenueTable rows={rows} /> : null}
    </div>
  );
}

function VenueTable({ rows }: { rows: VenueRow[] }) {
  return (
    <Table label="Venues">
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>City</Th>
          <Th numeric>Floors</Th>
          <Th numeric>Zones</Th>
          <Th numeric>Rooms</Th>
          <Th numeric>Capacity</Th>
          <Th numeric>Active events</Th>
          <Th>Layout</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.venue.id} className={rowClass}>
            <Td className="max-w-80">
              <Link to={`/venues/${row.venue.id}`} className={`${linkClass} block truncate`}>
                {row.venue.name}
              </Link>
            </Td>
            <Td className="whitespace-nowrap text-muted-foreground">{row.venue.city ?? "—"}</Td>
            <Td numeric title={row.floors.join(", ")}>
              {formatNumber(row.floors.length)}
            </Td>
            <Td numeric>{formatNumber(row.zones)}</Td>
            <Td numeric>{formatNumber(row.rooms)}</Td>
            <Td numeric>{row.capacity > 0 ? formatNumber(row.capacity) : <span className="text-muted-foreground">—</span>}</Td>
            <Td numeric className={row.active_events === 0 ? "text-muted-foreground" : undefined}>
              {formatNumber(row.active_events)}
            </Td>
            <Td className="whitespace-nowrap">
              <LayoutState row={row} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LayoutState({ row }: { row: VenueRow }) {
  if (row.zones === 0) {
    return (
      <Link
        to={`/venues/${row.venue.id}?edit=1`}
        className="inline-flex items-center gap-1.5 text-12 text-warning underline decoration-warning/30 underline-offset-4 hover:decoration-warning"
      >
        <SignalShape state="warn" /> No layout yet
        <span className="sr-only">: draw {row.venue.name}</span>
      </Link>
    );
  }
  if (!row.layout_published_at) return <span className="text-12 text-muted-foreground">Not published</span>;
  return (
    <span className="text-12 text-muted-foreground">
      Published <span className="font-mono text-foreground/80 tabular-nums">{formatDate(row.layout_published_at, row.venue.timezone)}</span>
    </span>
  );
}
