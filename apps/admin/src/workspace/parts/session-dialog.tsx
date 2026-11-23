/**
 * Add or edit one session (D6.2): title, room, start and end in the event's own zone. Checked in
 * the browser first; the server's field messages (an overlap in the same room, a time outside
 * the event) land on the same fields.
 */
import { useEffect, useRef, useState } from "react";
import { ActionButton, Button, Dialog, Field, Select, TextInput } from "@synan/ui/components";
import type { EventSession } from "@synan/contracts/rest";
import type { EventRecord, SessionBody } from "@synan/mock/command";
import { DateTimeInput, Notice, errorCopy, fieldErrors, formatDateRange, zoneLabel } from "../../kit";
import { clock, configure } from "../../live/backend";
import type { EventRoom } from "./context";
import { formatDuration } from "./copy";

type Errors = Partial<Record<keyof SessionBody, string>>;

const HOUR = 3_600_000;

/** A sensible first slot: the next half hour inside the event, else its start. */
function firstSlot(event: EventRecord): { starts: string | null; ends: string | null } {
  if (!event.starts_at || !event.ends_at) return { starts: null, ends: null };
  const start = Date.parse(event.starts_at);
  const end = Date.parse(event.ends_at);
  const next = Math.ceil(clock.now() / (30 * 60_000)) * 30 * 60_000;
  const at = next > start && next + HOUR <= end ? next : start;
  return { starts: new Date(at).toISOString(), ends: new Date(Math.min(at + HOUR, end)).toISOString() };
}

function validate(event: EventRecord, body: { title: string; room_id: string | null; starts_at: string | null; ends_at: string | null }): Errors {
  const errors: Errors = {};
  if (!body.title.trim()) errors.title = "Give the session a title.";
  else if (body.title.trim().length > 200) errors.title = "Keep the title under 200 characters.";
  if (!body.room_id) errors.room_id = "Choose the room it is held in.";
  if (!body.starts_at) errors.starts_at = "Set when the session starts.";
  if (!body.ends_at) errors.ends_at = "Set when the session ends.";
  if (body.starts_at && body.ends_at) {
    const s = Date.parse(body.starts_at);
    const e = Date.parse(body.ends_at);
    if (e <= s) errors.ends_at = "The session must end after it starts.";
    else if (event.starts_at && event.ends_at && (s < Date.parse(event.starts_at) || e > Date.parse(event.ends_at))) {
      errors.starts_at = `Sessions must fall within the event: ${formatDateRange(event.starts_at, event.ends_at, event.timezone)}.`;
    }
  }
  return errors;
}

export function SessionDialog({
  open,
  event,
  rooms,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: EventRecord;
  rooms: EventRoom[];
  /** The session being edited; null to add one. */
  session: EventSession | null;
  onClose: () => void;
  onSaved: (session: EventSession, created: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [starts, setStarts] = useState<string | null>(null);
  const [ends, setEnds] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState("Didn't work — try again");
  const closeTimer = useRef<number | null>(null);

  // Fill the form each time it opens (not when the parent re-renders while it is open).
  const fill = useRef({ event, rooms, session });
  fill.current = { event, rooms, session };
  useEffect(() => {
    if (!open) return;
    const { event, rooms, session } = fill.current;
    if (session) {
      setTitle(session.title);
      setRoomId(session.room_id);
      setStarts(session.starts_at);
      setEnds(session.ends_at);
    } else {
      const slot = firstSlot(event);
      setTitle("");
      setRoomId(rooms.length === 1 ? (rooms[0]?.id ?? null) : null);
      setStarts(slot.starts);
      setEnds(slot.ends);
    }
    setErrors({});
    setProblem(null);
  }, [open, session?.id]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const clear = (key: keyof SessionBody) => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const save = async () => {
    setProblem(null);
    const found = validate(event, { title, room_id: roomId, starts_at: starts, ends_at: ends });
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFailure("Check the marked fields");
      throw new Error("VALIDATION");
    }
    const body: SessionBody = { title: title.trim(), room_id: roomId as string, starts_at: starts as string, ends_at: ends as string };
    try {
      const saved = session ? await configure.updateSession(event.id, session.id, body) : await configure.createSession(event.id, body);
      closeTimer.current = window.setTimeout(() => onSaved(saved, session === null), 450);
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) {
        setErrors(fields as Errors);
        setFailure("Check the marked fields");
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure("Didn't work — try again");
      }
      throw error;
    }
  };

  const length = starts && ends && Date.parse(ends) > Date.parse(starts) ? formatDuration(Date.parse(ends) - Date.parse(starts)) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={session ? "Edit session" : "Add session"}
      description={`Times are in the event's zone, ${zoneLabel(event.timezone)}.`}
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <ActionButton
            action={save}
            doneLabel={session ? "Saved" : "Added"}
            failedLabel={failure}
            variant="primary"
            size="compact"
          >
            {session ? "Save session" : "Add session"}
          </ActionButton>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4 px-5 py-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label={session ? "Edit session" : "Add session"}
      >
        <Field label="Title" error={errors.title}>
          <TextInput
            value={title}
            maxLength={200}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
              clear("title");
            }}
          />
        </Field>
        <Field label="Room" error={errors.room_id} hint={rooms.length === 0 ? "This event uses no rooms yet." : undefined}>
          <Select
            options={rooms.map((room) => ({ value: room.id, label: room.name, meta: `${room.capacity} places` }))}
            value={roomId}
            onChange={(value) => {
              setRoomId(value);
              clear("room_id");
            }}
            placeholder="Choose a room"
            invalid={Boolean(errors.room_id)}
            disabled={rooms.length === 0}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" error={errors.starts_at}>
            <DateTimeInput
              value={starts}
              timeZone={event.timezone}
              min={event.starts_at}
              max={event.ends_at}
              invalid={Boolean(errors.starts_at)}
              onChange={(iso) => {
                // Moving the start keeps the length, so the end follows.
                if (iso && starts && ends && Date.parse(ends) > Date.parse(starts)) {
                  setEnds(new Date(Date.parse(iso) + (Date.parse(ends) - Date.parse(starts))).toISOString());
                }
                setStarts(iso);
                clear("starts_at");
              }}
            />
          </Field>
          <Field label="Ends" error={errors.ends_at} aside={length ? <span className="font-mono tabular-nums">{length}</span> : undefined}>
            <DateTimeInput
              value={ends}
              timeZone={event.timezone}
              min={starts ?? event.starts_at}
              max={event.ends_at}
              invalid={Boolean(errors.ends_at)}
              onChange={(iso) => {
                setEnds(iso);
                clear("ends_at");
              }}
            />
          </Field>
        </div>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
      </form>
    </Dialog>
  );
}
