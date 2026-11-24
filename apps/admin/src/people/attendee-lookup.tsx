/**
 * Attendee lookup `/attendees` for a role that runs the live event without the event workspace
 * (the supervisor, D-23): find someone in the selected event by name, email or band, read their
 * registration and pass, and clear or revoke a pass under review. Nothing else changes here.
 *
 * A role that has the event workspace is sent to the event's own attendee table instead, so
 * `/attendees` always lands somewhere useful.
 *
 * States: no event, type to search, loading, error with retry, no match, under-review list,
 * a pass decided.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Button, Dialog, Field, TextInput, cn } from "@synan/ui/components";
import { SignalShape, formatNumber } from "@synan/ui/data";
import type { AttendeeListRow } from "@synan/mock/command";
import { useSession } from "../access/session";
import { EmptyState, ErrorState, FilterChips, LoadingState, PageHeader, SectionHead, TIER_LABEL, useDocumentTitle } from "../kit";
import { configure } from "../live/backend";
import { useCommand } from "../live/context";
import { AttendeeFacts } from "../workspace/parts/attendee-detail";
import { CREDENTIAL_VIEW } from "../workspace/parts/copy";
import { useMedia } from "../workspace/parts/use-media";
import { ReviewPass } from "./review-pass";

const SHOWN = 25;
type Mode = "search" | "review";

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; items: AttendeeListRow[]; updating: boolean };

export default function AttendeeLookup() {
  const { can } = useSession();
  const { event } = useCommand();
  if (event && can("events.view")) return <Navigate to={`/events/${event.id}/attendees`} replace />;
  return <Lookup />;
}

function Lookup() {
  const { event } = useCommand();
  const { can } = useSession();
  useDocumentTitle(event ? `Attendees · ${event.title}` : "Attendees");
  const wide = useMedia("(min-width: 80rem)");
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("show") === "review" ? "review" : "search";
  const q = params.get("q") ?? "";
  const openId = params.get("attendee");

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const [typed, setTyped] = useState(q);
  useEffect(() => setTyped(q), [q]);
  useEffect(() => {
    if (typed === q) return;
    const timer = window.setTimeout(() => set({ q: typed.trim() || null }), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const searching = mode === "review" || q.trim().length >= 2;
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [decided, setDecided] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!event || !searching) {
      setLoad({ status: "idle" });
      return;
    }
    const mine = ++generation.current;
    setLoad((current) => (current.status === "ready" ? { ...current, updating: true } : { status: "loading" }));
    configure
      .attendees(event.id, mode === "review" ? { credential: "suspended_review", q: q || undefined } : { q })
      .then(
        (result) => mine === generation.current && setLoad({ status: "ready", items: result.items, updating: false }),
        (error: unknown) => mine === generation.current && setLoad({ status: "error", error }),
      );
  }, [event, searching, mode, q, attempt]);

  // Keep a decided row in step with what the server returned.
  const replaceRow = (row: AttendeeListRow) =>
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.map((item) => (item.registration_id === row.registration_id ? { ...item, ...row } : item)) }
        : current,
    );

  if (!event) return <LoadingState label="Loading events…" />;

  const items = load.status === "ready" ? load.items : [];
  const selected = items.find((row) => row.registration_id === openId) ?? null;
  const panel = wide && selected !== null;
  const close = () => set({ attendee: null });

  const detail = selected ? (
    <>
      <AttendeeFacts row={selected} timeZone={event.timezone} />
      {(selected.credential_state === "suspended_review" || decided === selected.registration_id) && can("credentials.review") ? (
        <ReviewPass
          key={selected.registration_id}
          eventId={event.id}
          registrationId={selected.registration_id}
          onDone={(row) => {
            // Keep the block (and its confirmation) on screen after the state moves on.
            setDecided(row.registration_id);
            replaceRow(row);
          }}
          className="border-t border-border px-4 py-4"
        />
      ) : null}
    </>
  ) : null;

  return (
    <div className="min-h-full pb-10">
      <PageHeader
        code="D7"
        title="Attendees"
        meta={
          <>
            {event.title} · find someone by name, email or band
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
        <Field label="Search" className="w-full sm:w-80">
          <TextInput
            type="search"
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Name, email or band"
            suffix={<Search size={14} strokeWidth={1.5} aria-hidden="true" />}
          />
        </Field>
        <FilterChips<Mode>
          label="Show"
          value={mode}
          onChange={(value) => set({ show: value === "review" ? "review" : null, attendee: null })}
          options={[
            { value: "search", label: "Everyone" },
            { value: "review", label: "Passes under review" },
          ]}
        />
      </div>

      <div className={cn("min-w-0", panel && "xl:grid xl:grid-cols-12")}>
        <section aria-labelledby="lookup-results" className={cn("min-w-0", panel && "xl:col-span-7")}>
          {load.status === "idle" ? (
            <EmptyState title="Who are you looking for?">
              Type at least two letters of a name or email, or the first characters of a band. To see every pass that gates are
              holding for a check, choose <span className="text-foreground">Passes under review</span>.
            </EmptyState>
          ) : load.status === "loading" ? (
            <LoadingState label="Searching…" rows={5} />
          ) : load.status === "error" ? (
            <ErrorState title="Could not search the attendees" error={load.error} onRetry={() => setAttempt((n) => n + 1)} />
          ) : items.length === 0 ? (
            <EmptyState
              title={mode === "review" ? "No passes under review" : "No one matches"}
              action={
                q ? (
                  <Button variant="secondary" size="compact" onClick={() => setTyped("")}>
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                    Clear the search
                  </Button>
                ) : undefined
              }
            >
              {mode === "review"
                ? "Every pass at this event is clear. A pass is held for review when it is seen at two gates too far apart to be one person."
                : <>Nobody registered for {event.title} matches “{q}”. Check the spelling, or try the email address.</>}
            </EmptyState>
          ) : (
            <>
              <SectionHead
                id="lookup-results"
                title={mode === "review" ? "Under review" : "Matches"}
                meta={
                  <span role="status" aria-live="polite">
                    {load.updating
                      ? "Updating…"
                      : items.length > SHOWN
                        ? `First ${SHOWN} of ${formatNumber(items.length)} · narrow the search`
                        : `${formatNumber(items.length)} ${items.length === 1 ? "person" : "people"}`}
                  </span>
                }
              />
              <ul className={cn(load.updating && "opacity-60")}>
                {items.slice(0, SHOWN).map((row) => (
                  <ResultRow key={row.registration_id} row={row} selected={row.registration_id === openId} onOpen={() => set({ attendee: row.registration_id })} />
                ))}
              </ul>
            </>
          )}
        </section>
        {panel && selected ? (
          <aside aria-labelledby="lookup-person" className="min-w-0 border-t border-border xl:col-span-5 xl:border-t-0 xl:border-l">
            <div className="sticky top-0">
              <SectionHead
                id="lookup-person"
                title={selected.full_name ?? "Public visitor"}
                actions={
                  <Button variant="quiet" size="compact" aria-label="Close the attendee" onClick={close}>
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                }
              />
              {detail}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog
        open={!wide && selected !== null}
        onClose={close}
        title={selected?.full_name ?? "Public visitor"}
        description={selected ? TIER_LABEL[selected.tier] : undefined}
        footer={
          <Button variant="secondary" size="compact" onClick={close}>
            Close
          </Button>
        }
      >
        {detail ? <div className="-mx-5 -my-4">{detail}</div> : null}
      </Dialog>
    </div>
  );
}

function ResultRow({ row, selected, onOpen }: { row: AttendeeListRow; selected: boolean; onOpen: () => void }) {
  const credential = row.credential_state ? CREDENTIAL_VIEW[row.credential_state] : null;
  return (
    <li className="border-b border-border">
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected || undefined}
        className="relative grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2 text-left transition-colors duration-120 ease-standard before:absolute before:inset-y-0 before:left-0 before:w-0.5 hover:bg-foreground/3 aria-current:bg-foreground/4 aria-current:before:bg-brand motion-reduce:transition-none sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6rem_8rem] sm:px-6"
      >
        <span className={cn("truncate text-13", !row.full_name && "text-muted-foreground")}>{row.full_name ?? "Public visitor"}</span>
        <span className="col-start-1 row-start-2 truncate text-12 text-muted-foreground sm:col-start-auto sm:row-start-auto">{row.email ?? "—"}</span>
        <span className="hidden text-12 sm:block">{TIER_LABEL[row.tier]}</span>
        <span className={cn("row-span-2 inline-flex items-center gap-1.5 justify-self-end text-12 sm:row-span-1 sm:justify-self-start", credential?.tone ?? "text-muted-foreground")}>
          {credential ? <SignalShape state={credential.shape} /> : null}
          {credential?.label ?? "No pass"}
        </span>
      </button>
    </li>
  );
}
