/**
 * D3 · Spatial editor `/venues/:id` (docs/06 §2.3). The venue drawn on its abstract grid: zones
 * listed by floor on the left, the canvas in the middle, the selected zone or room in a sheet on
 * the right. The only screen with a drawing mode: an explicit Edit layout toggle keeps the canvas
 * inert day to day. Every change is a local draft (floors, zones, rooms) until Publish layout,
 * which shows a plain-words summary of what changed first and is checked against the version the
 * draft started from, so two people cannot silently overwrite each other.
 *
 * `?edit=1` opens in edit mode (D2b lands here after creating a venue). Leaving with an
 * unpublished draft asks first. Below 768px the layout can be inspected but not drawn.
 *
 * States: loading, error with retry (and not found), nothing drawn yet, inspecting, editing,
 * draft with changes, publishing, conflict, refused by the server.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Button, cn } from "@synan/ui/components";
import type { VenueDetail } from "@synan/mock/command";
import {
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
  errorCode,
  errorCopy,
  fieldErrors,
  formatDate,
  linkClass,
  useDocumentTitle,
  useResource,
  zoneLabel,
} from "../../kit";
import { configure } from "../../live/backend";
import { LayoutCanvas, describeRect, type CanvasCommands } from "./canvas";
import { ConfirmDialog, PublishDialog } from "./dialogs";
import { Inspector, type InspectorCommands } from "./inspector";
import {
  changeMarks,
  diffLayouts,
  findSpot,
  issuesFor,
  issuesOf,
  layoutOf,
  nameOf,
  newId,
  nextName,
  orderZones,
  publishBody,
  rectOf,
  roomBlocked,
  roundRect,
  spotForRoom,
  withZoneRect,
  zoneBlocked,
  type DraftRoom,
  type DraftZone,
  type Issue,
  type Layout,
  type Rect,
  type Selection,
} from "./model";
import { useLeaveGuard } from "./use-leave-guard";
import { ZoneList, type ZoneListCommands } from "./zone-list";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const backLink = (
  <Link to="/venues" className={linkClass}>
    Venues
  </Link>
);

export default function VenueEditor() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const venue = useResource(() => configure.venue(id), [id]);
  const canDraw = useMediaQuery("(min-width: 48rem)");
  const [editing, setEditing] = useState(search.get("edit") === "1");
  useDocumentTitle(venue.status === "ready" ? `${venue.data.venue.name} · Layout` : "Spatial editor");

  if (venue.status === "loading") {
    return (
      <div>
        <PageHeader code="D3" back={backLink} title="Spatial editor" />
        <LoadingState label="Loading the venue and its layout…" />
      </div>
    );
  }
  if (venue.status === "error") {
    const notFound = errorCode(venue.error) === "NOT_FOUND";
    return (
      <div>
        <PageHeader code="D3" back={backLink} title="Spatial editor" />
        <ErrorState
          title={notFound ? "This venue was not found" : "Could not load the venue"}
          error={venue.error}
          onRetry={notFound ? undefined : () => venue.reload()}
        />
      </div>
    );
  }

  const created = (location.state as { created?: string } | null)?.created ?? null;
  return (
    <Editor
      key={`${venue.data.venue.id}:${venue.data.layout_version}`}
      initial={venue.data}
      editing={editing && canDraw}
      canDraw={canDraw}
      onEditing={setEditing}
      created={created}
      onReload={() => venue.reload()}
    />
  );
}

/* ------------------------------------------------------------------ editor */

type Confirm = { type: "delete"; target: NonNullable<Selection> } | { type: "discard" } | null;

