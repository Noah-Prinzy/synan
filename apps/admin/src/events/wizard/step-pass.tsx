/**
 * D5 step 4 · Pass template: the headline and note on the attendee's pass, and whether it shows
 * the tier, the attendee's sessions and an Add to Wallet row. A live preview sits beside the
 * form from 1024 wide (stacked below it on smaller screens), previewable as any tier.
 */
import { useState, type FormEvent } from "react";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { EventRecord, VenueDetail } from "@synan/mock/command";
import { Checkbox, Field, TextArea, TextInput } from "@synan/ui/components";
import { FilterChips, GUTTER_X, Notice, PROSE, TIER_LABEL, TIER_ORDER, errorCopy, formatDateRange, useResource } from "../../kit";
import { configure } from "../../live/backend";
import { PassPreview } from "../parts/pass-preview";
import { StepSection, WizardFooter, defaultPass, focusFirstInvalid, type PassForm, type StepContext } from "./shared";

type Errors = Record<string, string>;

function validate(form: PassForm): Errors {
  const errors: Errors = {};
  if (!form.headline.trim()) errors.headline = "Add a headline, for example the event's name.";
  else if (form.headline.trim().length > 80) errors.headline = "Keep the headline under 80 characters so it fits on a phone.";
  if (form.note.trim().length > 160) errors.note = "Keep the note under 160 characters.";
  return errors;
}

export function PassStep({ record, forms, setForm, saved, goto, close, loadVenue }: StepContext & { record: EventRecord }) {
  const form = forms.pass ?? record.pass_template ?? defaultPass(record.title);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [tier, setTier] = useState<AttendeeTier>("ORDINARY");
  const venue = useResource<VenueDetail | null>(() => (record.venue_id ? loadVenue(record.venue_id) : Promise.resolve(null)), [record.venue_id]);

  const update = (patch: Partial<PassForm>, clear: string[] = []) => {
    setForm("pass", { ...form, ...patch });
    if (clear.some((key) => errors[key])) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !clear.includes(key))));
  };

  const persist = async (next: "review" | null): Promise<EventRecord> => {
    setProblem(null);
    const found = validate(form);
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirstInvalid();
      throw new Error("VALIDATION");
    }
    setErrors({});
    try {
      const result = await configure.updateEvent(record.id, {
        pass_template: { ...form, headline: form.headline.trim(), note: form.note.trim() },
        wizard_step: next ?? "pass",
      });
      saved(result);
      setForm("pass", undefined);
      return result;
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(`${copy.title}. ${copy.message}`);
      setFailure(undefined);
      throw error;
    }
  };

  const venueName = venue.status === "ready" && venue.data ? venue.data.venue.name : null;

  return (
    <div className={`grid grid-cols-1 gap-8 py-6 lg:grid-cols-[minmax(0,40rem)_20rem] lg:gap-10 xl:gap-14 2xl:gap-16 ${GUTTER_X}`}>
      <form noValidate aria-label="Pass template" onSubmit={(event: FormEvent) => event.preventDefault()} className="flex min-w-0 flex-col gap-8">
        <p className={`text-13 text-muted-foreground ${PROSE}`}>
          Every attendee carries this pass on their phone and gets it by email. The code on it is unique to them and changes every minute.
        </p>
        <StepSection id="pass-words" title="On the pass">
          <Field label="Headline" id="pass-headline" error={errors.headline} hint="The large line under the event's name." aside={`${form.headline.length}/80`}>
            <TextInput value={form.headline} maxLength={80} onChange={(event) => update({ headline: event.target.value }, ["headline"])} />
          </Field>
          <Field label="Note" id="pass-note" optional error={errors.note} hint="One short instruction under the code, e.g. where to collect wristbands." aside={`${form.note.length}/160`}>
            <TextArea value={form.note} rows={2} maxLength={160} onChange={(event) => update({ note: event.target.value }, ["note"])} />
          </Field>
        </StepSection>
        <StepSection id="pass-shows" title="Also show">
          <div className="flex flex-col gap-4">
            <Checkbox
              label="The attendee's tier"
              description="Helps staff at a door see at a glance who the pass is for. The gate decides from the server, never from the pass."
              checked={form.show_tier}
              onChange={(event) => update({ show_tier: event.target.checked })}
            />
            <Checkbox
              label="Their sessions"
              description="A link to the sessions they booked, from the event's schedule."
              checked={form.show_sessions}
              onChange={(event) => update({ show_sessions: event.target.checked })}
            />
            <Checkbox
              label="Add to Wallet"
              description="Lets attendees keep the pass in Apple Wallet or Google Wallet."
              checked={form.wallet}
              onChange={(event) => update({ wallet: event.target.checked })}
            />
          </div>
        </StepSection>

        {problem ? <Notice tone="danger">{problem}</Notice> : null}

        <WizardFooter
          onBack={() => goto("access")}
          onSaveClose={async () => close(await persist(null))}
          onContinue={async () => goto("review", (await persist("review")).id)}
          failedLabel={failure}
        />
      </form>

      <aside aria-label="Pass preview" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-baseline justify-between gap-3 pb-2">
          <h2 className="text-13 font-medium">Preview</h2>
          <span className="text-12 text-muted-foreground">Sample attendee</span>
        </div>
        {form.show_tier ? (
          <div className="mb-3">
            <FilterChips<AttendeeTier>
              label="Preview as tier"
              value={tier}
              onChange={setTier}
              options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
            />
          </div>
        ) : null}
        <PassPreview
          template={form}
          eventTitle={record.title}
          dates={formatDateRange(record.starts_at, record.ends_at, record.timezone)}
          venue={venueName}
          tier={tier}
        />
      </aside>
    </div>
  );
}
