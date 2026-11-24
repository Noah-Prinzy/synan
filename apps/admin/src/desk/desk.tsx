/**
 * D8 · Wristband desk `/desk` (docs/01 §3 desk clerk, §5.3 provisioning, §5.4 on-site fallback).
 *
 * A clerk at a venue entrance with a queue in front of them, on a tablet, a phone, or a laptop
 * with a USB band reader. One job, done fast and surely: find the person, then bind, rebind or
 * replace their band, or resend their pass. The clerk sees only the events they are assigned to
 * (a picker appears only when there is more than one) and the band stock at a glance.
 *
 * Layout: below 1024 one column — search, then the attendee in place of the results. From 1024
 * the results stay on the left and the attendee opens on the right. Every control a thumb needs
 * is at least 44px tall at every width.
 *
 * After every completed action the cursor goes back to the search, with the last name selected,
 * so typing the next name replaces it. Nothing is lost on a failure or while offline: the search
 * and the attendee stay on screen, and every step can be tried again.
 *
 * States: loading (session, events, stock), no assigned event, event not open or closed, empty
 * search, too short, no match, search failed, offline (banner; actions wait), each flow's own
 * refusals (unknown band, not in stock, bound to someone else, pass revoked or under review),
 * the second-factor prompt, and the reward after a completed action.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { Field, Select, cn } from "@synan/ui/components";
import { SignalShape, formatNumber } from "@synan/ui/data";
import type { CommandEvent, DeskInventory, DeskRegistration } from "@synan/mock/command";
import { EmptyState, EventStateChip, LoadingState, Notice, PageHeader, useDocumentTitle, useResource, type Resource } from "../kit";
import { DEV_TOOLS } from "../live/backend";
import { useCommand } from "../live/context";
import { AttendeeCard } from "./attendee-card";
import { PhotoIdReminder, SearchField, SearchResults } from "./attendee-search";
import { useDeskSearch } from "./use-desk-search";
import { displayName, plural } from "./copy";
import { desk, deskIsMock } from "./desk-api";
import { DeskDevPanel } from "./dev-panel";
import { StepUpProvider } from "./step-up";
import { track, useOffline } from "./use-online";

/** Below this many bands in stock, the count turns amber and says to fetch a new box. */
const LOW_STOCK = 50;

export default function DeskScreen() {
  useDocumentTitle("Wristband desk");
  const { events, event, selectEvent } = useCommand();

  if (!events) return <LoadingState label="Opening your desk…" />;
  if (events.length === 0 || !event) {
    return (
      <EmptyState title="You are not assigned to a desk yet">
        <p>The desk shows the events you work. Ask your shift lead or an admin to assign you to an event's registration desk, then reload this page.</p>
      </EmptyState>
    );
  }
  return (
    <StepUpProvider>
      {/* A different event is a different desk: nothing carries over. */}
      <Desk key={event.id} event={event} events={events} onSelectEvent={selectEvent} />
    </StepUpProvider>
  );
}

