/**
 * D6.8 · Settings `/events/:id/settings` (docs/06 §2.3; docs/01 §9, docs/03 §6). Four sections,
 * each saved on its own: Basics (name, time zone, listed), Capacity overrides per room (empty
 * keeps the venue's number), Retention (the grace period before scan records are deleted after
 * closing) and the Danger zone (close, archive). Each save knows whether anything changed.
 * Renaming refreshes the event selector in the top bar.
 *
 * States: venue loading or failed (capacity section), read-only for closed and archived events,
 * draft (danger zone replaced by "finish setup first").
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionButton, Checkbox, Field, TextInput, cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import type { EventRecord } from "@synan/mock/command";
import {
  ErrorState,
  LoadingState,
  Notice,
  TimeZoneSelect,
  errorCopy,
  fieldErrors,
  formatDate,
  formatStamp,
  linkClass,
  useDocumentTitle,
  zoneLabel,
} from "../kit";
import { configure } from "../live/backend";
import { useCommand } from "../live/context";
import { ReadOnlyNote, eventRooms, useWorkspaceEvent } from "./parts/context";
import { DangerZone } from "./parts/danger-zone";

const SECTIONS = [
  ["settings-basics", "Basics"],
  ["settings-capacity", "Capacity overrides"],
  ["settings-retention", "Retention"],
  ["settings-danger", "Danger zone"],
] as const;

export default function WorkspaceSettings() {
  const { event, replace, readOnly } = useWorkspaceEvent();
  useDocumentTitle(`Settings · ${event.title || "Untitled event"}`);

  return (
    <div className="pb-10">
      {readOnly ? <ReadOnlyNote event={event} what="its settings" /> : null}
      <div className="xl:grid xl:grid-cols-[minmax(0,40rem)_minmax(0,22rem)] xl:gap-10">
        <div className="flex w-full max-w-160 flex-col gap-10 px-4 py-6 sm:px-6">
          <Basics event={event} readOnly={readOnly} onSaved={replace} />
          <Capacity event={event} readOnly={readOnly} onSaved={replace} />
          <Retention event={event} readOnly={readOnly} onSaved={replace} />
          <section aria-labelledby="settings-danger" className="flex flex-col gap-3">
            <FormHead id="settings-danger" title="Danger zone" />
            <DangerZone event={event} onChanged={replace} />
          </section>
        </div>
        <aside aria-label="On this page" className="hidden px-4 py-6 xl:block xl:px-0">
          <nav aria-label="Settings sections" className="sticky top-6">
            <h2 className="border-b border-border pb-1.5 text-12 font-medium">On this page</h2>
            <ul className="mt-1 text-13">
              {SECTIONS.map(([id, label]) => (
                <li key={id} className="border-b border-border py-2">
                  <a href={`#${id}`} className={linkClass}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-12 text-muted-foreground">
              Each section saves on its own. Access rules are changed in Rooms &amp; rules, where a change is shown as a diff before
              it is republished.
            </p>
          </nav>
        </aside>
      </div>
    </div>
  );
}

/** A section's save row: what is unsaved, and the save button. */
function SaveRow({ dirty, children, note }: { dirty: boolean; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-3">
      <span role="status" aria-live="polite" className={cn("mr-auto text-12", dirty ? "text-foreground" : "text-muted-foreground")}>
        {dirty ? "Unsaved changes" : (note ?? "Saved")}
      </span>
      {children}
    </div>
  );
}

/** A section's heading inside the form column: a ruled label, flush with the fields below. */
function FormHead({ id, title, meta }: { id: string; title: string; meta?: ReactNode }) {
  return (
    <header className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
      <h2 id={id} className="text-12 font-medium">
        {title}
      </h2>
      {meta ? <span className="text-11 text-muted-foreground">{meta}</span> : null}
    </header>
  );
}

function useSaveFailure() {
  const [failure, setFailure] = useState("Didn't work — try again");
  const [problem, setProblem] = useState<string | null>(null);
  return { failure, setFailure, problem, setProblem };
}

/* ------------------------------------------------------------------ basics */

