/**
 * D5 step 1 · Basics: the event's name, web address, description, time zone, dates and whether
 * it is listed on the public site. The address follows the name until it is edited. Dates are
 * entered as wall time in the event's own zone; changing the zone keeps the wall time.
 * The first Continue creates the draft.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { slugify, type EventPatch, type EventRecord } from "@synan/mock/command";
import { Checkbox, Field, TextArea, TextInput } from "@synan/ui/components";
import { DateTimeInput, Notice, TimeZoneSelect, errorCopy, fieldErrors, formatDate, formatDateRange, formatTime, fromLocalInput, linkClass, toLocalInput, zoneLabel } from "../../kit";
import { configure } from "../../live/backend";
import { AsideBlock, StepLayout, StepSection, WizardFooter, focusFirstInvalid, type BasicsForm, type StepContext } from "./shared";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fromRecord(record: EventRecord | null): BasicsForm {
  if (!record) {
    return {
      title: "",
      slug: "",
      slugEdited: false,
      description: "",
      timezone: "Africa/Kampala",
      timezoneSet: false,
      starts_at: null,
      ends_at: null,
      listed: true,
    };
  }
  return {
    title: record.title,
    slug: record.slug,
    slugEdited: record.slug !== slugify(record.title),
    description: record.description,
    timezone: record.timezone,
    timezoneSet: true,
    starts_at: record.starts_at,
    ends_at: record.ends_at,
    listed: record.listed,
  };
}

type Errors = Record<string, string>;

/** `full` = everything Continue needs; otherwise only what a saved draft must have. */
function validate(form: BasicsForm, full: boolean): Errors {
  const errors: Errors = {};
  const title = form.title.trim();
  if (!title) errors.title = "Give the event a name.";
  else if (title.length > 200) errors.title = "Keep the name under 200 characters.";
  if (!form.slug) errors.slug = "Add a web address, e.g. founders-forum-2027.";
  else if (!SLUG_RE.test(form.slug)) errors.slug = "Use lowercase letters, numbers and single hyphens, with no hyphen at either end.";
  if (form.description.length > 2000) errors.description = "Keep the description under 2,000 characters.";
  if (!form.timezone) errors.timezone = "Choose the time zone the event runs in.";
  if (full && !form.starts_at) errors.starts_at = "Set when the event starts.";
  if (full && !form.ends_at) errors.ends_at = "Set when the event ends.";
  if (form.starts_at && form.ends_at && Date.parse(form.ends_at) <= Date.parse(form.starts_at)) {
    errors.ends_at = "The event must end after it starts. Check the end date and time.";
  }
  return errors;
}

