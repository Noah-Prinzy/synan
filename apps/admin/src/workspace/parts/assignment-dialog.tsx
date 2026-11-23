/**
 * Assign a staff member to a gate for a shift (D6.6, docs/01 §3 P-15). The shift decides which
 * gate their scanner may pair with and which offline allowlist it caches. Only security staff
 * operate a gate scanner, so they come first; other roles are listed but cannot be chosen.
 * An overlapping shift for the same person is refused with the server's own sentence.
 */
import { useEffect, useRef, useState } from "react";
import { ActionButton, Button, Dialog, Field, Select } from "@synan/ui/components";
import type { Checkpoint } from "@synan/contracts/rest";
import type { AssignmentRow, EventRecord, StaffRow } from "@synan/mock/command";
import { DateTimeInput, Notice, errorCopy, fieldErrors, zoneLabel } from "../../kit";
import { clock, configure } from "../../live/backend";
import { ROLE_LABEL, formatDuration } from "./copy";

type Errors = { user_id?: string; checkpoint_id?: string; shift?: string };

const HOUR = 3_600_000;

function defaultShift(event: EventRecord): { start: string | null; end: string | null } {
  const now = Math.ceil(clock.now() / HOUR) * HOUR;
  // Doors open about an hour before the event starts; staff are on the gate by then.
  const opening = event.starts_at ? Date.parse(event.starts_at) - HOUR : now;
  const start = Math.max(now, opening);
  return { start: new Date(start).toISOString(), end: new Date(start + 6 * HOUR).toISOString() };
}

const DIRECTION = { in: "Entry", out: "Exit", both: "Entry and exit" } as const;

export function AssignmentDialog({
  open,
  event,
  staff,
  gates,
  onClose,
  onCreated,
}: {
  open: boolean;
  event: EventRecord;
  staff: StaffRow[];
  gates: Checkpoint[];
  onClose: () => void;
  onCreated: (row: AssignmentRow) => void;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState("Didn't work — try again");
  const timer = useRef<number | null>(null);
  const latest = useRef(event);
  latest.current = event;

  useEffect(() => {
    if (!open) return;
    const shift = defaultShift(latest.current);
    setUserId(null);
    setGateId(null);
    setStart(shift.start);
    setEnd(shift.end);
    setErrors({});
    setProblem(null);
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const ordered = [...staff].sort((a, b) => {
    const rank = (s: StaffRow) => (s.role === "security_staff" ? 0 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  const save = async () => {
    setProblem(null);
    const found: Errors = {};
    if (!userId) found.user_id = "Choose who works this shift.";
    if (!gateId) found.checkpoint_id = "Choose the gate they work at.";
    if (!start || !end) found.shift = "Set when the shift starts and ends.";
    else if (Date.parse(end) <= Date.parse(start)) found.shift = "The shift must end after it starts.";
    else if (Date.parse(end) - Date.parse(start) > 16 * HOUR) found.shift = "Keep a shift to 16 hours or less; add a second shift for the next person.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFailure("Check the marked fields");
      throw new Error("VALIDATION");
    }
    try {
      const row = await configure.createAssignment(event.id, {
        user_id: userId as string,
        checkpoint_id: gateId as string,
        shift_start: start as string,
        shift_end: end as string,
      });
      timer.current = window.setTimeout(() => onCreated(row), 450);
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setFailure(fields.shift && Object.keys(fields).length === 1 ? "Shift overlaps" : "Check the marked fields");
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure("Didn't work — try again");
      }
      throw error;
    }
  };

  const length = start && end && Date.parse(end) > Date.parse(start) ? formatDuration(Date.parse(end) - Date.parse(start)) : null;
  const clear = (key: keyof Errors) => errors[key] && setErrors(({ [key]: _gone, ...rest }) => rest);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign staff to a gate"
      description={`The shift sets which gate their scanner may pair with. Times in ${zoneLabel(event.timezone)}.`}
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <ActionButton action={save} doneLabel="Assigned" failedLabel={failure} variant="primary" size="compact">
            Assign
          </ActionButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()} aria-label="Assign staff to a gate" className="flex flex-col gap-4 px-5 py-4">
        <Field label="Staff member" error={errors.user_id}>
          <Select
            options={ordered.map((s) => ({
              value: s.id,
              label: s.name,
              meta: ROLE_LABEL[s.role],
              description: s.role === "security_staff" ? (s.mfa_enrolled ? undefined : "No second factor yet") : "Only security staff operate a gate scanner",
              disabled: s.role !== "security_staff",
            }))}
            value={userId}
            onChange={(value) => {
              setUserId(value);
              clear("user_id");
              clear("shift");
            }}
            placeholder="Choose a person"
            invalid={Boolean(errors.user_id)}
            listMinWidth={300}
          />
        </Field>
        <Field label="Gate" error={errors.checkpoint_id} hint={gates.length === 0 ? "This venue has no gates yet. Add them in the venue editor." : undefined}>
          <Select
            options={gates.map((g) => ({
              value: g.id,
              label: g.label,
              meta: DIRECTION[g.direction],
              description: g.perimeter ? "Perimeter: passes and bands" : "Interior: bands only",
            }))}
            value={gateId}
            onChange={(value) => {
              setGateId(value);
              clear("checkpoint_id");
            }}
            placeholder="Choose a gate"
            invalid={Boolean(errors.checkpoint_id)}
            disabled={gates.length === 0}
            listMinWidth={280}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.shift ? "shift-error" : undefined}>
          <legend className="sr-only">Shift</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shift starts">
              <DateTimeInput
                value={start}
                timeZone={event.timezone}
                invalid={Boolean(errors.shift)}
                onChange={(iso) => {
                  if (iso && start && end && Date.parse(end) > Date.parse(start)) {
                    setEnd(new Date(Date.parse(iso) + (Date.parse(end) - Date.parse(start))).toISOString());
                  }
                  setStart(iso);
                  clear("shift");
                }}
              />
            </Field>
            <Field label="Shift ends" aside={length ? <span className="font-mono tabular-nums">{length}</span> : undefined}>
              <DateTimeInput
                value={end}
                timeZone={event.timezone}
                min={start}
                invalid={Boolean(errors.shift)}
                onChange={(iso) => {
                  setEnd(iso);
                  clear("shift");
                }}
              />
            </Field>
          </div>
          {errors.shift ? (
            <p id="shift-error" role="alert" className="text-12 text-destructive">
              {errors.shift}
            </p>
          ) : null}
        </fieldset>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
      </form>
    </Dialog>
  );
}
