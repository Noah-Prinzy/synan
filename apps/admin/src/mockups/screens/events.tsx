/**
 * DEVELOPMENT ONLY — the events list (rows separated by space, a lift on hover, one "New event"),
 * and the same list under the "New event" dialog (opaque, borderless; a sheet on the phone).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus, X } from "lucide-react";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { Shell, StateWord } from "../shell";
import { dateRange, num, type DxData } from "../data";
import type { EventRow } from "@synan/mock/command";

type Filter = "all" | "live" | "upcoming" | "past";

const GROUPS: { id: Exclude<Filter, "all">; label: string; states: string[] }[] = [
  { id: "live", label: "Live now", states: ["live"] },
  { id: "upcoming", label: "Coming up", states: ["published", "draft"] },
  { id: "past", label: "Past", states: ["closed", "archived"] },
];

function dayParts(iso: string | null) {
  if (!iso) return { d: "—", m: "" };
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "short" }).formatToParts(new Date(iso));
  return { d: parts.find((p) => p.type === "day")?.value ?? "", m: parts.find((p) => p.type === "month")?.value ?? "" };
}

function EventRowView({ e }: { e: EventRow }) {
  const dx = useDx();
  const { d, m } = dayParts(e.starts_at);
  return (
    <li>
      <Link to={dx.href({ screen: e.state === "live" ? "attendees" : "events" })} className="dxc-evrow">
        <span className="dxc-evrow-date" aria-hidden="true">
          <span className="dxc-evrow-day dx-mono">{d}</span>
          <span className="dxc-evrow-mon">{m}</span>
        </span>
        <span className="dxc-evrow-main">
          <span className="dxc-evrow-title">{e.title}</span>
          <span className="dxc-evrow-sub">
            {dateRange(e.starts_at, e.ends_at)} · {e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : "Venue not set"}
          </span>
        </span>
        <span className="dxc-evrow-state">
          <StateWord state={e.state} />
        </span>
        <span className="dxc-evrow-num">
          <span>
            <span className="dx-mono dxc-evrow-big">{num(e.registrations)}</span> registered
          </span>
          <span className="dxc-evrow-sub">
            {e.state === "live" || e.state === "closed" ? (
              <>
                <span className="dx-mono">{num(e.checked_in)}</span> checked in
              </>
            ) : (
              "Doors not open yet"
            )}
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.5} className="dxc-evrow-go" aria-hidden="true" />
      </Link>
    </li>
  );
}

function EventsBody({ data, onNew }: { data: DxData; onNew: () => void }) {
  const dx = useDx();
  const [filter, setFilter] = useState<Filter>("all");
  const liveCount = data.events.filter((e) => e.state === "live").length;
  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "live", label: "Live" },
    { id: "upcoming", label: "Coming up" },
    { id: "past", label: "Past" },
  ];
  return (
    <div className="dxc-page dxc-events">
      <header className="dxc-pagehead">
        <div>
          {dx.d === 1 ? null : <p className="dx-eyebrow">Events</p>}
          <h1 className={dx.d === 1 ? "dx-h2" : "dx-title"}>{dx.d === 1 ? "Events" : "Your events"}</h1>
          <p className="dxc-sub">
            {data.events.length} events · {liveCount} live now
          </p>
        </div>
        <button type="button" className="dx-btn is-action" onClick={onNew}>
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" /> New event
        </button>
      </header>
      <div className="dxc-chips" role="group" aria-label="Show">
        {chips.map((c) => (
          <button key={c.id} type="button" className="dx-chip" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {GROUPS.filter((g) => filter === "all" || filter === g.id).map((g) => {
        const rows = data.events.filter((e) => g.states.includes(e.state));
        if (rows.length === 0) return null;
        return (
          <section key={g.id} className="dxc-evgroup" aria-label={g.label}>
            <h2 className="dxc-grouphead">{g.label}</h2>
            <ul className="dxc-evlist">
              {rows.map((e) => (
                <EventRowView key={e.id} e={e} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- the dialog */

function NewEventDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [slug, setSlug] = useState("nexus-summit-2026");
  const [tried, setTried] = useState(true);
  const [done, setDone] = useState(false);
  const taken = slug.trim() === "nexus-summit-2026" || slug.trim() === "";
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const create = () => {
    setTried(true);
    if (!taken) setDone(true);
  };
  return (
    <div className="dxc-dialog-layer">
      <div className="dxc-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="dxc-dialog" role="dialog" aria-modal="true" aria-labelledby="dxc-new-title" tabIndex={-1}>
        <div className="dxc-dialog-head">
          <div>
            <h2 id="dxc-new-title" className="dx-h3">
              New event
            </h2>
            <p className="dxc-sub">Start a draft. You can change all of this before you publish.</p>
          </div>
          <button type="button" className="dx-btn is-icon is-ghost" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {done ? (
          <div className="dxc-dialog-done">
            <p className="dxc-done-line">
              <RewardTick label="Draft created" /> Draft created
            </p>
            <p className="dxc-sub">Nexus Summit 2027 is saved as a draft at synan.events/{slug}. Next: rooms and access rules.</p>
          </div>
        ) : (
          <form
            className="dxc-form"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="dxc-field">
              <label className="dx-label" htmlFor="dxc-f-name">
                Event name
              </label>
              <input id="dxc-f-name" className="dx-input" defaultValue="Nexus Summit 2027" aria-describedby="dxc-f-name-hint" />
              <p id="dxc-f-name-hint" className="dx-hint">
                Shown on passes, emails and the event page.
              </p>
            </div>
            <div className="dxc-field">
              <label className="dx-label" htmlFor="dxc-f-venue">
                Venue
              </label>
              <select id="dxc-f-venue" className="dx-input" defaultValue="nexus">
                <option value="nexus">Nexus Hall, Kampala</option>
                <option value="serena">Serena Conference Centre, Kampala</option>
                <option value="village">Innovation Village, Kampala</option>
              </select>
            </div>
            <div className="dxc-field-row">
              <div className="dxc-field">
                <label className="dx-label" htmlFor="dxc-f-start">
                  Starts
                </label>
                <input id="dxc-f-start" className="dx-input" defaultValue="Sat 20 Nov 2027, 09:00" />
              </div>
              <div className="dxc-field">
                <label className="dx-label" htmlFor="dxc-f-end">
                  Ends
                </label>
                <input id="dxc-f-end" className="dx-input" defaultValue="Sun 21 Nov 2027, 17:00" />
              </div>
            </div>
            <div className="dxc-field">
              <label className="dx-label" htmlFor="dxc-f-slug">
                Web address
              </label>
              <div className="dxc-prefixed">
                <span className="dxc-prefix" aria-hidden="true">
                  synan.events/
                </span>
                <input
                  id="dxc-f-slug"
                  className="dx-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  aria-invalid={tried && taken ? true : undefined}
                  aria-describedby={tried && taken ? "dxc-f-slug-error" : "dxc-f-slug-hint"}
                  spellCheck={false}
                />
              </div>
              {tried && taken ? (
                <p id="dxc-f-slug-error" className="dx-error">
                  {slug.trim() === "" ? "Give the event a web address." : "That address already belongs to Nexus Summit 2026. Try nexus-summit-2027."}
                </p>
              ) : (
                <p id="dxc-f-slug-hint" className="dx-hint">
                  Lower-case letters, numbers and dashes.
                </p>
              )}
            </div>
          </form>
        )}
        <div className="dxc-dialog-foot">
          {done ? (
            <button type="button" className="dx-btn is-action" onClick={onClose}>
              Open the draft
            </button>
          ) : (
            <>
              <button type="button" className="dx-btn is-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="dx-btn is-action" onClick={create}>
                Create draft
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EventsPage({ dialog }: { dialog: boolean }) {
  const [open, setOpen] = useState(dialog);
  return (
    <Shell page="events">
      {(data) => (
        <>
          <EventsBody data={data} onNew={() => setOpen(true)} />
          {open ? <NewEventDialog onClose={() => setOpen(false)} /> : null}
        </>
      )}
    </Shell>
  );
}

export default function Events() {
  return <EventsPage dialog={false} />;
}

export function EventDialog() {
  return <EventsPage dialog />;
}