export function BasicsStep({ record, forms, setForm, saved, goto, close }: StepContext) {
  const form = forms.basics ?? fromRecord(record);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  const update = (patch: Partial<BasicsForm>, clear: string[] = []) => {
    setForm("basics", { ...form, ...patch });
    if (clear.some((key) => errors[key])) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !clear.includes(key))));
  };

  const latest = useRef(form);
  latest.current = form;

  // A new event starts in the organisation's time zone, unless one was already chosen.
  useEffect(() => {
    if (record || form.timezoneSet) return;
    let cancelled = false;
    configure.setupStatus().then(
      (status) => {
        const zone = status.organization?.timezone;
        const current = latest.current;
        if (cancelled || !zone || current.timezoneSet) return;
        const move = (iso: string | null) => (iso ? fromLocalInput(toLocalInput(iso, current.timezone), zone) : null);
        setForm("basics", { ...current, timezone: zone, timezoneSet: true, starts_at: move(current.starts_at), ends_at: move(current.ends_at) });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchOf = (): EventPatch => ({
    title: form.title.trim(),
    slug: form.slug,
    description: form.description.trim(),
    timezone: form.timezone,
    starts_at: form.starts_at,
    ends_at: form.ends_at,
    listed: form.listed,
  });

  const persist = async (next: "venue" | null): Promise<EventRecord> => {
    setProblem(null);
    const found = validate(form, next !== null);
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirstInvalid();
      throw new Error("VALIDATION");
    }
    setErrors({});
    try {
      const patch = { ...patchOf(), wizard_step: next ?? "basics" } satisfies EventPatch;
      const result = record ? await configure.updateEvent(record.id, patch) : await configure.createDraft(patch);
      saved(result);
      setForm("basics", fromRecord(result));
      return result;
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length) {
        setErrors(fields);
        setFailure("Check the marked fields");
        focusFirstInvalid();
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure(undefined);
      }
      throw error;
    }
  };

  const saveAndClose = async () => {
    // Nothing typed into a new event: there is nothing to keep.
    if (!record && !form.title.trim() && !form.description.trim() && !form.starts_at && !form.ends_at) return close(null);
    const result = await persist(null);
    close(result);
  };

  const changeZone = (zone: string) => {
    // Keep the wall time the user typed; only the zone it is read in changes.
    const move = (iso: string | null) => (iso ? fromLocalInput(toLocalInput(iso, form.timezone), zone) : null);
    update({ timezone: zone, timezoneSet: true, starts_at: move(form.starts_at), ends_at: move(form.ends_at) }, ["timezone"]);
  };

  const zone = zoneLabel(form.timezone, form.starts_at ? Date.parse(form.starts_at) : Date.now());
  const address = form.slug || "your-event";

  return (
    <StepLayout
      asideLabel="How attendees will see it"
      aside={
        <>
          <AsideBlock title="On the public site">
            <p className="font-display text-17 leading-tight">{form.title.trim() || "Your event's name"}</p>
            <p className="mt-1 text-12 text-muted-foreground">
              {form.starts_at && form.ends_at && Date.parse(form.ends_at) > Date.parse(form.starts_at) ? (
                <>
                  <span className="font-mono tabular-nums">{formatDateRange(form.starts_at, form.ends_at, form.timezone)}</span> · doors{" "}
                  <span className="font-mono tabular-nums">{formatTime(form.starts_at, form.timezone)}</span>
                </>
              ) : (
                "Dates not set yet"
              )}
            </p>
            <p className="mt-3 truncate font-mono text-12 text-muted-foreground">…/events/{address}</p>
            <p className="mt-3 pt-2 text-12 text-muted-foreground">
              {form.listed
                ? "Listed: anyone can find it on the public site and register."
                : "Not listed: only people with an invitation link can see it."}
            </p>
          </AsideBlock>
          <AsideBlock title="Next">
            <p className="text-12 leading-relaxed text-muted-foreground">
              Choose the venue and the rooms this event uses, then decide which tier may enter each room.
            </p>
          </AsideBlock>
        </>
      }
    >
      <form noValidate aria-label="Basics" onSubmit={(event: FormEvent) => event.preventDefault()} className="flex flex-col gap-8">
        <StepSection id="basics-what" title="The event">
          <Field label="Name" id="event-title" error={errors.title} hint="As attendees will see it, e.g. Founders Forum 2027.">
            <TextInput
              value={form.title}
              maxLength={200}
              autoComplete="off"
              autoFocus={!record}
              onChange={(event) => {
                const title = event.target.value;
                update({ title, ...(form.slugEdited ? {} : { slug: slugify(title) }) }, form.slugEdited ? ["title"] : ["title", "slug"]);
              }}
            />
          </Field>
          <Field
            label="Web address"
            id="event-slug"
            error={errors.slug}
            hint={
              <>
                The event's page: <span className="font-mono text-foreground/80">…/events/{address}</span>
              </>
            }
            aside={
              form.slugEdited && form.title.trim() ? (
                <button type="button" className={linkClass} onClick={() => update({ slug: slugify(form.title), slugEdited: false }, ["slug"])}>
                  Match the name
                </button>
              ) : undefined
            }
          >
            <TextInput
              value={form.slug}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              onChange={(event) => update({ slug: event.target.value.toLowerCase().replace(/\s+/g, "-"), slugEdited: true }, ["slug"])}
            />
          </Field>
          <Field label="Description" id="event-description" optional error={errors.description} hint="A few lines for the event page. You can change it later.">
            <TextArea value={form.description} rows={4} maxLength={2000} onChange={(event) => update({ description: event.target.value }, ["description"])} />
          </Field>
        </StepSection>

        <StepSection id="basics-when" title="When" meta={zone}>
          <Field label="Time zone" id="event-timezone" error={errors.timezone} hint="Times on passes, schedules and reports are shown in this zone.">
            <TimeZoneSelect value={form.timezone} onChange={changeZone} invalid={Boolean(errors.timezone)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" id="event-starts_at" error={errors.starts_at}>
              <DateTimeInput
                value={form.starts_at}
                timeZone={form.timezone}
                invalid={Boolean(errors.starts_at)}
                onChange={(iso) => update({ starts_at: iso }, ["starts_at", "ends_at"])}
              />
            </Field>
            <Field
              label="Ends"
              id="event-ends_at"
              error={errors.ends_at}
              hint={form.starts_at && form.ends_at ? `${formatDate(form.starts_at, form.timezone, { weekday: true })} to ${formatDate(form.ends_at, form.timezone, { weekday: true })}` : undefined}
            >
              <DateTimeInput
                value={form.ends_at}
                timeZone={form.timezone}
                min={form.starts_at}
                invalid={Boolean(errors.ends_at)}
                onChange={(iso) => update({ ends_at: iso }, ["ends_at"])}
              />
            </Field>
          </div>
        </StepSection>

        <StepSection id="basics-who" title="Who can find it">
          <Checkbox
            label="List on the public site"
            description={form.listed ? "Anyone can find the event and register." : "Unlisted: private, by invitation only. Only people with an invitation link can see it."}
            checked={form.listed}
            onChange={(event) => update({ listed: event.target.checked })}
          />
        </StepSection>

        {problem ? <Notice tone="danger">{problem}</Notice> : null}

        <WizardFooter onSaveClose={saveAndClose} onContinue={async () => goto("venue", (await persist("venue")).id)} failedLabel={failure} />
      </form>
    </StepLayout>
  );
}
