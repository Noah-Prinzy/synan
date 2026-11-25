/**
 * Finding the person in front of the desk: one field (name, email, pass reference, or a band's
 * number or its last four — the server matches them all, so kiosk walk-ins with no name are found
 * too), results as you type.
 *
 * The field is a combobox over the result list: ↓ and ↑ move through the results, Enter opens
 * the highlighted one (the first if none is), Escape clears. Each result is a 56px row, so a
 * thumb hits it. The last results stay on screen while a new search runs, after a failure and
 * while offline, so nothing the clerk was looking at disappears.
 *
 * The search is deliberately not written to the URL: names and email addresses do not belong in
 * a shared desk browser's history.
 */
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { IdCard, Search, X } from "lucide-react";
import { Button, Field, cn } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import type { DeskRegistration } from "@synan/mock/command";
import { GUTTER_X, Notice } from "../kit";
import { bandBlock, bandView, CREDENTIAL_STATE_COPY, displayName, plural, REGISTRATION_STATE_COPY, signalText, TIER_LABEL } from "./copy";
import { deskFailure, isOffline } from "./desk-api";
import { DeskInput } from "./desk-input";
import type { SearchState } from "./use-desk-search";


export const SearchField = forwardRef<
  HTMLInputElement,
  {
    query: string;
    onQuery: (query: string) => void;
    items: DeskRegistration[];
    activeIndex: number;
    onActiveIndex: (index: number) => void;
    onPick: (row: DeskRegistration) => void;
    listId: string;
    expanded: boolean;
    /** The results shown belong to the text in the field (not an earlier search still on screen). */
    current: boolean;
    /** Enter while the results are not current yet: open the first match when they arrive. */
    onEnterEarly: () => void;
  }
>(function SearchField({ query, onQuery, items, activeIndex, onActiveIndex, onPick, listId, expanded, current, onEnterEarly }, ref) {
  return (
    <Field label="Find an attendee">
      <DeskInput
        ref={ref}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && items.length > 0) {
            event.preventDefault();
            onActiveIndex(Math.min(activeIndex + 1, items.length - 1));
          } else if (event.key === "ArrowUp" && items.length > 0) {
            event.preventDefault();
            onActiveIndex(Math.max(activeIndex - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            // Never open someone from an earlier search: a fast typist presses Enter before the results catch up.
            if (!current) return onEnterEarly();
            const row = items[activeIndex] ?? items[0];
            if (row) onPick(row);
          } else if (event.key === "Escape" && query) {
            event.preventDefault();
            onQuery("");
          }
        }}
        placeholder="Name, email, pass or band number"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        lead={<Search size={16} strokeWidth={1.5} />}
        trail={
          query ? (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear the search"
              className="pressable grid size-12 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null
        }
      />
    </Field>
  );
});

/** The on-site fallback (01 §5.4): no pass to show means email plus photo ID. */
export function PhotoIdReminder({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2.5 text-12 leading-relaxed text-muted-foreground", className)}>
      <IdCard size={16} strokeWidth={1.5} aria-hidden="true" className="mt-px shrink-0 text-foreground" />
      <span>
        <span className="text-foreground">No pass to show?</span> Find them by email, then check a photo ID matches the name before you
        hand over a band.
      </span>
    </p>
  );
}

