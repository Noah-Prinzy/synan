/**
 * D6.3 · Rooms & rules `/events/:id/rooms` (docs/06 §2.3; docs/01 §4 P-04). Who may enter which
 * room: the tier × room matrix, edited locally against the published rules. Every change is
 * marked in the grid and listed in words; nothing reaches a gate until `Republish rules`.
 * Silently changing access mid-event is dangerous, so for a live event republishing first shows
 * the diff in a confirm dialog. If someone else republished meanwhile (CONFLICT), their rules
 * are loaded and the operator's changes are laid on top, still unsaved, to check and republish.
 * Beside the matrix: the rules version, the pending changes, and the rooms with their capacity.
 *
 * States: loading, error with retry, no rooms, editing (sticky change bar), conflict,
 * read-only for closed and archived events.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, Button, Dialog, buttonClass, cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import type { AccessRule } from "@synan/contracts/rest";
import type { RuleInput } from "@synan/mock/command";
import { RuleDiff, TierMatrix, diffRules, effectOf, setEffect, type MatrixRoom, type RuleChange } from "../events/parts/tier-matrix";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SPLIT,
  SectionHead,
  TYPE,
  errorCopy,
  formatStamp,
  linkClass,
  useDocumentTitle,
  useResource,
} from "../kit";
import { useCan } from "../access/session";
import { clock, configure } from "../live/backend";
import { useLeaveGuard } from "../venues/editor/use-leave-guard";
import { ReadOnlyNote, eventRooms, useWorkspaceEvent } from "./parts/context";
import { plural } from "./parts/copy";
import { HEAD_BLEED, RAIL_ROW, RAIL_X, RailNote } from "./parts/layout";

/** Each rail row is its own grid, so the columns are fixed widths to stay aligned row to row. */
const ROOM_COLUMNS = "grid-cols-[minmax(0,1fr)_6.5rem_4.5rem]";

const strip = (rules: AccessRule[]): RuleInput[] => rules.map(({ id: _id, event_id: _event, ...rule }) => rule);

/** Lay a list of cell changes over another rule set (used after a conflict). */
function applyChanges(rules: RuleInput[], changes: RuleChange[]): RuleInput[] {
  let next = rules;
  for (const change of changes) next = setEffect(next, change.tier, change.roomId, change.to === "permit" ? "permit" : "deny");
  return next;
}

