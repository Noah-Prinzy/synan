/**
 * D5 step 2 · Venue & rooms: choose the venue, then the rooms this event uses, grouped by zone,
 * each with the venue's capacity and an optional capacity for this event only. Changing the
 * venue clears the chosen rooms (and, once saved, the access rules), so it asks first.
 */
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCan } from "../../access/session";
import type { Room } from "@synan/contracts/rest";
import type { EventRecord, VenueDetail, VenueRow } from "@synan/mock/command";
import { Button, Checkbox, Dialog, Field, Select, TextInput, cn, type SelectOption } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import { ErrorState, LoadingState, Notice, errorCopy, fieldErrors, linkClass, useResource } from "../../kit";
import { configure } from "../../live/backend";
import { AsideBlock, StepLayout, StepSection, WizardFooter, focusFirstInvalid, type StepContext, type VenueForm } from "./shared";

function fromRecord(record: EventRecord): VenueForm {
  return {
    venue_id: record.venue_id,
    rooms: record.rooms.map((room) => ({ room_id: room.room_id, override: room.capacity_override === null ? "" : String(room.capacity_override) })),
  };
}

type Errors = Record<string, string>;

function validate(form: VenueForm, full: boolean): Errors {
  const errors: Errors = {};
  if (full && !form.venue_id) errors.venue_id = "Choose the venue the event is held in.";
  if (full && form.venue_id && form.rooms.length === 0) errors.rooms = "Pick at least one room this event uses.";
  for (const room of form.rooms) {
    const value = room.override.trim();
    if (!value) continue;
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < 1) errors[`room:${room.room_id}`] = "A whole number of people, at least 1, or leave it empty.";
    else if (n > 100_000) errors[`room:${room.room_id}`] = "That is more than any room holds. Check the number.";
  }
  return errors;
}

interface ZoneGroup {
  id: string;
  label: string;
  rooms: Room[];
}

function zoneGroups(venue: VenueDetail): ZoneGroup[] {
  const manyFloors = venue.floors.length > 1;
  const groups: ZoneGroup[] = venue.zones.map((zone) => ({
    id: zone.id,
    label: manyFloors && zone.floor ? `${zone.floor} · ${zone.name}` : zone.name,
    rooms: venue.rooms.filter((room) => room.zone_id === zone.id),
  }));
  const loose = venue.rooms.filter((room) => !venue.zones.some((zone) => zone.id === room.zone_id));
  if (loose.length) groups.push({ id: "__loose", label: "Other rooms", rooms: loose });
  return groups.filter((group) => group.rooms.length > 0);
}