function Editor({
  initial,
  editing,
  canDraw,
  onEditing,
  created,
  onReload,
}: {
  initial: VenueDetail;
  editing: boolean;
  canDraw: boolean;
  onEditing: (on: boolean) => void;
  created: string | null;
  onReload: () => void;
}) {
  const [detail, setDetail] = useState(initial);
  const [published, setPublished] = useState<Layout>(() => layoutOf(initial));
  const [draft, setDraft] = useState<Layout>(published);
  const [rawSelection, setSelection] = useState<Selection>(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [justPublished, setJustPublished] = useState<number | null>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const closeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const changes = useMemo(() => diffLayouts(published, draft), [published, draft]);
  const issues = useMemo(() => [...issuesOf(draft), ...serverIssues], [draft, serverIssues]);
  const invalid = useMemo(() => new Set(issues.map((i) => i.id)), [issues]);
  const marks = useMemo(() => changeMarks(changes), [changes]);
  const dirty = changes.length > 0;
  const guard = useLeaveGuard(dirty);

  // A selection whose item was deleted (or discarded) is simply no selection.
  const selection: Selection =
    rawSelection && (rawSelection.kind === "zone" ? draft.zones : draft.rooms).some((item) => item.id === rawSelection.id) ? rawSelection : null;

  const liveEvents = detail.events.filter((e) => e.state === "live").map((e) => e.title);
  const say = useCallback((text: string) => setMessage(text), []);
  const update = (fn: (layout: Layout) => Layout) => {
    setDraft(fn);
    setJustPublished(null);
    if (serverIssues.length) setServerIssues([]);
  };

  // Once everything is fixed, the issue list goes away by itself.
  useEffect(() => {
    if (showIssues && issues.length === 0) setShowIssues(false);
  }, [showIssues, issues.length]);

  const focusCanvas = () => window.requestAnimationFrame(() => canvasBox.current?.querySelector<HTMLElement>("[role=application]")?.focus());

  /* ------------------------------------------------------------- commands */

  const select = (next: Selection) => setSelection(next);

  const floorForNewZone = (): string => {
    const zoneId = selection?.kind === "zone" ? selection.id : selection?.kind === "room" ? draft.rooms.find((r) => r.id === selection.id)?.zoneId : null;
    return draft.zones.find((z) => z.id === zoneId)?.floorId ?? (draft.floors[0]?.id as string);
  };

  const addZoneAt = (rect: Rect) => {
    const zone: DraftZone = { id: newId(), name: nextName("Zone", draft.zones.map((z) => z.name)), floorId: floorForNewZone(), rect };
    update((l) => ({ ...l, zones: orderZones(l.floors, [...l.zones, zone]) }));
    setSelection({ kind: "zone", id: zone.id });
    const floor = draft.floors.find((f) => f.id === zone.floorId)?.name ?? "";
    say(`${zone.name} drawn on ${floor}, ${rect.w} × ${rect.h}. Name it in the panel; draw rooms inside it.`);
  };

  const addRoomAt = (zoneId: string, rect: Rect) => {
    const zone = draft.zones.find((z) => z.id === zoneId);
    const room: DraftRoom = {
      id: newId(),
      zoneId,
      name: nextName("Room", draft.rooms.map((r) => r.name)),
      capacity: String(detail.capacity_default ?? 50),
      warn: "85",
      stop: "100",
      continuous: false,
      policy: "block",
      rect,
    };
    update((l) => ({ ...l, rooms: [...l.rooms, room] }));
    setSelection({ kind: "room", id: room.id });
    say(`${room.name} drawn in ${zone?.name ?? "the zone"}, ${rect.w} × ${rect.h}, capacity ${room.capacity}. Set its details in the panel.`);
  };

  const canvasCommands: CanvasCommands = {
    onSelect: (next) => {
      select(next);
      if (next) say(`Selected ${nameOf(draft, next)}.`);
    },
    onDrawZone: addZoneAt,
    onDrawRoom: addRoomAt,
    onPlace: (target, rect, mode) => {
      if (target.kind === "room") update((l) => ({ ...l, rooms: l.rooms.map((r) => (r.id === target.id ? { ...r, rect } : r)) }));
      else update((l) => withZoneRect(l, target.id, rect, mode === "move"));
      say(`${nameOf(draft, target)} ${mode === "move" ? "moved" : "resized"}, now ${describeRect(rect)}.`);
    },
    onNudge: (dx, dy, resize) => {
      if (!selection) {
        say("Select a zone or room first: click it, or choose it in the list.");
        return;
      }
      const from = rectOf(draft, selection);
      if (!from) return;
      const rect = resize ? { ...from, w: from.w + dx, h: from.h + dy } : { ...from, x: from.x + dx, y: from.y + dy };
      let blocked: string | null;
      if (selection.kind === "room") {
        const room = draft.rooms.find((r) => r.id === selection.id);
        blocked = room ? roomBlocked(draft, room.id, room.zoneId, rect) : null;
      } else blocked = zoneBlocked(draft, selection.id, rect, detail.grid, !resize);
      if (blocked) {
        say(blocked);
        return;
      }
      canvasCommands.onPlace(selection, rect, resize ? "resize" : "move");
    },
    onDelete: () => {
      if (selection) setConfirm({ type: "delete", target: selection });
      else say("Select a zone or room to delete.");
    },
    announce: say,
  };

  const zoneCommands: ZoneListCommands = {
    onSelect: select,
    onAddZone: () => {
      const taken = draft.zones.map((z) => z.rect);
      const area = { x: 0, y: 0, w: detail.grid.w, h: detail.grid.h };
      const spot = findSpot(area, 20, 14, taken) ?? findSpot(area, 12, 8, taken) ?? findSpot(area, 6, 4, taken);
      if (!spot) {
        say("There is no free space on the grid for another zone. Shrink or move a zone first.");
        return;
      }
      addZoneAt(spot);
      focusCanvas();
    },
    onRenameZone: (zoneId, name) => {
      update((l) => ({ ...l, zones: l.zones.map((z) => (z.id === zoneId ? { ...z, name } : z)) }));
      say(`Zone renamed to ${name}.`);
    },
    onMoveZone: (zoneId, by) => {
      const ordered = orderZones(draft.floors, draft.zones);
      const zone = ordered.find((z) => z.id === zoneId);
      if (!zone) return;
      const siblings = ordered.filter((z) => z.floorId === zone.floorId);
      const at = siblings.indexOf(zone);
      const neighbour = siblings[at + by];
      let next: DraftZone[];
      let words: string;
      if (neighbour) {
        next = [...ordered];
        const i = next.indexOf(zone);
        const j = next.indexOf(neighbour);
        next[i] = neighbour;
        next[j] = zone;
        words = `${zone.name} moved ${by < 0 ? "up" : "down"}.`;
      } else {
        const floorIndex = draft.floors.findIndex((f) => f.id === zone.floorId);
        const floor = draft.floors[floorIndex + by];
        if (!floor) return;
        const moved = { ...zone, floorId: floor.id };
        const rest = ordered.filter((z) => z.id !== zoneId);
        // Up: last on the floor above. Down: first on the floor below.
        next = by < 0 ? [...rest, moved] : [moved, ...rest];
        words = `${zone.name} moved to ${floor.name}.`;
      }
      update((l) => ({ ...l, zones: orderZones(l.floors, next) }));
      say(words);
    },
    onDeleteZone: (zoneId) => setConfirm({ type: "delete", target: { kind: "zone", id: zoneId } }),
    onAddFloor: () => {
      const floor = { id: newId(), name: nextName("Level", draft.floors.map((f) => f.name)) };
      update((l) => ({ ...l, floors: [...l.floors, floor] }));
      say(`${floor.name} added. Type its name.`);
      return floor.id;
    },
    onRenameFloor: (floorId, name) => update((l) => ({ ...l, floors: l.floors.map((f) => (f.id === floorId ? { ...f, name } : f)) })),
    onRemoveFloor: (floorId) => {
      const floor = draft.floors.find((f) => f.id === floorId);
      update((l) => ({ ...l, floors: l.floors.filter((f) => f.id !== floorId) }));
      say(`${floor?.name ?? "Floor"} removed.`);
    },
  };

  const inspectorCommands: InspectorCommands = {
    onRoom: (roomId, patch) => update((l) => ({ ...l, rooms: l.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) })),
    onZone: (zoneId, patch) =>
      update((l) => ({ ...l, zones: orderZones(l.floors, l.zones.map((z) => (z.id === zoneId ? { ...z, ...patch } : z))) })),
    onRoomZone: (roomId, zoneId) => {
      const room = draft.rooms.find((r) => r.id === roomId);
      const zone = draft.zones.find((z) => z.id === zoneId);
      if (!room || !zone) return;
      const others = draft.rooms.filter((r) => r.zoneId === zoneId).map((r) => r.rect);
      const r = roundRect(room.rect);
      const spot = spotForRoom(zone.rect, others, { w: r.w, h: r.h });
      if (!spot) {
        say(`${room.name} does not fit in ${zone.name}. Make space there first.`);
        return;
      }
      update((l) => ({ ...l, rooms: l.rooms.map((x) => (x.id === roomId ? { ...x, zoneId, rect: spot } : x)) }));
      say(`${room.name} moved to ${zone.name}${spot.w !== r.w || spot.h !== r.h ? `, made ${spot.w} × ${spot.h} to fit` : ""}.`);
    },
    onAddRoom: (zoneId) => {
      const zone = draft.zones.find((z) => z.id === zoneId);
      if (!zone) return;
      const spot = spotForRoom(zone.rect, draft.rooms.filter((r) => r.zoneId === zoneId).map((r) => r.rect), { w: 8, h: 6 });
      if (!spot) {
        say(`${zone.name} has no free space for another room. Enlarge the zone or move a room.`);
        return;
      }
      addRoomAt(zoneId, spot);
    },
    onDelete: (target) => setConfirm({ type: "delete", target }),
    onSelect: select,
  };

  /* ------------------------------------------------------------ delete, discard */

  const confirmDelete = (target: NonNullable<Selection>) => {
    const name = nameOf(draft, target);
    if (target.kind === "zone") {
      update((l) => ({ ...l, zones: l.zones.filter((z) => z.id !== target.id), rooms: l.rooms.filter((r) => r.zoneId !== target.id) }));
      setSelection(null);
    } else {
      const zoneId = draft.rooms.find((r) => r.id === target.id)?.zoneId;
      update((l) => ({ ...l, rooms: l.rooms.filter((r) => r.id !== target.id) }));
      setSelection(zoneId ? { kind: "zone", id: zoneId } : null);
    }
    setConfirm(null);
    say(`${name} deleted from the draft. Nothing changes for attendees until you publish.`);
    focusCanvas();
  };

  const discard = () => {
    setDraft(published);
    setServerIssues([]);
    setShowIssues(false);
    setConfirm(null);
    say(detail.layout_version > 0 ? `Draft discarded. Back to version ${detail.layout_version}.` : "Draft discarded.");
  };

  /* --------------------------------------------------------------- publish */

  const firstIssueSelection = (list: Issue[]): Selection => {
    for (const issue of list) {
      if (issue.kind === "zone" || issue.kind === "room") return { kind: issue.kind, id: issue.id };
    }
    return null;
  };

  const startPublish = () => {
    setProblem(null);
    if (issues.length > 0) {
      setShowIssues(true);
      const first = firstIssueSelection(issues);
      if (first) setSelection(first);
      say(`Fix ${issues.length} ${issues.length === 1 ? "thing" : "things"} before publishing. The first is selected.`);
      return;
    }
    setPublishOpen(true);
  };

  const publish = async () => {
    setProblem(null);
    try {
      const result = await configure.publishLayout(detail.venue.id, publishBody(draft, detail.layout_version));
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        const next = layoutOf(result);
        setDetail(result);
        setPublished(next);
        setDraft(next);
        setPublishOpen(false);
        setJustPublished(result.layout_version);
        say(`Layout published. ${result.venue.name} is on version ${result.layout_version}.`);
      }, 900);
    } catch (error) {
      const code = errorCode(error);
      if (code === "CONFLICT") {
        setProblem(
          <Notice tone="danger">
            <span>
              Someone else published a new layout for this venue while you were editing. Reload to see theirs; your draft here will be
              dropped.{" "}
              <button type="button" onClick={onReload} className="font-medium underline underline-offset-4">
                Reload layout
              </button>
            </span>
          </Notice>,
        );
      } else if (code === "VALIDATION_FAILED") {
        const found: Issue[] = Object.entries(fieldErrors(error)).map(([key, text]) =>
          key.startsWith("room:")
            ? { kind: "room", id: key.slice(5), field: "server", message: text }
            : key.startsWith("zone:")
              ? { kind: "zone", id: key.slice(5), field: "server", message: text }
              : { kind: "layout", id: "layout", field: key, message: text },
        );
        setServerIssues(found);
        setShowIssues(true);
        setPublishOpen(false);
        const first = firstIssueSelection(found);
        if (first) setSelection(first);
        say(`The layout was not published: ${found.length} ${found.length === 1 ? "thing needs" : "things need"} fixing.`);
      } else {
        const copy = errorCopy(error);
        setProblem(<Notice tone="danger">{`${copy.title}. ${copy.message}`}</Notice>);
      }
      throw error;
    }
  };

  /* ----------------------------------------------------------------- render */

  const empty = draft.zones.length === 0;
  const selectedErrors = selection ? issuesFor(issues, selection.id) : {};
  const v = detail.venue;
  const canvasLabel = `${v.name} layout: ${draft.zones.length} zones, ${draft.rooms.length} rooms. ${editing ? "Editing." : "Inspecting."} ${
    selection ? `Selected ${nameOf(draft, selection)}, ${selection.kind}, ${describeRect(rectOf(draft, selection) ?? { x: 0, y: 0, w: 0, h: 0 })}.` : "Nothing selected."
  }`;

  const notices: ReactNode[] = [];
  if (created && empty) {
    notices.push(
      <Notice key="created">
        {created} is created. Draw its first zone to begin: drag on the grid, or use Add zone in the list.
      </Notice>,
    );
  }
  if (liveEvents.length > 0 && (editing || dirty)) {
    notices.push(
      <Notice key="live" tone="warning">
        {liveEvents.join(", ")} {liveEvents.length === 1 ? "is" : "are"} live at this venue. Publishing changes the rooms gate staff and attendees
        are using right now.
      </Notice>,
    );
  }
  if (showIssues && issues.length > 0) {
    notices.push(<IssueList key="issues" issues={issues} draft={draft} onSelect={setSelection} />);
  }

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:min-h-[40rem]">
      <PageHeader
        code="D3"
        back={backLink}
        title={v.name}
        meta={
          <>
            {v.city && !zoneLabel(v.timezone).startsWith(v.city) ? `${v.city} · ` : ""}
            {zoneLabel(v.timezone)} ·{" "}
            {detail.layout_published_at ? (
              <>
                Layout <span className="font-mono tabular-nums">v{detail.layout_version}</span>, published{" "}
                <span className="font-mono tabular-nums">{formatDate(detail.layout_published_at, v.timezone)}</span>
              </>
            ) : (
              "No layout published yet"
            )}
          </>
        }
        actions={
          <>
            <span className="text-12 text-muted-foreground">
              {dirty ? (
                <>
                  Draft · <span className="font-mono text-foreground tabular-nums">{changes.length}</span> {changes.length === 1 ? "change" : "changes"}
                </>
              ) : justPublished !== null ? (
                <>Published as v{justPublished}</>
              ) : null}
            </span>
            {dirty ? (
              <Button size="compact" variant="quiet" onClick={() => setConfirm({ type: "discard" })}>
                Discard draft
              </Button>
            ) : null}
            <Button
              size="compact"
              variant="secondary"
              aria-pressed={editing}
              disabled={!canDraw}
              title={canDraw ? undefined : "Drawing needs a wider screen"}
              onClick={() => {
                onEditing(!editing);
                say(editing ? "Edit mode off. The canvas is inert." : "Edit mode on. Drag on the grid to draw.");
              }}
              className={cn(editing && "border-brand")}
            >
              <Pencil size={14} strokeWidth={1.5} aria-hidden="true" className={editing ? "text-brand" : undefined} />
              Edit layout
            </Button>
            <Button size="compact" variant="primary" disabled={!dirty} onClick={startPublish}>
              Publish layout
            </Button>
          </>
        }
      />

      {notices.length > 0 ? <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:px-6">{notices}</div> : null}

      <div className="grid flex-1 grid-cols-1 md:grid-cols-2 lg:min-h-0 lg:grid-cols-[13.75rem_minmax(0,1fr)_17.5rem] xl:grid-cols-[15rem_minmax(0,1fr)_18.75rem]">
        <section aria-label="Zones and rooms" className="order-2 max-h-[28rem] min-h-0 border-t border-border md:border-r lg:order-1 lg:max-h-none lg:border-t-0">
          <ZoneList layout={draft} selection={selection} editing={editing} invalid={invalid} marks={marks} commands={zoneCommands} />
        </section>

        <section aria-label="Layout" className="order-1 flex min-w-0 flex-col md:col-span-2 lg:order-2 lg:col-span-1 lg:min-h-0 lg:border-r lg:border-border">
          <header className="flex min-h-8 items-center justify-between gap-3 border-b border-border px-4">
            <h2 className="py-1.5 text-12 font-medium">
              {editing ? (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-1.5 bg-brand" /> Editing
                </span>
              ) : (
                "Layout"
              )}
            </h2>
            <span className="text-11 text-muted-foreground">
              Grid <span className="font-mono tabular-nums">{detail.grid.w} × {detail.grid.h}</span>
              {draft.floors.length > 1 ? ` · ${draft.floors.length} floors shown together` : ""}
            </span>
          </header>
          <div
            ref={canvasBox}
            className="relative aspect-(--grid-aspect) w-full lg:aspect-auto lg:min-h-0 lg:flex-1"
            style={{ ["--grid-aspect" as string]: `${detail.grid.w} / ${detail.grid.h}` }}
          >
            <LayoutCanvas
              layout={draft}
              grid={detail.grid}
              selection={selection}
              editing={editing}
              invalid={invalid}
              label={canvasLabel}
              hintId={hintId}
              commands={canvasCommands}
            >
              {empty ? (
                <EmptyOverlay
                  editing={editing}
                  canDraw={canDraw}
                  venueName={v.name}
                  onStart={() => {
                    onEditing(true);
                    say("Edit mode on. Drag on the grid to draw the first zone.");
                    focusCanvas();
                  }}
                />
              ) : null}
            </LayoutCanvas>
          </div>
          <footer className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-12 text-muted-foreground">
            <p id={hintId} className="max-w-160">
              {!canDraw
                ? "Tap a zone or room to inspect it. Drawing needs a wider screen."
                : editing
                  ? "Drag on empty grid for a zone, inside a zone for a room. Drag a room, or a zone by its label, to move it; the blue corner resizes. Keys: arrows move the selection, Shift+arrows resize, Delete removes, Escape clears."
                  : "Click a zone or room to inspect it; arrow keys step between rooms. Turn on Edit layout to draw."}
            </p>
            <p role="status" aria-live="polite" className="min-h-4 text-foreground/80">
              {message}
            </p>
          </footer>
        </section>

        <section aria-label="Details" className="order-3 min-h-0 border-t border-border lg:border-t-0">
          <Inspector layout={draft} detail={detail} selection={selection} editing={editing} errors={selectedErrors} commands={inspectorCommands} />
        </section>
      </div>

      <PublishDialog
        open={publishOpen}
        onClose={() => {
          if (closeTimer.current !== null) return; // publishing has finished; it closes itself
          setPublishOpen(false);
          setProblem(null);
        }}
        changes={changes}
        version={detail.layout_version}
        liveEvents={liveEvents}
        problem={problem}
        onPublish={publish}
        onPick={(change) => {
          setPublishOpen(false);
          if (change.select) setSelection(change.select);
        }}
      />

      <ConfirmDialog
        open={confirm?.type === "delete"}
        onClose={() => setConfirm(null)}
        title={confirm?.type === "delete" ? `Delete ${nameOf(draft, confirm.target)}?` : ""}
        description={
          confirm?.type === "delete"
            ? confirm.target.kind === "zone"
              ? deleteZoneWords(draft, confirm.target.id)
              : "Events that use this room lose it when you publish. Until then it is only gone from the draft."
            : undefined
        }
        confirmLabel={confirm?.type === "delete" ? `Delete ${confirm.target.kind}` : "Delete"}
        onConfirm={() => confirm?.type === "delete" && confirmDelete(confirm.target)}
      />

      <ConfirmDialog
        open={confirm?.type === "discard"}
        onClose={() => setConfirm(null)}
        title={`Discard ${changes.length} ${changes.length === 1 ? "change" : "changes"}?`}
        description={
          detail.layout_version > 0
            ? `The layout goes back to the published version ${detail.layout_version}. This cannot be undone.`
            : "The layout goes back to empty. This cannot be undone."
        }
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        onConfirm={discard}
      />

      <ConfirmDialog
        open={guard.pending !== null}
        onClose={guard.stay}
        title="Leave without publishing?"
        description={`You have ${changes.length} unpublished ${changes.length === 1 ? "change" : "changes"} to this layout. They are lost if you leave.`}
        cancelLabel="Stay"
        confirmLabel="Leave without publishing"
        onConfirm={guard.leave}
      />
    </div>
  );
}