function Desk({ event, events, onSelectEvent }: { event: CommandEvent; events: CommandEvent[]; onSelectEvent: (id: string) => void }) {
  const offline = useOffline();
  const readOnly = event.state === "closed" || event.state === "archived";
  const inventory = useResource(() => track(desk.inventory(event.id)), [event.id]);

  const [query, setQuery] = useState("");
  const { state: search, retry, patch, tooShort } = useDeskSearch(event.id, query);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<{ row: DeskRegistration; focusBand: boolean } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchBlock = useRef<HTMLDivElement>(null);
  const listId = useId().replace(/:/g, "");
  const items = search.items ?? [];

  // New results: nothing highlighted until the clerk moves.
  useEffect(() => setActiveIndex(-1), [search.items]);

  const changeQuery = (next: string) => {
    setQuery(next);
    enterEarly.current = false;
    // Typing a new name means the next person: close the one on screen.
    if (selected) setSelected(null);
  };

  const pick = (row: DeskRegistration, viaKeyboard: boolean) => {
    // A reader types like a keyboard: focus the band field when one is likely at hand.
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    setSelected({ row, focusBand: viaKeyboard || finePointer });
    setActiveIndex(items.findIndex((item) => item.id === row.id));
  };

  // Enter pressed before the results caught up with the typing: open the first match once they do.
  const current = !search.loading && search.forQuery === query.trim();
  const enterEarly = useRef(false);
  useEffect(() => {
    if (!enterEarly.current || search.loading) return;
    if (search.error || search.forQuery !== query.trim()) {
      if (search.error) enterEarly.current = false;
      return;
    }
    enterEarly.current = false;
    const first = search.items?.[0];
    if (first) pick(first, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const backToSearch = useCallback(() => {
    setSelected(null);
    searchInput.current?.focus();
    searchInput.current?.select();
  }, []);

  const changed = useCallback(
    (row: DeskRegistration) => {
      patch(row);
      inventory.reload(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch],
  );

  // Ready for the next person: the cursor in the search, the last name selected, so typing the
  // next name replaces it. On one column the search is brought into view too; the reward sits
  // just below it, under the name.
  const readyForNext = useCallback(() => {
    searchInput.current?.focus({ preventScroll: true });
    searchInput.current?.select();
    if (!wideNow()) searchBlock.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }, []);

  const retryAll = () => {
    retry();
    inventory.reload(true);
  };

  return (
    <div className="pb-6">
      <PageHeader
        code="D8"
        title="Wristband desk"
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-foreground">{event.title}</span>
            <span aria-hidden="true">·</span>
            <span>{event.venue_name}</span>
            {event.state !== "live" ? <EventStateChip state={event.state} /> : null}
          </span>
        }
        actions={
          <>
            {events.length > 1 ? (
              <Field label="Event" className="w-full min-[480px]:w-60">
                <Select
                  options={events.map((e) => ({ value: e.id, label: e.title, meta: e.state === "live" ? "Live" : undefined }))}
                  value={event.id}
                  onChange={onSelectEvent}
                  listMinWidth={260}
                />
              </Field>
            ) : null}
            <StockCell inventory={inventory} />
          </>
        }
      />

      {offline ? <OfflineBanner onRetry={retryAll} /> : null}
      {readOnly ? (
        <Notice className="mx-4 mt-4 sm:mx-6">This event is {event.state}. You can look people up, but bands cannot be bound or replaced, and passes are not sent.</Notice>
      ) : event.state === "draft" ? (
        <Notice className="mx-4 mt-4 sm:mx-6">This event is still a draft: nobody can register yet, so there is no one to find.</Notice>
      ) : null}

      <div className="lg:grid lg:min-h-[calc(100dvh-16rem)] lg:grid-cols-12">
        <section aria-label="Find an attendee" className="min-w-0 lg:col-span-5 lg:border-r lg:border-border">
          <div ref={searchBlock} role="search" className="flex scroll-mt-14 flex-col gap-3 px-4 pt-5 sm:px-6">
            <SearchField
              ref={searchInput}
              query={query}
              onQuery={changeQuery}
              items={items}
              activeIndex={activeIndex}
              onActiveIndex={setActiveIndex}
              onPick={(row) => pick(row, true)}
              listId={listId}
              expanded={items.length > 0 && !(selected && !wideNow())}
              current={current}
              onEnterEarly={() => {
                enterEarly.current = true;
              }}
            />
            {/* On one column, an open attendee needs the room more than the reminder does. */}
            <PhotoIdReminder className={cn(selected && "max-lg:hidden")} />
          </div>

          {selected ? (
            // Below 1024 the attendee takes the results' place; a quiet way back to them.
            <div className="px-4 pt-3 sm:px-6 lg:hidden">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="pressable min-h-11 text-13 text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-120 hover:text-foreground hover:decoration-brand motion-reduce:transition-none"
              >
                {items.length > 0 ? `Back to ${items.length} ${plural(items.length, "result")}` : "Back to the search"}
              </button>
            </div>
          ) : null}

          <div className={cn(selected && "max-lg:hidden")}>
            <SearchResults
              search={search}
              tooShort={tooShort}
              query={query}
              eventTitle={event.title}
              listId={listId}
              activeIndex={activeIndex}
              selectedId={selected?.row.id ?? null}
              onPick={(row) => pick(row, false)}
              onRetry={retry}
              onClear={() => changeQuery("")}
            />
          </div>
        </section>

        <section aria-label={selected ? displayName(selected.row) : "Attendee"} className="min-w-0 max-lg:mt-2 max-lg:border-t max-lg:border-border lg:col-span-7">
          {selected ? (
            <AttendeeCard
              key={selected.row.id}
              initial={selected.row}
              eventId={event.id}
              timeZone={event.timezone}
              readOnly={readOnly}
              offline={offline}
              focusBand={selected.focusBand}
              onClose={backToSearch}
              onChanged={changed}
              onCompleted={readyForNext}
            />
          ) : (
            <div className="hidden px-6 py-10 lg:block">
              <p className="max-w-100 text-13 leading-relaxed text-muted-foreground">
                Choose someone from the results to see their pass and band. With a band reader, scan as soon as their name opens.
              </p>
            </div>
          )}
        </section>
      </div>

      {DEV_TOOLS && deskIsMock ? <DeskDevPanel onStockChanged={() => inventory.reload(true)} /> : null}
    </div>
  );
}

function wideNow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 64rem)").matches;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Bands in the box, as a large mono numeral; amber when the box is running low. */
function StockCell({ inventory }: { inventory: Resource<DeskInventory> & { reload: (quiet?: boolean) => void } }) {
  const stock = inventory.status === "ready" ? inventory.data.by_state.stock : null;
  const low = stock !== null && stock < LOW_STOCK;
  const today = inventory.status === "ready" ? inventory.data.today : null;
  return (
    <div className="grid min-w-40 grid-cols-[auto_auto] items-baseline gap-x-3 border border-border px-3 py-2 max-sm:w-full max-sm:grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-1" role="group" aria-label="Band stock">
      <span className="text-11 text-muted-foreground">Bands in stock</span>
      {inventory.status === "error" ? (
        <button type="button" onClick={() => inventory.reload()} className="mt-0.5 min-h-8 text-left text-12 text-foreground underline decoration-border underline-offset-4 hover:decoration-brand">
          Not loaded · try again
        </button>
      ) : (
        <span className={cn("mt-0.5 flex items-center gap-2 font-mono text-21 leading-none tabular-nums sm:text-28", low && "text-warning")} aria-live="polite">
          {low ? <SignalShape state="warn" /> : null}
          {stock === null ? <span className="text-muted-foreground">—</span> : formatNumber(stock)}
        </span>
      )}
      {/* Always one line under the number, so the header never changes height. */}
      {low ? (
        <span className="mt-1 text-11 text-warning max-sm:col-span-2">Running low: ask for a new box</span>
      ) : (
        <span className="mt-1 text-11 text-muted-foreground max-sm:col-span-2">
          Today <span className="font-mono text-foreground tabular-nums">{today?.bound ?? 0}</span> bound ·{" "}
          <span className="font-mono text-foreground tabular-nums">{today?.replaced ?? 0}</span> replaced ·{" "}
          <span className="font-mono text-foreground tabular-nums">{today?.resent ?? 0}</span> resent
        </span>
      )}
    </div>
  );
}

function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-warning/40 px-4 py-2.5 text-13 sm:px-6">
      <span className="flex min-w-0 flex-1 items-start gap-2 text-warning">
        <WifiOff size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">Offline.</span>{" "}
          <span className="text-foreground">Your search and the attendee stay on screen. Binding, replacing and resending wait for the connection.</span>
        </span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="pressable min-h-11 border border-border px-3 text-13 font-medium transition-colors duration-120 hover:border-foreground/50 motion-reduce:transition-none"
      >
        Try again
      </button>
    </div>
  );
}