export function VenueStep({ record, forms, setForm, saved, goto, close, loadVenue }: StepContext & { record: EventRecord }) {
  const form = forms.venue ?? fromRecord(record);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingVenue, setPendingVenue] = useState<string | null>(null);

  const venues = useResource(() => configure.venues(), []);
  // Venues are an admin's (D-23): an organiser picks one but is not offered to create or draw one.
  const canEditVenues = useCan()("venues.edit");
  const detail = useResource<VenueDetail | null>(() => (form.venue_id ? loadVenue(form.venue_id) : Promise.resolve(null)), [form.venue_id]);

  const update = (next: VenueForm, clear: string[] = []) => {
    setForm("venue", next);
    if (clear.some((key) => errors[key])) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !clear.includes(key))));
  };

  const chooseVenue = (id: string) => {
    if (id === form.venue_id) return;
    if (form.rooms.length > 0) setPendingVenue(id);
    else update({ venue_id: id, rooms: [] }, ["venue_id", "rooms"]);
  };

  const picked = useMemo(() => new Map(form.rooms.map((room) => [room.room_id, room])), [form.rooms]);

  const setPicked = (roomIds: string[], on: boolean) => {
    const ids = new Set(roomIds);
    const rest = form.rooms.filter((room) => !ids.has(room.room_id));
    const added = on ? roomIds.map((id) => picked.get(id) ?? { room_id: id, override: "" }) : [];
    // Keep the venue's room order.
    const order = detail.status === "ready" && detail.data ? detail.data.rooms.map((room) => room.id) : [];
    const rooms = [...rest, ...added].sort((a, b) => order.indexOf(a.room_id) - order.indexOf(b.room_id));
    update({ ...form, rooms }, ["rooms", ...roomIds.map((id) => `room:${id}`)]);
  };

  const setOverride = (roomId: string, value: string) => {
    update({ ...form, rooms: form.rooms.map((room) => (room.room_id === roomId ? { ...room, override: value.replace(/[^\d]/g, "") } : room)) }, [`room:${roomId}`]);
  };

  const persist = async (next: "access" | null): Promise<EventRecord> => {
    setProblem(null);
    const found = validate(form, next !== null);
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirstInvalid();
      throw new Error("VALIDATION");
    }
    setErrors({});
    const venueChanged = form.venue_id !== record.venue_id;
    try {
      const result = await configure.updateEvent(record.id, {
        venue_id: form.venue_id,
        rooms: form.rooms.map((room) => ({ room_id: room.room_id, capacity_override: room.override.trim() ? Number(room.override) : null })),
        wizard_step: next ?? "venue",
      });
      saved(result);
      setForm("venue", fromRecord(result));
      // A new venue starts the access rules again (the server cleared them).
      if (venueChanged) setForm("access", undefined);
      return result;
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length) {
        setErrors(fields);
        setFailure("Check the marked fields");
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure(undefined);
      }
      throw error;
    }
  };

  const venueRows = venues.status === "ready" ? venues.data : [];
  const options: SelectOption[] = venueRows.map((row: VenueRow) => ({
    value: row.venue.id,
    label: row.venue.name,
    description: row.venue.city ?? undefined,
    meta: row.rooms === 0 ? "no rooms yet" : `${row.rooms} ${row.rooms === 1 ? "room" : "rooms"}`,
    disabled: row.rooms === 0 && row.venue.id !== form.venue_id,
  }));
  const chosenRow = venueRows.find((row) => row.venue.id === form.venue_id) ?? null;
  const pendingRow = venueRows.find((row) => row.venue.id === pendingVenue) ?? null;

  const venue = detail.status === "ready" ? detail.data : null;
  const groups = venue ? zoneGroups(venue) : [];
  const total = venue
    ? form.rooms.reduce((sum, room) => {
        const base = venue.rooms.find((r) => r.id === room.room_id)?.capacity ?? 0;
        const override = room.override.trim() ? Number(room.override) : null;
        return sum + (override ?? base);
      }, 0)
    : 0;
  const allIds = venue ? venue.rooms.map((room) => room.id) : [];
  const allPicked = allIds.length > 0 && allIds.every((id) => picked.has(id));

  return (
    <StepLayout
      asideLabel="This event's rooms"
      aside={
        <>
          <AsideBlock title="This event">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 text-13">
              <dt className="text-muted-foreground">Venue</dt>
              <dd className="text-right">{chosenRow?.venue.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Rooms</dt>
              <dd className="text-right font-mono tabular-nums">{formatNumber(form.rooms.length)}</dd>
              <dt className="text-muted-foreground">Places in total</dt>
              <dd className="text-right font-mono tabular-nums">{formatNumber(total)}</dd>
            </dl>
          </AsideBlock>
          <AsideBlock title="Capacity">
            <p className="text-12 leading-relaxed text-muted-foreground">
              Each room keeps the capacity drawn for the venue. Set a lower number here when this event seats fewer people, for
              example a cabaret layout. The gates stop entry at that number.
            </p>
          </AsideBlock>
        </>
      }
    >
      <form noValidate aria-label="Venue and rooms" onSubmit={(event: FormEvent) => event.preventDefault()} className="flex flex-col gap-6">
        <StepSection id="venue-where" title="Where">
          {venues.status === "loading" ? <LoadingState label="Loading venues…" className="px-0 py-2 sm:px-0" /> : null}
          {venues.status === "error" ? <ErrorState title="Could not load the venues" error={venues.error} onRetry={() => venues.reload()} className="m-0 sm:m-0" /> : null}
          {venues.status === "ready" && venueRows.length === 0 ? (
            <Notice>
              <span>
                There are no venues yet.{" "}
                {canEditVenues ? (
                  <>
                    <Link to="/venues/new" className={linkClass}>
                      Create a venue
                    </Link>{" "}
                    first; your draft is kept.
                  </>
                ) : (
                  "An admin sets up venues; your draft is kept until one is ready."
                )}
              </span>
            </Notice>
          ) : null}
          {venues.status === "ready" && venueRows.length > 0 ? (
            <Field
              label="Venue"
              id="event-venue_id"
              error={errors.venue_id}
              hint="Venues with no rooms drawn yet cannot be chosen."
              aside={
                canEditVenues ? (
                  <Link to="/venues/new" className={linkClass}>
                    New venue
                  </Link>
                ) : undefined
              }
            >
              <Select options={options} value={form.venue_id} onChange={chooseVenue} placeholder="Choose a venue" invalid={Boolean(errors.venue_id)} />
            </Field>
          ) : null}
        </StepSection>

        {form.venue_id ? (
          <StepSection
            id="venue-rooms"
            title="Rooms this event uses"
            meta={
              venue ? (
                <>
                  <span className="font-mono tabular-nums">{form.rooms.length}</span> of <span className="font-mono tabular-nums">{venue.rooms.length}</span> chosen
                </>
              ) : undefined
            }
          >
            {detail.status === "loading" ? <LoadingState label="Loading the venue's rooms…" rows={4} className="px-0 py-2 sm:px-0" /> : null}
            {detail.status === "error" ? <ErrorState title="Could not load the venue's rooms" error={detail.error} onRetry={() => detail.reload()} className="m-0 sm:m-0" /> : null}
            {venue && venue.rooms.length === 0 ? (
              <Notice tone="warning">
                <span>
                  {venue.venue.name} has no rooms drawn yet.{" "}
                  {canEditVenues ? (
                    <>
                      <Link to={`/venues/${venue.venue.id}?edit=1`} className={linkClass}>
                        Draw its rooms
                      </Link>
                      , then come back to this draft.
                    </>
                  ) : (
                    "Ask an admin to draw its rooms, then come back to this draft."
                  )}
                </span>
              </Notice>
            ) : null}
            {venue && venue.rooms.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className={cn("text-12", errors.rooms ? "text-destructive" : "text-muted-foreground")} id="rooms-message">
                    {errors.rooms ?? "Tick each room the event uses. Capacity for this event is optional."}
                  </p>
                  <Button variant="quiet" size="compact" className="-mr-3 shrink-0" onClick={() => setPicked(allIds, !allPicked)}>
                    {allPicked ? "Clear all" : "Select all rooms"}
                  </Button>
                </div>
                <div role="group" aria-labelledby="venue-rooms" aria-describedby="rooms-message" className="border-t border-border">
                  <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_4.5rem_7.5rem] items-center gap-3 border-b border-border py-1.5 text-11 text-muted-foreground">
                    <span>Room</span>
                    <span className="text-right">Venue</span>
                    <span>For this event</span>
                  </div>
                  {groups.map((group) => {
                    const ids = group.rooms.map((room) => room.id);
                    const count = ids.filter((id) => picked.has(id)).length;
                    const all = count === ids.length;
                    return (
                      <fieldset key={group.id} className="min-w-0">
                        <legend className="sr-only">{group.label}</legend>
                        <div className="flex h-8 items-center justify-between gap-3 border-b border-border bg-foreground/2.5 pl-2">
                          <span aria-hidden="true" className="text-11 text-muted-foreground">
                            {group.label}{" "}
                            <span className="font-mono tabular-nums">
                              · {count}/{ids.length}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setPicked(ids, !all)}
                            className="px-2 text-11 text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-brand pointer-coarse:py-3"
                          >
                            {all ? "Clear" : "Select all"}
                            <span className="sr-only"> in {group.label}</span>
                          </button>
                        </div>
                        {group.rooms.map((room) => {
                          const choice = picked.get(room.id);
                          const error = errors[`room:${room.id}`];
                          return (
                            <div key={room.id} className="border-b border-border">
                              <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_4.5rem_7.5rem] items-center gap-3 py-1">
                                <Checkbox
                                  label={room.name}
                                  checked={Boolean(choice)}
                                  onChange={(event) => setPicked([room.id], event.target.checked)}
                                  className="min-w-0 pl-2"
                                />
                                <span className="text-right font-mono text-12 text-muted-foreground tabular-nums">{formatNumber(room.capacity)}</span>
                                <TextInput
                                  aria-label={`Capacity of ${room.name} for this event`}
                                  aria-invalid={error ? true : undefined}
                                  aria-describedby={error ? `cap-${room.id}-error` : undefined}
                                  invalid={Boolean(error)}
                                  disabled={!choice}
                                  inputMode="numeric"
                                  placeholder={choice ? String(room.capacity) : "—"}
                                  value={choice?.override ?? ""}
                                  onChange={(event) => setOverride(room.id, event.target.value)}
                                  className="font-mono tabular-nums"
                                />
                              </div>
                              {error ? (
                                <p id={`cap-${room.id}-error`} className="pb-1.5 pl-8 text-12 text-destructive">
                                  {error}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </fieldset>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </StepSection>
        ) : null}

        {problem ? <Notice tone="danger">{problem}</Notice> : null}

        <WizardFooter
          onBack={() => goto("basics")}
          onSaveClose={async () => close(await persist(null))}
          onContinue={async () => goto("access", (await persist("access")).id)}
          failedLabel={failure}
        />
      </form>

      <Dialog
        open={pendingVenue !== null}
        onClose={() => setPendingVenue(null)}
        title="Change the venue?"
        description={`The ${form.rooms.length} ${form.rooms.length === 1 ? "room" : "rooms"} chosen at ${chosenRow?.venue.name ?? "this venue"} will be cleared${record.venue_id ? ", and the access rules start again once you continue" : ""}.`}
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setPendingVenue(null)}>
              Keep {chosenRow?.venue.name ?? "this venue"}
            </Button>
            <Button
              variant="primary"
              size="compact"
              onClick={() => {
                if (pendingVenue) update({ venue_id: pendingVenue, rooms: [] }, ["venue_id", "rooms"]);
                setPendingVenue(null);
              }}
            >
              Use {pendingRow?.venue.name ?? "the new venue"}
            </Button>
          </>
        }
      />
    </StepLayout>
  );
}