function Basics({ event, readOnly, onSaved }: { event: EventRecord; readOnly: boolean; onSaved: (record: EventRecord) => void }) {
  const { refreshEvents } = useCommand();
  const [title, setTitle] = useState(event.title);
  const [timezone, setTimezone] = useState(event.timezone);
  const [listed, setListed] = useState(event.listed);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { failure, setFailure, problem, setProblem } = useSaveFailure();

  // A saved or reloaded event resets the form to what the server holds.
  useEffect(() => {
    setTitle(event.title);
    setTimezone(event.timezone);
    setListed(event.listed);
  }, [event.title, event.timezone, event.listed]);

  const dirty = title !== event.title || timezone !== event.timezone || listed !== event.listed;

  const save = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = "Give the event a name.";
    else if (title.trim().length > 200) found.title = "Keep the name under 200 characters.";
    if (!timezone) found.timezone = "Choose the time zone the event runs in.";
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      throw new Error("VALIDATION");
    }
    try {
      const renamed = title.trim() !== event.title;
      const record = await configure.updateEvent(event.id, { title: title.trim(), timezone, listed });
      setErrors({});
      onSaved(record);
      if (renamed || timezone !== event.timezone) await refreshEvents().catch(() => undefined);
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length) {
        setErrors(fields);
        setFailure("Check the marked fields");
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure("Didn't work — try again");
      }
      throw error;
    }
  };

  const liveish = event.state === "live" || event.state === "published";

  return (
    <section aria-labelledby="settings-basics" className="flex scroll-mt-4 flex-col gap-4">
      <FormHead id="settings-basics" title="Basics" />
      <Field label="Name" error={errors.title} hint="Shown on passes, in discovery and in the event selector.">
        <TextInput
          value={title}
          maxLength={200}
          disabled={readOnly}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errors.title) setErrors(({ title: _t, ...rest }) => rest);
          }}
        />
      </Field>
      <Field
        label="Time zone"
        error={errors.timezone}
        hint={
          liveish && timezone !== event.timezone
            ? "Times do not move: every session and shift stays at the same instant and is shown in the new zone."
            : `Every time in this event is shown in this zone, now ${zoneLabel(timezone)}.`
        }
      >
        <TimeZoneSelect value={timezone} onChange={setTimezone} invalid={Boolean(errors.timezone)} disabled={readOnly} />
      </Field>
      <Checkbox
        label="Listed in discovery"
        description={
          listed
            ? "Anyone can find the event and register."
            : "Invitation only: hidden from public listings; people join through an invitation link."
        }
        checked={listed}
        disabled={readOnly}
        onChange={(e) => setListed(e.target.checked)}
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      {readOnly ? null : (
        <SaveRow dirty={dirty} note={`Last edited ${formatStamp(event.updated_at, event.timezone)} by ${event.updated_by}`}>
          <ActionButton action={save} doneLabel="Saved" failedLabel={failure} variant="quiet" size="compact" disabled={!dirty}>
            Save basics
          </ActionButton>
        </SaveRow>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- capacity */

function Capacity({ event, readOnly, onSaved }: { event: EventRecord; readOnly: boolean; onSaved: (record: EventRecord) => void }) {
  const { venue } = useWorkspaceEvent();
  const rooms = useMemo(() => eventRooms(event, venue.status === "ready" ? venue.data : null), [event, venue.status, venue.data]);
  const saved = useMemo(() => Object.fromEntries(event.rooms.map((r) => [r.room_id, r.capacity_override === null ? "" : String(r.capacity_override)])), [event.rooms]);
  const [values, setValues] = useState<Record<string, string>>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { failure, setFailure, problem, setProblem } = useSaveFailure();

  useEffect(() => setValues(saved), [saved]);

  const dirty = rooms.some((room) => (values[room.id] ?? "") !== (saved[room.id] ?? ""));

  const save = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    for (const room of rooms) {
      const raw = (values[room.id] ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n < 1) found[room.id] = "A whole number of people, at least 1, or leave it empty for the venue's number.";
      else if (n > 100_000) found[room.id] = "That is more than any room holds. Check the number.";
    }
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked rooms");
      throw new Error("VALIDATION");
    }
    try {
      const record = await configure.updateEvent(event.id, {
        rooms: event.rooms.map((r) => {
          const raw = (values[r.room_id] ?? "").trim();
          return { room_id: r.room_id, capacity_override: raw ? Number(raw) : null };
        }),
      });
      setErrors({});
      onSaved(record);
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(`${copy.title}. ${copy.message}`);
      setFailure("Didn't work — try again");
      throw error;
    }
  };

  const total = rooms.reduce((sum, room) => {
    const raw = (values[room.id] ?? "").trim();
    return sum + (raw && /^\d+$/.test(raw) ? Number(raw) : room.venue_capacity);
  }, 0);

  return (
    <section aria-labelledby="settings-capacity" className="flex scroll-mt-4 flex-col gap-3">
      <FormHead
        id="settings-capacity"
        title="Capacity overrides"
        meta={rooms.length > 0 ? <><span className="font-mono tabular-nums">{formatNumber(total)}</span> places in all</> : undefined}
      />
      <p className="text-12 text-muted-foreground">
        A room's capacity comes from the venue. Set a lower (or higher) number here for this event only, for example when a stage
        takes floor space. Leave it empty to use the venue's number. Warning and stop points follow the new number.
      </p>
      {venue.status === "loading" ? <LoadingState label="Loading the rooms…" className="px-0 py-2" /> : null}
      {venue.status === "error" ? <ErrorState title="Could not load the rooms" error={venue.error} onRetry={() => venue.reload()} className="m-0 sm:m-0" /> : null}
      {venue.status === "ready" && rooms.length === 0 ? (
        <p className="text-13 text-muted-foreground">This event uses no rooms yet.</p>
      ) : null}
      {rooms.length > 0 ? (
        <ul className="border-t border-border">
          {rooms.map((room) => {
            const id = `cap-${room.id}`;
            return (
              <li key={room.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-border py-2">
                <label htmlFor={id} className="min-w-0 pt-1.5 text-13">
                  <span className="block truncate">{room.name}</span>
                  <span className="block text-12 text-muted-foreground">
                    Venue: <span className="font-mono tabular-nums">{formatNumber(room.venue_capacity)}</span>
                    {room.continuous ? " · continuous room" : ""}
                  </span>
                </label>
                <div className="w-36">
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    value={values[room.id] ?? ""}
                    placeholder={String(room.venue_capacity)}
                    suffix="people"
                    disabled={readOnly}
                    invalid={Boolean(errors[room.id])}
                    aria-describedby={errors[room.id] ? `${id}-error` : undefined}
                    className="font-mono tabular-nums"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^\d]/g, "");
                      setValues((current) => ({ ...current, [room.id]: next }));
                      if (errors[room.id]) setErrors(({ [room.id]: _gone, ...rest }) => rest);
                    }}
                  />
                </div>
                {errors[room.id] ? (
                  <p id={`${id}-error`} className="col-span-2 text-12 text-destructive">
                    {errors[room.id]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      {readOnly || rooms.length === 0 ? null : (
        <SaveRow dirty={dirty}>
          <ActionButton action={save} doneLabel="Saved" failedLabel={failure} variant="quiet" size="compact" disabled={!dirty}>
            Save capacity
          </ActionButton>
        </SaveRow>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- retention */

const MAX_HOURS = 2160;

function Retention({ event, readOnly, onSaved }: { event: EventRecord; readOnly: boolean; onSaved: (record: EventRecord) => void }) {
  const [value, setValue] = useState(String(event.grace_buffer_hours));
  const [error, setError] = useState<string | null>(null);
  const { failure, setFailure, problem, setProblem } = useSaveFailure();

  useEffect(() => setValue(String(event.grace_buffer_hours)), [event.grace_buffer_hours]);

  const hours = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const dirty = value.trim() !== String(event.grace_buffer_hours);

  const save = async () => {
    setProblem(null);
    if (hours === null || hours > MAX_HOURS) {
      setError(`Enter a whole number of hours from 0 to ${formatNumber(MAX_HOURS)} (90 days).`);
      setFailure("Check the number");
      throw new Error("VALIDATION");
    }
    try {
      const record = await configure.updateEvent(event.id, { grace_buffer_hours: hours });
      setError(null);
      onSaved(record);
    } catch (e) {
      const fields = fieldErrors(e);
      if (fields.grace_buffer_hours) {
        setError(fields.grace_buffer_hours);
        setFailure("Check the number");
      } else {
        const copy = errorCopy(e);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure("Didn't work — try again");
      }
      throw e;
    }
  };

  const days = hours !== null ? hours / 24 : null;
  const span = hours === null ? null : hours === 0 ? "as soon as the event closes" : `${formatNumber(hours)} hours${days !== null && days >= 1 ? ` (${Number.isInteger(days) ? days : days.toFixed(1)} days)` : ""} after the event closes`;
  const due = event.closed_at && hours !== null ? formatDate(new Date(Date.parse(event.closed_at) + hours * 3_600_000).toISOString(), event.timezone) : null;

  return (
    <section aria-labelledby="settings-retention" className="flex scroll-mt-4 flex-col gap-4">
      <FormHead id="settings-retention" title="Retention" />
      <Field label="Grace period before deletion" error={error} className="max-w-60">
        <TextInput
          inputMode="numeric"
          value={value}
          suffix="hours"
          disabled={readOnly}
          className="font-mono tabular-nums"
          onChange={(e) => {
            setValue(e.target.value.replace(/[^\d]/g, ""));
            setError(null);
          }}
        />
      </Field>
      <div className="text-13 text-muted-foreground">
        <p>
          Individual scan records (which pass went through which gate, and when) are deleted{" "}
          <span className="text-foreground">{span ?? "after the grace period"}</span>
          {due ? (
            <>
              , on <span className="font-mono text-foreground tabular-nums">{due}</span>
            </>
          ) : null}
          . The grace period leaves time to settle disputes and export reports.
        </p>
        <p className="mt-2">
          Kept after that: totals, peaks, flows between zones and the event summary. Attendee accounts follow the organisation's
          own retention, not this event's.
        </p>
      </div>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      {readOnly ? null : (
        <SaveRow dirty={dirty}>
          <ActionButton action={save} doneLabel="Saved" failedLabel={failure} variant="quiet" size="compact" disabled={!dirty}>
            Save retention
          </ActionButton>
        </SaveRow>
      )}
    </section>
  );
}