export default function WorkspaceRoomsRules() {
  const { event, venue, readOnly, tabPrimary, reload: reloadEvent } = useWorkspaceEvent();
  useDocumentTitle(`Rooms & rules · ${event.title || "Untitled event"}`);
  const ruleSet = useResource(() => configure.accessRules(event.id), [event.id]);
  const canEditVenues = useCan()("venues.edit");

  const venueData = venue.status === "ready" ? venue.data : null;
  const rooms = useMemo(() => eventRooms(event, venueData), [event, venueData]);
  const zoneName = useMemo(() => new Map((venueData?.zones ?? []).map((z) => [z.id, z.name])), [venueData]);
  const matrixRooms = useMemo<MatrixRoom[]>(
    () => rooms.map((room) => ({ id: room.id, name: room.name, zone: zoneName.get(room.zone_id) ?? null, capacity: room.capacity })),
    [rooms, zoneName],
  );

  const [baseline, setBaseline] = useState<RuleInput[]>([]);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<RuleInput[]>([]);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The change bar stays a moment after republishing, so the reward check is seen.
  const [justPublished, setJustPublished] = useState(false);
  useEffect(() => {
    if (!justPublished) return;
    const timer = window.setTimeout(() => setJustPublished(false), 1800);
    return () => window.clearTimeout(timer);
  }, [justPublished]);

  // Load (and reload) the published set into the baseline and the draft.
  useEffect(() => {
    if (ruleSet.status !== "ready") return;
    const rules = strip(ruleSet.data.rules);
    setBaseline(rules);
    setDraft(rules);
    setVersion(ruleSet.data.version);
  }, [ruleSet.status, ruleSet.data]);

  const changes = useMemo(() => diffRules(baseline, draft, matrixRooms), [baseline, draft, matrixRooms]);
  const dirty = changes.length > 0;
  const guard = useLeaveGuard(dirty && !readOnly);
  const live = event.state === "live";
  const isDraft = event.state === "draft";
  const verb = isDraft ? "Save rules" : "Republish rules";

  const publish = async () => {
    setProblem(null);
    try {
      const result = await configure.putAccessRules(event.id, { expected_version: version, rules: draft });
      const rules = strip(result.rules);
      setBaseline(rules);
      setDraft(rules);
      setVersion(result.version);
      setPublishedAt(new Date(clock.now()).toISOString());
      setConflict(null);
      setJustPublished(true);
      reloadEvent(true);
      window.setTimeout(() => setConfirming(false), 600);
    } catch (error) {
      const copy = errorCopy(error);
      if (copy.code === "CONFLICT") {
        // Someone else republished: take theirs, keep this operator's intent on top of it.
        const mine = changes;
        try {
          const latest = await configure.accessRules(event.id);
          const theirs = strip(latest.rules);
          setBaseline(theirs);
          setDraft(applyChanges(theirs, mine));
          setVersion(latest.version);
          setConflict(latest.version);
        } catch {
          setProblem("Someone else changed the rules, and the new version could not be loaded. Reload the page.");
        }
        setConfirming(false);
      } else if (copy.code === "VALIDATION_FAILED" && copy.fields.rules) {
        setProblem(copy.fields.rules);
      } else {
        setProblem(`${copy.title}. ${copy.message}`);
      }
      throw error;
    }
  };

  if (ruleSet.status === "loading" || venue.status === "loading") return <LoadingState label="Loading rooms and rules…" rows={8} />;
  if (ruleSet.status === "error") return <ErrorState title="Could not load the access rules" error={ruleSet.error} onRetry={() => ruleSet.reload()} />;
  if (venue.status === "error") return <ErrorState title="Could not load the event's rooms" error={venue.error} onRetry={() => venue.reload()} />;

  if (rooms.length === 0) {
    return (
      <EmptyState
        title="No rooms yet"
        action={
          isDraft ? (
            <Link to={`/events/new/venue?draft=${event.id}`} className={buttonClass("secondary", "compact")}>
              Choose the venue and rooms
            </Link>
          ) : undefined
        }
      >
        Access is set per room and tier. Pick the venue and the rooms this event uses, then decide who may enter each one.
      </EmptyState>
    );
  }

  const permitted = matrixRooms.reduce((n, room) => n + (["VIP", "ORDINARY", "PRIVATE_INVITE", "PUBLIC"] as const).filter((t) => effectOf(baseline, t, room.id) === "permit").length, 0);
  const overrides = rooms.filter((room) => room.capacity_override !== null).length;

  return (
    <div className="flex min-h-full flex-col">
      {readOnly ? <ReadOnlyNote event={event} what="its access rules" /> : null}
      <div className={cn(SPLIT, "flex-1")}>
        <section aria-labelledby="rules-matrix" className="min-w-0">
          <SectionHead
            id="rules-matrix"
            title="Who may enter each room"
            meta={readOnly ? "as the event ran" : "select a cell to permit or deny"}
            className={HEAD_BLEED}
          />
          <div className="flex flex-col gap-4 px-4 py-6 sm:px-6 2xl:px-8">
            {conflict !== null ? (
              <Notice tone="warning">
                Someone else republished the rules (now version {conflict}) while you were editing. Their rules are loaded and your
                changes are laid on top, not yet saved. Check them, then {verb.toLowerCase()}.
              </Notice>
            ) : null}
            {live && !readOnly ? (
              <Notice>The event is live. Republished rules reach every gate within a minute, including people already inside.</Notice>
            ) : null}
            <TierMatrix
              rooms={matrixRooms}
              rules={draft}
              baseline={readOnly ? undefined : baseline}
              onChange={readOnly ? undefined : setDraft}
              disabled={readOnly}
              caption="Tier × room"
            />
            <p className="max-w-[68ch] text-12 leading-relaxed text-muted-foreground">
              A pass is admitted only where its tier is permitted; no rule means refused. Changes reach the gates only when the rules
              are {isDraft ? "saved" : "republished"}. Speakers and crew are staff: their access is granted per person, not here.
            </p>
          </div>
        </section>

        <aside className="min-w-0 border-t border-border lg:border-t-0 lg:border-l">
          <section aria-labelledby="rules-version">
            <SectionHead id="rules-version" title="Rules" meta={dirty ? `${changes.length} unsaved ${plural(changes.length, "change")}` : "published"} />
            <div className={cn("py-4 text-13", RAIL_X)}>
              {version === 0 ? (
                <p className="text-muted-foreground">Not published yet. The rules go out with the event when it is published.</p>
              ) : (
                <>
                  <p>
                    Version <span className={TYPE.value}>{version}</span>
                    {publishedAt ? (
                      <span className="text-muted-foreground">
                        , republished <span className="font-mono tabular-nums">{formatStamp(publishedAt, event.timezone)}</span>
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-12 leading-relaxed text-muted-foreground">
                    <span className="font-mono tabular-nums">{formatNumber(permitted)}</span> of{" "}
                    <span className="font-mono tabular-nums">{formatNumber(matrixRooms.length * 4)}</span> cells permit entry. Gates compare
                    this version with their offline allowlist.
                  </p>
                </>
              )}
            </div>
            {dirty ? (
              <div className={cn("border-t border-border pt-3 pb-4", RAIL_X)}>
                <h3 className="pb-2 text-12 font-medium">What changes at the door</h3>
                <RuleDiff changes={changes} limit={12} />
              </div>
            ) : null}
          </section>
          <section aria-labelledby="rules-rooms" className="border-t border-border">
            <SectionHead id="rules-rooms" title="Rooms" meta="capacity for this event" />
            <div role="table" aria-label="Rooms and capacity">
              <div role="row" className={cn("grid min-h-9 items-center gap-3 border-b border-border text-12 text-muted-foreground", RAIL_X, ROOM_COLUMNS)}>
                <span role="columnheader">Room</span>
                <span role="columnheader">Zone</span>
                <span role="columnheader" className="text-right">
                  Capacity
                </span>
              </div>
              {rooms.map((room) => (
                <div key={room.id} role="row" className={cn(RAIL_ROW, ROOM_COLUMNS, "border-b border-border last:border-b-0")}>
                  <span role="cell" className="truncate">
                    {room.name}
                  </span>
                  <span role="cell" className="truncate text-muted-foreground">
                    {zoneName.get(room.zone_id) ?? "—"}
                  </span>
                  <span role="cell" className="text-right whitespace-nowrap">
                    <span className={TYPE.value}>{formatNumber(room.capacity)}</span>
                    {room.capacity_override !== null ? (
                      <span className="block text-12 text-muted-foreground" title={`Venue capacity ${room.venue_capacity}`}>
                        venue <span className="font-mono tabular-nums">{formatNumber(room.venue_capacity)}</span>
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            <RailNote>
              {overrides > 0 ? `${overrides} ${plural(overrides, "room")} overridden for this event. ` : ""}
              Change capacity for this event in{" "}
              <Link to={`/events/${event.id}/settings`} className={linkClass}>
                Settings
              </Link>
              ; the rooms themselves are drawn in the{" "}
              {event.venue_id && canEditVenues ? (
                <Link to={`/venues/${event.venue_id}`} className={linkClass}>
                  venue editor
                </Link>
              ) : (
                "venue editor"
              )}
              .
            </RailNote>
          </section>
        </aside>
      </div>

      {!readOnly && (dirty || problem || justPublished) ? (
        <div role="region" aria-label="Unsaved rule changes" className="sticky bottom-0 z-10 border-t border-border bg-background">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 2xl:px-8">
            <p className="flex items-center gap-2 text-13">
              <span aria-hidden="true" className="size-1.5 bg-brand" />
              {dirty ? (
                <span>
                  <span className="font-mono tabular-nums">{formatNumber(changes.length)}</span> {plural(changes.length, "change")} not yet{" "}
                  {isDraft ? "saved" : "republished"}
                </span>
              ) : justPublished ? (
                <span role="status">
                  Rules <span className="font-mono tabular-nums">v{version}</span> {isDraft ? "saved" : "republished"}
                  {isDraft ? "" : ". Gates pick them up within a minute."}
                </span>
              ) : null}
              {problem ? <span className="text-destructive">· {problem}</span> : null}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  setDraft(baseline);
                  setProblem(null);
                  setConflict(null);
                }}
                disabled={!dirty}
              >
                Discard
              </Button>
              {live ? (
                <Button variant={tabPrimary ? "primary" : "secondary"} size="compact" onClick={() => setConfirming(true)} disabled={!dirty}>
                  {verb}…
                </Button>
              ) : (
                <ActionButton
                  action={publish}
                  doneLabel={isDraft ? "Saved" : "Republished"}
                  reward
                  variant={tabPrimary ? "primary" : "quiet"}
                  size="compact"
                  disabled={!dirty}
                >
                  {verb}
                </ActionButton>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        tone="danger"
        title="Change access during a live event?"
        description="Gates pick up the new rules within a minute. People already inside a room are not removed, but their next scan follows the new rules."
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <ActionButton action={publish} doneLabel="Republished" reward variant="primary" size="compact">
              Republish rules
            </ActionButton>
          </>
        }
      >
        <div className="px-5 py-4">
          <p className="mb-2 text-12 text-muted-foreground">
            <span className="font-mono tabular-nums">{formatNumber(changes.length)}</span> {plural(changes.length, "change")}, from
            version <span className="font-mono tabular-nums">{version}</span> to{" "}
            <span className="font-mono tabular-nums">{version + 1}</span>:
          </p>
          <RuleDiff changes={changes} />
          {problem ? <Notice tone="danger" className="mt-3">{problem}</Notice> : null}
        </div>
      </Dialog>

      <Dialog
        open={guard.pending !== null}
        onClose={guard.stay}
        title={`Leave without ${isDraft ? "saving" : "republishing"}?`}
        description={`${changes.length} ${plural(changes.length, "change")} to the rules will be lost. Gates keep the rules as they are.`}
        width="sm"
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={guard.leave}>
              Leave
            </Button>
            <Button variant="primary" size="compact" onClick={guard.stay}>
              Stay
            </Button>
          </>
        }
      />
    </div>
  );
}
