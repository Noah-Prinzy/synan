/**
 * D6.4 · Attendees `/events/:id/attendees` (docs/06 §2.3, scoped D7). Everyone registered for
 * this event in one dense table: name, email, tier, registration and credential state, band,
 * checked in, last scan in the event's zone. Search and filters live in the URL, so a filtered
 * view can be shared. Pages of 50 in the browser. A row opens the attendee: in a side panel at
 * ≥1280, in a dialog below that. The actions on an attendee belong to D7 and are shown disabled.
 *
 * States: loading, error with retry, no registrations yet, no match for the filters, updating.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import type { AttendeeTier, CredentialState } from "@synan/contracts/enums";
import { Button, Checkbox, Dialog, Field, Select, TextInput, cn } from "@synan/ui/components";
import { SignalShape, formatNumber } from "@synan/ui/data";
import type { AttendeeListRow, AttendeeQuery } from "@synan/mock/command";
import {
  EmptyState,
  ErrorState,
  ICON_BUTTON,
  LoadingState,
  SectionHead,
  TYPE,
  TIER_LABEL,
  TIER_ORDER,
  Table,
  Td,
  Th,
  formatStamp,
  linkClass,
  rowClass,
  useDocumentTitle,
} from "../kit";
import { configure } from "../live/backend";
import { AttendeeActions, AttendeeFacts } from "./parts/attendee-detail";
import { useWorkspaceEvent } from "./parts/context";
import { CREDENTIAL_ORDER, CREDENTIAL_VIEW, REGISTRATION_VIEW } from "./parts/copy";
import { HEAD_BLEED } from "./parts/layout";
import { useMedia } from "./parts/use-media";

const PAGE = 50;
const ANY = "any";

type Load =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; items: AttendeeListRow[]; total: number; updating: boolean };

export default function WorkspaceAttendees() {
  const { event } = useWorkspaceEvent();
  useDocumentTitle(`Attendees · ${event.title || "Untitled event"}`);
  const [params, setParams] = useSearchParams();
  const wide = useMedia("(min-width: 80rem)");

  const q = params.get("q") ?? "";
  const tier = (TIER_ORDER as readonly string[]).includes(params.get("tier") ?? "") ? (params.get("tier") as AttendeeTier) : null;
  const credential = (CREDENTIAL_ORDER as string[]).includes(params.get("credential") ?? "") ? (params.get("credential") as CredentialState) : null;
  const unbound = params.get("unbound") === "1";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const filtered = Boolean(q || tier || credential || unbound);

  const update = (patch: Record<string, string | null>, keepPage = false) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  // The search box writes to the URL a moment after typing stops.
  const [typed, setTyped] = useState(q);
  useEffect(() => setTyped(q), [q]);
  useEffect(() => {
    if (typed === q) return;
    const timer = window.setTimeout(() => update({ q: typed.trim() || null }), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const query = useMemo<AttendeeQuery>(
    () => ({ q: q || undefined, tier: tier ?? undefined, credential: credential ?? undefined, unbound: unbound || undefined }),
    [q, tier, credential, unbound],
  );
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const mine = ++generation.current;
    // Keep the rows on screen while a new filter loads; the count line says it is updating.
    setLoad((current) => (current.status === "ready" ? { ...current, updating: true } : { status: "loading" }));
    configure.attendees(event.id, query).then(
      (result) => mine === generation.current && setLoad({ status: "ready", items: result.items, total: result.total, updating: false }),
      (error: unknown) => mine === generation.current && setLoad({ status: "error", error }),
    );
  }, [event.id, query, attempt]);

  const [openId, setOpenId] = useState<string | null>(null);
  // After a decision on a pass, the row shows what the server returned.
  const replaceRow = (row: AttendeeListRow) =>
    setLoad((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.map((item) => (item.registration_id === row.registration_id ? { ...item, ...row } : item)) }
        : current,
    );

  if (load.status === "loading") return <LoadingState label="Loading attendees…" rows={10} />;
  if (load.status === "error") {
    return (
      <ErrorState
        title="Could not load the attendees"
        error={load.error}
        onRetry={() => {
          setLoad({ status: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (load.total === 0 && !filtered) {
    return (
      <EmptyState title="No registrations yet">
        {event.state === "draft" ? (
          <p>Registration opens when the event is published. Everyone who registers, is invited or is onboarded at a kiosk appears here.</p>
        ) : (
          <p>
            Everyone who registers, accepts an invitation or is onboarded at a kiosk appears here, with their tier, pass and
            band. {event.listed ? "The event is listed, so people can find it and register." : "The event is invitation only: send invitations from the attendee console."}
          </p>
        )}
      </EmptyState>
    );
  }

  const pages = Math.max(1, Math.ceil(load.items.length / PAGE));
  const current = Math.min(page, pages);
  const rows = load.items.slice((current - 1) * PAGE, current * PAGE);
  const selected = load.items.find((row) => row.registration_id === openId) ?? null;
  const panel = wide && selected !== null;

  const toolbar = (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6 2xl:px-8">
      <Field label="Search" className="w-full sm:w-72">
        <TextInput
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Name, email or band"
          suffix={<Search size={16} strokeWidth={1.5} aria-hidden="true" />}
        />
      </Field>
      <Field label="Tier" className="w-[calc(50%-0.375rem)] sm:w-40">
        <Select
          options={[{ value: ANY, label: "Any tier" }, ...TIER_ORDER.map((t) => ({ value: t, label: TIER_LABEL[t] }))]}
          value={tier ?? ANY}
          onChange={(value) => update({ tier: value === ANY ? null : value })}
        />
      </Field>
      <Field label="Credential" className="w-[calc(50%-0.375rem)] sm:w-44">
        <Select
          options={[{ value: ANY, label: "Any state" }, ...CREDENTIAL_ORDER.map((c) => ({ value: c, label: CREDENTIAL_VIEW[c].label }))]}
          value={credential ?? ANY}
          onChange={(value) => update({ credential: value === ANY ? null : value })}
        />
      </Field>
      <div className="flex h-8 items-center pointer-coarse:h-11">
        <Checkbox label="Not yet bound" checked={unbound} onChange={(e) => update({ unbound: e.target.checked ? "1" : null })} />
      </div>
      {filtered ? (
        <Button
          variant="quiet"
          size="compact"
          onClick={() => {
            setTyped("");
            update({ q: null, tier: null, credential: null, unbound: null });
          }}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="pb-8">
      {toolbar}
      <div className={cn("min-w-0", panel && "xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]")}>
        <section aria-labelledby="attendees-table" className="min-w-0">
          <SectionHead
            id="attendees-table"
            title="Registrations"
            className={HEAD_BLEED}
            meta={
              <span role="status" aria-live="polite">
                {load.updating ? (
                  "Updating…"
                ) : (
                  <>
                    Showing <span className="font-mono tabular-nums">{formatNumber(load.items.length)}</span> of{" "}
                    <span className="font-mono tabular-nums">{formatNumber(load.total)}</span>
                    {load.total > load.items.length && !filtered ? " · search to reach the rest" : ""}
                  </>
                )}
              </span>
            }
          />
          {load.items.length === 0 ? (
            <EmptyState
              title="No one matches"
              action={
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    setTyped("");
                    update({ q: null, tier: null, credential: null, unbound: null });
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              Nobody among the loaded registrations matches {q ? <>“{q}”</> : "these filters"}. Check the spelling, or widen the filters.
            </EmptyState>
          ) : (
            <>
              <Table label="Attendees" className={load.updating ? "opacity-60" : undefined}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th fit>Tier</Th>
                    <Th fit>Registration</Th>
                    <Th fit>Credential</Th>
                    <Th fit>Band</Th>
                    <Th fit>Checked in</Th>
                    <Th numeric fit>
                      Last scan
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <AttendeeRow
                      key={row.registration_id}
                      row={row}
                      timeZone={event.timezone}
                      selected={row.registration_id === openId}
                      onOpen={() => setOpenId(row.registration_id)}
                    />
                  ))}
                </tbody>
              </Table>
              {pages > 1 ? (
                <nav aria-label="Pages" className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 2xl:px-8">
                  <span className="text-12 text-muted-foreground">
                    Rows <span className="font-mono tabular-nums">{formatNumber((current - 1) * PAGE + 1)}–{formatNumber(Math.min(current * PAGE, load.items.length))}</span> ·
                    page <span className="font-mono tabular-nums">{current}</span> of <span className="font-mono tabular-nums">{pages}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button variant="secondary" size="compact" disabled={current <= 1} onClick={() => update({ page: String(current - 1) }, true)}>
                      Previous
                    </Button>
                    <Button variant="secondary" size="compact" disabled={current >= pages} onClick={() => update({ page: String(current + 1) }, true)}>
                      Next
                    </Button>
                  </span>
                </nav>
              ) : null}
            </>
          )}
        </section>
        {panel && selected ? (
          <aside aria-labelledby="attendee-panel" className="min-w-0 border-t border-border xl:border-t-0 xl:border-l">
            <div className="sticky top-0">
              <SectionHead
                id="attendee-panel"
                title={selected.full_name ?? "Public visitor"}
                className="pr-2!"
                actions={
                  <button type="button" className={ICON_BUTTON} aria-label="Close the attendee" onClick={() => setOpenId(null)}>
                    <X strokeWidth={1.5} aria-hidden="true" />
                  </button>
                }
              />
              <AttendeeFacts row={selected} timeZone={event.timezone} />
              <AttendeeActions row={selected} eventId={event.id} onChange={replaceRow} />
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog
        open={!wide && selected !== null}
        onClose={() => setOpenId(null)}
        title={selected?.full_name ?? "Public visitor"}
        description={selected ? `${TIER_LABEL[selected.tier]} · ${REGISTRATION_VIEW[selected.state].label}` : undefined}
        footer={
          <Button variant="secondary" size="compact" onClick={() => setOpenId(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <>
            <AttendeeFacts row={selected} timeZone={event.timezone} />
            <AttendeeActions row={selected} eventId={event.id} onChange={replaceRow} />
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

function AttendeeRow({
  row,
  timeZone,
  selected,
  onOpen,
}: {
  row: AttendeeListRow;
  timeZone: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const credential = row.credential_state ? CREDENTIAL_VIEW[row.credential_state] : null;
  const registration = REGISTRATION_VIEW[row.state];
  return (
    <tr
      className={cn(rowClass, "cursor-pointer", selected && "bg-foreground/4")}
      onClick={onOpen}
    >
      <Td className="relative max-w-56">
        {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-pressed={selected}
          className={cn(linkClass, "block max-w-full truncate text-left", !row.full_name && "text-muted-foreground")}
        >
          {row.full_name ?? "Public visitor"}
        </button>
      </Td>
      <Td className="max-w-72 truncate text-muted-foreground">{row.email ?? "—"}</Td>
      <Td fit>{TIER_LABEL[row.tier]}</Td>
      <Td fit>
        <span className={cn("inline-flex items-center gap-1.5", registration.tone)}>
          <SignalShape state={registration.shape} />
          {registration.label}
        </span>
      </Td>
      <Td fit>
        {credential ? (
          <span className={cn("inline-flex items-center gap-1.5", credential.tone)}>
            <SignalShape state={credential.shape} />
            {credential.label}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td fit>
        {row.band_hint ? <span className={TYPE.value}>{row.band_hint}</span> : <span className="text-muted-foreground">Not bound</span>}
      </Td>
      <Td fit>{row.checked_in ? "Yes" : <span className="text-muted-foreground">No</span>}</Td>
      <Td numeric fit>
        {row.last_scan_at ? formatStamp(row.last_scan_at, timeZone) : <span className="text-muted-foreground">—</span>}
      </Td>
    </tr>
  );
}
