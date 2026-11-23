/**
 * D6 · Event workspace `/events/:id` (docs/06 §2.3). One event, its setup and its record, in
 * eight tabs: Overview · Schedule · Rooms & rules · Attendees · Credentials · Staff · Reports ·
 * Settings. The header (state, venue, dates in the event's zone) and the tab row stay put while
 * tabs change; each tab is a real subroute, so a tab link can be pasted into a chat.
 *
 * The event and its venue are loaded once here and handed to the tabs (`useWorkspaceEvent`).
 * States: loading, not found, error with retry.
 */
import { useCallback, useMemo } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { Radio } from "lucide-react";
import { Button, buttonClass } from "@synan/ui/components";
import type { EventRecord } from "@synan/mock/command";
import {
  EmptyState,
  ErrorState,
  EventStateChip,
  LoadingState,
  PageHeader,
  RouteTabs,
  errorCode,
  formatDateRange,
  linkClass,
  useResource,
  zoneLabel,
} from "../kit";
import { configure } from "../live/backend";
import { useCommand } from "../live/context";
import { WorkspaceProvider, type WorkspaceValue } from "./parts/context";

const TABS = [
  ["overview", "Overview"],
  ["schedule", "Schedule"],
  ["rooms", "Rooms & rules"],
  ["attendees", "Attendees"],
  ["credentials", "Credentials"],
  ["staff", "Staff"],
  ["reports", "Reports"],
  ["settings", "Settings"],
] as const;

export default function EventWorkspace() {
  const { id = "" } = useParams();
  const resource = useResource(() => configure.event(id), [id]);
  const venueId = resource.status === "ready" ? resource.data.venue_id : null;
  const venue = useResource(() => (venueId ? configure.venue(venueId) : Promise.resolve(null)), [venueId]);

  const { set } = resource;
  const replace = useCallback((record: EventRecord) => set(() => record), [set]);

  const value = useMemo<WorkspaceValue | null>(
    () =>
      resource.status === "ready"
        ? {
            event: resource.data,
            reload: resource.reload,
            replace,
            venue,
            readOnly: resource.data.state === "closed" || resource.data.state === "archived",
            tabPrimary: resource.data.state !== "draft",
          }
        : null,
    [resource, replace, venue],
  );

  if (resource.status === "loading") return <LoadingState label="Loading the event…" rows={6} />;
  if (resource.status === "error") {
    if (errorCode(resource.error) === "NOT_FOUND") {
      return (
        <EmptyState
          title="This event does not exist"
          action={
            <Link to="/events" className={buttonClass("secondary", "compact")}>
              All events
            </Link>
          }
        >
          It may have been a draft that was deleted, or the link is incomplete.
        </EmptyState>
      );
    }
    return <ErrorState title="Could not load the event" error={resource.error} onRetry={() => resource.reload()} />;
  }
  if (!value) return null;

  return (
    <WorkspaceProvider value={value}>
      <div className="flex min-h-full flex-col">
        <WorkspaceHeader value={value} />
        <RouteTabs
          label="Event workspace"
          items={TABS.map(([path, label]) => ({ to: `/events/${id}/${path}`, label }))}
        />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </WorkspaceProvider>
  );
}

function WorkspaceHeader({ value }: { value: WorkspaceValue }) {
  const { event, venue } = value;
  const navigate = useNavigate();
  const { event: selected, events, selectEvent } = useCommand();
  const watchable = selected?.id !== event.id && (events?.some((e) => e.id === event.id) ?? false);
  const venueName = venue.status === "ready" ? (venue.data?.venue.name ?? null) : null;

  return (
    <PageHeader
      code="D6"
      back={
        <Link to="/events" className={linkClass}>
          Events
        </Link>
      }
      title={event.title || "Untitled event"}
      meta={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <EventStateChip state={event.state} />
          <span aria-hidden="true">·</span>
          <span>{event.venue_id ? (venueName ?? "…") : "No venue yet"}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-12 tabular-nums">{formatDateRange(event.starts_at, event.ends_at, event.timezone)}</span>
          <span className="text-12">({zoneLabel(event.timezone)})</span>
        </span>
      }
      actions={
        <>
          {watchable ? (
            <Button
              variant="quiet"
              size="compact"
              onClick={() => {
                selectEvent(event.id);
                navigate("/");
              }}
            >
              <Radio size={14} strokeWidth={1.5} aria-hidden="true" />
              Watch in Command Center
            </Button>
          ) : null}
          {event.state === "closed" || event.state === "archived" ? (
            <Link to={`/events/${event.id}/summary`} className={buttonClass("secondary", "compact")}>
              Event summary
            </Link>
          ) : null}
          {event.state === "draft" ? (
            <Link to={`/events/new/${event.wizard_step}?draft=${event.id}`} className={buttonClass("primary", "compact")}>
              Continue setup
            </Link>
          ) : null}
        </>
      }
    />
  );
}