function deleteZoneWords(layout: Layout, zoneId: string): string {
  const n = layout.rooms.filter((r) => r.zoneId === zoneId).length;
  const rooms = n === 0 ? "It has no rooms." : `Its ${n} ${n === 1 ? "room is" : "rooms are"} deleted with it.`;
  return `${rooms} Nothing changes for attendees until you publish.`;
}

/* ------------------------------------------------------------------ parts */

function IssueList({ issues, draft, onSelect }: { issues: Issue[]; draft: Layout; onSelect: (selection: Selection) => void }) {
  return (
    <div role="alert" className="border border-destructive/40 px-3 py-2 text-12">
      <p className="text-destructive">Fix {issues.length === 1 ? "this" : `these ${issues.length}`} before publishing:</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {issues.map((issue, index) => {
          const target: Selection = issue.kind === "zone" || issue.kind === "room" ? { kind: issue.kind, id: issue.id } : null;
          const name = target ? nameOf(draft, target) : issue.kind === "floor" ? "Floors" : "Layout";
          return (
            <li key={`${issue.id}:${issue.field}:${index}`} className="text-muted-foreground">
              {target ? (
                <button type="button" onClick={() => onSelect(target)} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-brand">
                  {name}
                </button>
              ) : (
                <span className="font-medium text-foreground">{name}</span>
              )}
              : {issue.message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyOverlay({ editing, canDraw, venueName, onStart }: { editing: boolean; canDraw: boolean; venueName: string; onStart: () => void }) {
  if (editing) {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
        <div>
          <p className="font-display text-21 leading-tight text-foreground/80">Drag anywhere on the grid to draw the first zone</p>
          <p className="mt-2 text-13 text-muted-foreground">Or use Add zone in the list, then move it with the arrow keys.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 grid place-items-center p-4">
      <div className="max-w-104 border border-border bg-background px-5 py-4">
        <h2 className="font-display text-21 leading-tight">Nothing drawn yet</h2>
        <p className="mt-2 text-13 leading-relaxed text-muted-foreground">
          Start with the zones: the large areas of {venueName}, such as a hall, a wing or a garden. Then draw rooms inside them, each with its own
          capacity. Nothing is visible to attendees until you publish.
        </p>
        <div className="mt-4">
          {canDraw ? (
            <Button size="compact" variant="secondary" onClick={onStart}>
              <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
              Start drawing
            </Button>
          ) : (
            <p className="text-12 text-muted-foreground">Drawing needs a wider screen. Open this venue on a tablet or computer.</p>
          )}
        </div>
      </div>
    </div>
  );
}