export function SearchResults({
  search,
  tooShort,
  query,
  eventTitle,
  listId,
  activeIndex,
  selectedId,
  onPick,
  onRetry,
  onClear,
}: {
  search: SearchState;
  tooShort: boolean;
  query: string;
  eventTitle: string;
  listId: string;
  activeIndex: number;
  selectedId: string | null;
  onPick: (row: DeskRegistration) => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  const q = query.trim();
  const items = search.items;

  let status: ReactNode = null;
  if (search.loading) status = "Searching…";
  else if (items && search.forQuery) {
    status =
      items.length === 0
        ? null
        : search.more
          ? `The first ${items.length} matches. Type more of the name, or the email, to narrow it.`
          : `${items.length} ${plural(items.length, "match", "matches")}`;
  }

  return (
    <div>
      <p role="status" aria-live="polite" className={cn("flex min-h-10 items-center text-12 text-muted-foreground", GUTTER_X)}>
        {status}
      </p>

      {search.error ? (
        <div className={cn("pb-3", GUTTER_X)}>
          <Notice tone={isOffline(search.error) ? "warning" : "danger"}>
            <span className="block">
              {isOffline(search.error)
                ? items
                  ? "You are offline, so this search could not run. The results below are from your last search."
                  : "You are offline, so the search could not run. It runs again as soon as the connection is back."
                : deskFailure(search.error, "The search did not finish")}
            </span>
            <button type="button" onClick={onRetry} className="pressable mt-1.5 min-h-8 text-12 font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-brand">
              Try again
            </button>
          </Notice>
        </div>
      ) : null}

      {!q ? (
        <div className={cn("py-8", GUTTER_X)}>
          <h2 className="font-display text-21 leading-tight">Who's next?</h2>
          <p className="mt-2 max-w-100 text-13 leading-relaxed text-muted-foreground">
            Type part of their name, their email, or a pass or band number. Results appear as you type; Enter opens the first one.
          </p>
        </div>
      ) : tooShort ? (
        <p className={cn("py-6 text-13 text-muted-foreground", GUTTER_X)}>Keep typing: two letters or more.</p>
      ) : items && items.length === 0 && !search.loading && search.forQuery === q ? (
        <div className={cn("py-8", GUTTER_X)}>
          <h2 className="font-display text-21 leading-tight">No one matches “{q}”</h2>
          <p className="mt-2 max-w-100 text-13 leading-relaxed text-muted-foreground">
            Check the spelling, or try their email address. Only {eventTitle} is searched here: someone registered for another event
            belongs at that event's desk.
          </p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={onClear}>
              Clear the search
            </Button>
          </div>
        </div>
      ) : items && items.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Attendees found" className={cn("", search.loading && "opacity-60")}>
          {items.map((row, index) => (
            <ResultRow
              key={row.id}
              id={`${listId}-${index}`}
              row={row}
              query={search.forQuery}
              active={index === activeIndex}
              selected={row.id === selectedId}
              onPick={() => onPick(row)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ResultRow({
  id,
  row,
  query,
  active,
  selected,
  onPick,
}: {
  id: string;
  row: DeskRegistration;
  query: string;
  active: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const block = bandBlock(row);
  const band = bandView(row);
  // A pass that stops the desk says so in place of the band; otherwise the band's state.
  const state = block
    ? {
        signal: block.signal,
        label:
          row.credential_state === "revoked" || row.credential_state === "suspended_review"
            ? CREDENTIAL_STATE_COPY[row.credential_state].label
            : REGISTRATION_STATE_COPY[row.state].label,
      }
    : { signal: band.signal, label: band.label };
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected || active}
      onClick={onPick}
      className={cn(
        "relative grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5",
        GUTTER_X,
        "transition-colors duration-120 ease-standard hover:bg-surface-2 motion-reduce:transition-none",
        (active || selected) && "bg-surface-2",
      )}
    >
      {selected || active ? <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.5", selected ? "bg-brand" : "bg-foreground/40")} /> : null}
      <span className="min-w-0">
        <span className={cn("block truncate text-15", row.attendee.full_name ? "text-foreground" : "text-muted-foreground")}>
          <Highlight text={displayName(row)} query={query} />
        </span>
        <span className="mt-0.5 block truncate text-13 text-muted-foreground">
          {row.attendee.email ? <Highlight text={row.attendee.email} query={query} /> : "No email: public visitor"}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1 text-right">
        <span className={cn("inline-flex items-center gap-1.5 text-13", signalText[state.signal])}>
          <SignalShape state={state.signal} />
          {state.label}
        </span>
        <span className="text-12 text-muted-foreground">{TIER_LABEL[row.tier]}</span>
      </span>
    </li>
  );
}

/** The part of a name or email that matched, set in the foreground weight. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-foreground">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}
