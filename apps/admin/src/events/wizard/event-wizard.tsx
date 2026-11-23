/**
 * D5 · Event wizard `/events/new/:step?` with `?draft=<id>` (docs/06 §2.3, P-13). Five steps:
 * Basics → Venue & rooms → Access rules → Pass template → Review. Every step is resumable: the
 * first Continue creates the draft, each later Continue writes it, the draft id lives in the
 * URL and the step in the path, so a refresh (or a link from D4) lands in the same place.
 * Unsaved input of each step is kept while the wizard is open, so Back never loses it.
 *
 * This file owns loading the draft, resolving the step (no step → where the draft stopped; a
 * step not reached yet → the furthest one reached) and the frame; each step is its own file.
 *
 * States: loading the draft, draft not found, error with retry, an event that is no longer a
 * draft (published elsewhere), and the five steps.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { WIZARD_STEPS, type EventRecord, type VenueDetail, type WizardStep } from "@synan/mock/command";
import { buttonClass } from "@synan/ui/components";
import { EmptyState, ErrorState, LoadingState, Notice, PageHeader, Stepper, errorCode, formatStamp, linkClass, useDocumentTitle } from "../../kit";
import { configure } from "../../live/backend";
import { STEP_LABEL, type StepContext, type WizardForms } from "./shared";
import { BasicsStep } from "./step-basics";
import { VenueStep } from "./step-venue";
import { AccessStep } from "./step-access";
import { PassStep } from "./step-pass";
import { ReviewStep } from "./step-review";

type Load = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready" };

const isStep = (value: string | undefined): value is WizardStep => (WIZARD_STEPS as readonly string[]).includes(value ?? "");

export default function EventWizard() {
  const { step: stepParam } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const draftId = params.get("draft");

  const [record, setRecord] = useState<EventRecord | null>(null);
  const [forms, setForms] = useState<WizardForms>({});
  const [load, setLoad] = useState<Load>(draftId ? { status: "loading" } : { status: "ready" });
  const [attempt, setAttempt] = useState(0);
  // Published here: keep showing the review step's result rather than "already published".
  const [publishedHere, setPublishedHere] = useState(false);
  const handledAttempt = useRef(0);
  const recordId = useRef<string | null>(null);
  const previousDraft = useRef<string | null>(draftId);
  const venues = useRef(new Map<string, Promise<VenueDetail>>());

  useDocumentTitle(record?.title ? `${record.title} · Draft` : "New event");

  // Load the draft named in the URL. A draft just created here is already in hand.
  useEffect(() => {
    const before = previousDraft.current;
    previousDraft.current = draftId;
    if (!draftId) {
      if (before) {
        // "New event" from inside a draft: start clean.
        recordId.current = null;
        setRecord(null);
        setForms({});
        setPublishedHere(false);
      }
      setLoad({ status: "ready" });
      return;
    }
    if (recordId.current === draftId && attempt === handledAttempt.current) return;
    handledAttempt.current = attempt;
    let cancelled = false;
    setLoad({ status: "loading" });
    configure.event(draftId).then(
      (loaded) => {
        if (cancelled) return;
        if (recordId.current !== loaded.id) setForms({});
        recordId.current = loaded.id;
        setRecord(loaded);
        setLoad({ status: "ready" });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draftId, attempt]);

  // A new step starts at the top of the page (the shell's scroll area keeps its position otherwise).
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [stepParam]);

  const saved = useCallback((next: EventRecord) => {
    recordId.current = next.id;
    setRecord(next);
  }, []);

  const onPublished = useCallback(
    (next: EventRecord) => {
      setPublishedHere(true);
      saved(next);
    },
    [saved],
  );

  const setForm = useCallback<StepContext["setForm"]>((key, value) => {
    setForms((current) => ({ ...current, [key]: value }));
  }, []);

  const goto = useCallback(
    (step: WizardStep, id?: string) => {
      const draft = id ?? recordId.current;
      navigate(`/events/new/${step}${draft ? `?draft=${draft}` : ""}`);
    },
    [navigate],
  );

  const close = useCallback(
    (closed: EventRecord | null) => {
      navigate("/events", { state: closed ? { savedDraft: closed.title || "Untitled draft" } : undefined });
    },
    [navigate],
  );

  const loadVenue = useCallback((id: string) => {
    let pending = venues.current.get(id);
    if (!pending) {
      pending = configure.venue(id);
      venues.current.set(id, pending);
      pending.catch(() => venues.current.delete(id));
    }
    return pending;
  }, []);

  const duplicatedFrom = (location.state as { duplicatedFrom?: string } | null)?.duplicatedFrom ?? null;

  const header = (
    <PageHeader
      code="D5"
      back={
        <Link to="/events" className={linkClass}>
          Events
        </Link>
      }
      title={record?.title || "New event"}
      meta={
        record && record.state !== "draft" ? (
          "Published · registration is open"
        ) : record ? (
          <>
            Draft · last saved <span className="font-mono tabular-nums">{formatStamp(record.updated_at, record.timezone)}</span> by {record.updated_by}
          </>
        ) : (
          "Five short steps. Your draft is saved each time you continue."
        )
      }
    />
  );

  if (load.status === "loading") {
    return (
      <div className="min-h-full pb-10">
        {header}
        <LoadingState label="Opening the draft…" />
      </div>
    );
  }

  if (load.status === "error") {
    const notFound = errorCode(load.error) === "NOT_FOUND";
    return (
      <div className="min-h-full pb-10">
        {header}
        {notFound ? (
          <EmptyState
            title="This draft is not here any more"
            action={
              <>
                <Link to="/events" className={buttonClass("secondary", "compact")}>
                  Back to events
                </Link>
                <Link to="/events/new" className={buttonClass("quiet", "compact")}>
                  Start a new event
                </Link>
              </>
            }
          >
            <p>It may have been deleted, or the link is incomplete. Drafts are listed under Events.</p>
          </EmptyState>
        ) : (
          <ErrorState title="Could not open the draft" error={load.error} onRetry={() => setAttempt((n) => n + 1)} />
        )}
      </div>
    );
  }

  if (record && record.state !== "draft" && !publishedHere) {
    return (
      <div className="min-h-full pb-10">
        {header}
        <EmptyState
          title="This event is already published"
          action={
            <Link to={`/events/${record.id}/overview`} className={buttonClass("primary", "compact")}>
              Open the event
            </Link>
          }
        >
          <p>Its settings are changed from the event's own pages now, not the wizard.</p>
        </EmptyState>
      </div>
    );
  }

  const reached = record ? WIZARD_STEPS.indexOf(record.wizard_step) : 0;
  const search = record ? `?draft=${record.id}` : "";

  // No step in the path: resume where the draft stopped.
  if (!isStep(stepParam)) {
    return <Navigate to={`/events/new/${record ? record.wizard_step : "basics"}${search}`} replace state={location.state} />;
  }
  // A step not reached yet: go to the furthest one reached.
  const stepIndex = WIZARD_STEPS.indexOf(stepParam);
  if (stepIndex > reached) {
    const to = WIZARD_STEPS[reached] ?? "basics";
    return <Navigate to={`/events/new/${to}${search}`} replace />;
  }

  const context: StepContext = { record, forms, setForm, saved, goto, close, loadVenue, onPublished };

  return (
    <div ref={top} className="min-h-full pb-10" data-wizard>
      {header}
      <Stepper
        label="Event setup steps"
        steps={WIZARD_STEPS.map((key) => ({ key, label: STEP_LABEL[key] }))}
        current={stepParam}
        reached={reached}
        onStep={record && record.state !== "draft" ? undefined : (key) => goto(key as WizardStep)}
      />
      {duplicatedFrom && stepParam === "basics" ? (
        <div className="px-4 pt-4 sm:px-6">
          <Notice className="max-w-160">
            Copied from “{duplicatedFrom}”: venue, rooms, access rules and pass came with it. Set the new dates, then continue.
          </Notice>
        </div>
      ) : null}
      {stepParam === "basics" ? <BasicsStep key={record?.id ?? "new"} {...context} /> : null}
      {stepParam === "venue" && record ? <VenueStep key={record.id} {...context} record={record} /> : null}
      {stepParam === "access" && record ? <AccessStep key={record.id} {...context} record={record} /> : null}
      {stepParam === "pass" && record ? <PassStep key={record.id} {...context} record={record} /> : null}
      {stepParam === "review" && record ? <ReviewStep key={record.id} {...context} record={record} /> : null}
    </div>
  );
}
