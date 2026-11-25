/**
 * D5 step 5 · Review and guarded publish (P-13). A summary of every step with an Edit link,
 * the readiness checklist from the server, and Publish event, which stays disabled while any
 * blocking requirement is unmet and lists what is missing beside it. Publishing opens
 * registration: the page answers with the reward and the ways on. A draft can be deleted here.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { EventRecord, ReadinessItem, RuleInput, VenueDetail, WizardStep } from "@synan/mock/command";
import { ActionButton, Button, Dialog, RewardMoment, buttonClass } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import { ErrorState, GUTTER_X, KeyValues, LoadingState, Notice, Panel, TIER_LABEL, TIER_ORDER, errorCode, errorCopy, formatDate, formatTime, linkClass, useResource, zoneLabel } from "../../kit";
import { configure } from "../../live/backend";
import { useCommand } from "../../live/context";
import { ReadinessChecklist, readinessSummary } from "../parts/readiness-checklist";
import { effectOf } from "../parts/tier-matrix";
import { STEP_LABEL, matrixRooms, toRuleInput, type StepContext } from "./shared";

interface Loaded {
  readiness: ReadinessItem[];
  rules: RuleInput[];
  venue: VenueDetail | null;
}

function when(iso: string | null, timeZone: string): ReactNode {
  if (!iso) return <span className="text-muted-foreground">Not set</span>;
  return (
    <span className="font-mono text-12 tabular-nums">
      {formatDate(iso, timeZone, { weekday: true })}, {formatTime(iso, timeZone)}
    </span>
  );
}

function EditLink({ step, onEdit }: { step: WizardStep; onEdit: (step: WizardStep) => void }) {
  return (
    <button type="button" onClick={() => onEdit(step)} className={`${linkClass} text-12`}>
      Edit<span className="sr-only"> {STEP_LABEL[step]}</span>
    </button>
  );
}

export function ReviewStep({ record, goto, close, onPublished }: StepContext & { record: EventRecord }) {
  const navigate = useNavigate();
  const { refreshEvents } = useCommand();
  const [published, setPublished] = useState<EventRecord | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);

  const loaded = useResource<Loaded>(async () => {
    const [readiness, set, venue] = await Promise.all([
      configure.readiness(record.id),
      configure.accessRules(record.id),
      record.venue_id ? configure.venue(record.venue_id) : Promise.resolve(null),
    ]);
    return { readiness, rules: set.rules.map(toRuleInput), venue };
  }, [record.id]);

  const refreshReadiness = async () => {
    const readiness = await configure.readiness(record.id);
    loaded.set((current) => ({ ...current, readiness }));
  };

  const publish = async () => {
    setProblem(null);
    try {
      const result = await configure.publishEvent(record.id);
      await refreshEvents().catch(() => undefined);
      setPublished(result);
      onPublished(result);
    } catch (error) {
      const code = errorCode(error);
      if (code === "VALIDATION_FAILED") {
        await refreshReadiness().catch(() => undefined);
        setProblem("Something still needs doing. The checklist is up to date: fix what it marks, then publish.");
      } else if (code === "CONFLICT") {
        setProblem("This event is no longer a draft. It may have been published from another screen.");
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
      }
      throw error;
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteProblem(null);
    try {
      await configure.deleteDraft(record.id);
      navigate("/events", { state: { deletedDraft: record.title || "Untitled draft" } });
    } catch (error) {
      const copy = errorCopy(error);
      setDeleteProblem(`${copy.title}. ${copy.message}`);
      setDeleting(false);
    }
  };

  if (loaded.status === "loading") return <LoadingState label="Checking the event…" rows={6} />;
  if (loaded.status === "error") return <ErrorState title="Could not check the event" error={loaded.error} onRetry={() => loaded.reload()} />;

  const { readiness, rules, venue } = loaded.data;
  const rooms = venue ? matrixRooms(venue, record.rooms) : [];
  const summary = readinessSummary(readiness);
  const unmet = readiness.filter((item) => item.blocking && !item.met);
  const tz = record.timezone;

  if (published) {
    return (
      <div className={`py-8 ${GUTTER_X}`}>
        <div className="max-w-160 px-5 py-5">
          <p role="status" className="font-display text-21">
            <RewardMoment>Published. Registration is open.</RewardMoment>
          </p>
          <p className="mt-3 text-13 text-muted-foreground">
            {published.listed
              ? "It is listed on the public site, and anyone can register."
              : "It is not listed: only people with an invitation link can see it and register."}{" "}
            Its page is <span className="font-mono text-foreground/80">…/events/{published.slug}</span>.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={`/events/${published.id}/overview`} className={buttonClass("primary", "compact")}>
              Open the event
            </Link>
            <Link to="/events" className={buttonClass("secondary", "compact")}>
              Back to events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ruleRows: [ReactNode, ReactNode][] = TIER_ORDER.map((tier) => {
    const n = rooms.filter((room) => effectOf(rules, tier, room.id) === "permit").length;
    return [
      TIER_LABEL[tier],
      n === 0 ? (
        <span className="text-muted-foreground">No rooms</span>
      ) : n === rooms.length ? (
        "Every room"
      ) : (
        <>
          <span className="font-mono tabular-nums">{n}</span> of <span className="font-mono tabular-nums">{rooms.length}</span> rooms
        </>
      ),
    ];
  });

  const pass = record.pass_template;
  const capacity = rooms.reduce((sum, room) => sum + room.capacity, 0);

  return (
    <div
      className={`grid grid-cols-1 gap-8 py-6 xl:grid-cols-[minmax(0,48rem)_minmax(20rem,26rem)] xl:gap-10 2xl:grid-cols-[minmax(0,80rem)_26rem] ${GUTTER_X}`}
    >
      {/* The summary: one column, or two side by side once its column is wide enough (a wide screen). */}
      <div className="@container min-w-0">
      <div className="grid grid-cols-1 items-start gap-6 @min-[60rem]:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel title={STEP_LABEL.basics} actions={<EditLink step="basics" onEdit={goto} />}>
          <KeyValues
            rows={[
              ["Name", record.title || <span className="text-muted-foreground">Not set</span>],
              ["Web address", <span className="font-mono text-12">…/events/{record.slug}</span>],
              ["Starts", when(record.starts_at, tz)],
              ["Ends", when(record.ends_at, tz)],
              ["Time zone", zoneLabel(tz, record.starts_at ? Date.parse(record.starts_at) : Date.now())],
              ["Listing", record.listed ? "Listed on the public site" : "Not listed: by invitation only"],
              ["Description", record.description ? <span className="line-clamp-3">{record.description}</span> : <span className="text-muted-foreground">None</span>],
            ]}
          />
        </Panel>
        <Panel title={STEP_LABEL.venue} actions={<EditLink step="venue" onEdit={goto} />}>
          <KeyValues
            rows={[
              ["Venue", venue ? `${venue.venue.name}${venue.venue.city ? ` · ${venue.venue.city}` : ""}` : <span className="text-muted-foreground">Not chosen</span>],
              [
                "Rooms",
                rooms.length ? (
                  <>
                    <span className="font-mono tabular-nums">{rooms.length}</span>: <span className="text-muted-foreground">{rooms.map((room) => room.name).join(", ")}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">None chosen</span>
                ),
              ],
              ["Places", rooms.length ? <span className="font-mono tabular-nums">{formatNumber(capacity)}</span> : "—"],
            ]}
          />
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Panel title={STEP_LABEL.access} meta="Tiers permitted" actions={<EditLink step="access" onEdit={goto} />}>
          <KeyValues rows={ruleRows} />
        </Panel>
        <Panel title={STEP_LABEL.pass} actions={<EditLink step="pass" onEdit={goto} />}>
          {pass ? (
            <KeyValues
              rows={[
                ["Headline", pass.headline],
                ["Note", pass.note || <span className="text-muted-foreground">None</span>],
                [
                  "Also shows",
                  [pass.show_tier && "tier", pass.show_sessions && "sessions", pass.wallet && "Add to Wallet"].filter(Boolean).join(", ") || (
                    <span className="text-muted-foreground">Nothing else</span>
                  ),
                ],
              ]}
            />
          ) : (
            <p className="px-4 py-3 text-13 text-muted-foreground sm:px-5">Not set up yet.</p>
          )}
        </Panel>
      </div>
      </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <section aria-label="Publish" className="px-4 py-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <ActionButton
              action={publish}
              doneLabel="Published"
              failedLabel="Not published — see below"
              reward
              keepDone
              variant="primary"
              size="compact"
              disabled={!summary.ready}
              aria-label={summary.ready ? undefined : `Publish event, unavailable: ${summary.text}`}
            >
              Publish event
            </ActionButton>
            <div className="min-w-0 flex-1 text-12">
              {summary.ready ? (
                <p className="text-muted-foreground">Registration opens as soon as you publish. You can still change the event afterwards.</p>
              ) : (
                <>
                  <p className="text-foreground">Publishing needs:</p>
                  <ul className="mt-1 list-none text-muted-foreground">
                    {unmet.map((item) => (
                      <li key={item.key}>
                        {item.step ? (
                          <button type="button" onClick={() => goto(item.step as WizardStep)} className={linkClass}>
                            {item.label}
                          </button>
                        ) : (
                          item.label
                        )}
                        <span className="text-muted-foreground"> · {item.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          {problem ? (
            <Notice tone="danger" className="mt-3">
              {problem}
            </Notice>
          ) : null}
        </section>

        <ReadinessChecklist items={readiness} onFix={goto} title="Before publishing" />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
          <Button variant="quiet" size="compact" className="-ml-3 text-destructive/80 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
            Delete draft
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="compact" onClick={() => goto("pass")}>
              Back
            </Button>
            <Button variant="quiet" size="compact" onClick={() => close(record)}>
              Save and close
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        tone="danger"
        width="sm"
        title="Delete this draft?"
        description={`“${record.title || "Untitled draft"}” and everything set up in it will be removed. This cannot be undone.`}
        footer={
          <>
            <Button variant="secondary" size="compact" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Keep the draft
            </Button>
            <Button variant="danger" size="compact" loading={deleting} onClick={() => void remove()}>
              Delete draft
            </Button>
          </>
        }
      >
        {deleteProblem ? <Notice tone="danger">{deleteProblem}</Notice> : null}
      </Dialog>
    </div>
  );
}
