/**
 * D0 · First run `/setup` (docs/06 §2.3): the first thing a new customer sees. Outside the
 * shell (no top bar), one centred column, the wordmark once at the top. Three steps with the
 * kit Stepper: Organisation (name, time zone, support email) → Venue (name, city, floors, time
 * zone) → Done, which hands off to drawing the venue (D3) or creating the first event (D5).
 *
 * Reachable only while the organisation has no published venue: otherwise a calm "Setup is
 * done" page with the ways on. If the organisation already exists it is prefilled and the
 * flow starts at the venue. Try it with `?setup=fresh`.
 *
 * States: loading, error with retry, setup done, the three steps.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Organization, Venue } from "@synan/contracts/rest";
import type { SetupStatus, VenueRow } from "@synan/mock/command";
import { Wordmark } from "@synan/ui/brand";
import { ActionButton, Field, RewardMoment, TextInput, buttonClass } from "@synan/ui/components";
import { ErrorState, LoadingState, Notice, Stepper, TimeZoneSelect, errorCopy, fieldErrors, linkClass, useDocumentTitle, useResource } from "../kit";
import { configure } from "../live/backend";

type Step = "organisation" | "venue" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "organisation", label: "Organisation" },
  { key: "venue", label: "Venue" },
  { key: "done", label: "Done" },
];

type Errors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseFloors(text: string): string[] {
  return text
    .split(",")
    .map((floor) => floor.trim())
    .filter(Boolean);
}

function focusFirstInvalid() {
  window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-setup] [aria-invalid='true']")?.focus());
}

export default function FirstRun() {
  useDocumentTitle("Welcome");
  const status = useResource<{ setup: SetupStatus; venues: VenueRow[] }>(async () => {
    const [setup, venues] = await Promise.all([configure.setupStatus(), configure.venues()]);
    return { setup, venues };
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground" data-setup>
      <main className="mx-auto w-full max-w-160 px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <p className="text-21">
          <Wordmark />
        </p>
        {status.status === "loading" ? <LoadingState label="Getting things ready…" className="px-0 sm:px-0" /> : null}
        {status.status === "error" ? (
          <ErrorState title="Could not start setup" error={status.error} onRetry={() => status.reload()} className="mx-0 sm:mx-0" />
        ) : null}
        {status.status === "ready" ? (
          status.data.setup.has_published_venue ? (
            <SetupDone organization={status.data.setup.organization} />
          ) : (
            <SetupFlow organization={status.data.setup.organization} venues={status.data.venues} />
          )
        ) : null}
      </main>
    </div>
  );
}

function SetupDone({ organization }: { organization: Organization | null }) {
  return (
    <section aria-labelledby="setup-done" className="mt-10">
      <h1 id="setup-done" className="font-display text-40 leading-tight tracking-tight">
        Setup is done
      </h1>
      <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">
        {organization ? `${organization.name} is set up, ` : "Your organisation is set up, "}
        with a venue ready for events. Everything from here lives in Command.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link to="/" className={buttonClass("primary", "compact")}>
          Open the Command Center
        </Link>
        <Link to="/events" className={buttonClass("secondary", "compact")}>
          Events
        </Link>
      </div>
    </section>
  );
}

function SetupFlow({ organization: existing, venues }: { organization: Organization | null; venues: VenueRow[] }) {
  const [organization, setOrganization] = useState<Organization | null>(existing);
  const [step, setStep] = useState<Step>(existing ? "venue" : "organisation");
  const [reached, setReached] = useState(existing ? 1 : 0);
  const [venue, setVenue] = useState<Venue | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const go = (next: Step) => {
    const index = STEPS.findIndex((s) => s.key === next);
    setReached((current) => Math.max(current, index));
    setStep(next);
  };

  // Move focus to the new step's heading, so keyboard and screen reader users land in it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const titles: Record<Step, { title: string; lead: ReactNode }> = {
    organisation: {
      title: "Welcome. Let's set up your organisation.",
      lead: "Two short steps: who you are, then the first building you run events in. It takes about two minutes, and you can change all of it later.",
    },
    venue: {
      title: existing && !venue ? `Welcome back${organization ? `, ${organization.name}` : ""}.` : "Now, your first venue.",
      lead: "The building your events happen in. Name it and list its floors; next you draw its rooms on a simple grid.",
    },
    done: {
      title: "You're ready.",
      lead: null,
    },
  };

  return (
    <div className="mt-10">
      <h1 ref={heading} tabIndex={-1} className="font-display text-28 leading-tight tracking-tight text-balance outline-none sm:text-40">
        {titles[step].title}
      </h1>
      {titles[step].lead ? <p className="mt-3 text-15 leading-relaxed text-muted-foreground">{titles[step].lead}</p> : null}

      <Stepper
        className="mt-8 border-t"
        label="Setup steps"
        steps={STEPS}
        current={step}
        reached={step === "done" ? 2 : Math.min(reached, 1)}
        onStep={step === "done" ? undefined : (key) => setStep(key as Step)}
      />

      {step === "organisation" ? (
        <OrganisationStep
          organization={organization}
          onDone={(org) => {
            setOrganization(org);
            go("venue");
          }}
        />
      ) : null}
      {step === "venue" ? (
        <VenueStep
          timezone={organization?.timezone ?? "Africa/Kampala"}
          venues={venues}
          onDone={(created) => {
            setVenue(created);
            go("done");
          }}
        />
      ) : null}
      {step === "done" && venue ? <DoneStep organization={organization} venue={venue} /> : null}
    </div>
  );
}

function OrganisationStep({ organization, onDone }: { organization: Organization | null; onDone: (organization: Organization) => void }) {
  const [name, setName] = useState(organization?.name ?? "");
  const [timezone, setTimezone] = useState(organization?.timezone ?? "Africa/Kampala");
  const [email, setEmail] = useState(organization?.support_email ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  const clear = (key: string) => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const save = async () => {
    setProblem(null);
    const found: Errors = {};
    if (!name.trim()) found.name = "Add your organisation's name, as attendees know it.";
    else if (name.trim().length > 200) found.name = "Keep the name under 200 characters.";
    if (!timezone) found.timezone = "Choose the time zone you mostly work in.";
    if (!email.trim()) found.support_email = "Add an email address attendees can write to for help.";
    else if (!EMAIL_RE.test(email.trim())) found.support_email = "That email address looks incomplete. Check it, e.g. help@yourcompany.com.";
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirstInvalid();
      throw new Error("VALIDATION");
    }
    setErrors({});
    try {
      const org = await configure.createOrganization({ name: name.trim(), timezone, support_email: email.trim() });
      onDone(org);
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

  return (
    <form noValidate aria-label="Your organisation" onSubmit={(event: FormEvent) => event.preventDefault()} className="mt-8 flex flex-col gap-5">
      <Field label="Organisation name" id="org-name" error={errors.name} hint="Shown to attendees on passes and emails.">
        <TextInput
          value={name}
          maxLength={200}
          autoComplete="organization"
          autoFocus={!organization}
          onChange={(event) => {
            setName(event.target.value);
            clear("name");
          }}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Time zone" id="org-timezone" error={errors.timezone} hint="New venues and events start in this zone.">
          <TimeZoneSelect
            value={timezone}
            invalid={Boolean(errors.timezone)}
            onChange={(zone) => {
              setTimezone(zone);
              clear("timezone");
            }}
          />
        </Field>
        <Field label="Support email" id="org-support_email" error={errors.support_email} hint="Where attendees write when they need help.">
          <TextInput
            type="email"
            value={email}
            autoComplete="email"
            spellCheck={false}
            onChange={(event) => {
              setEmail(event.target.value);
              clear("support_email");
            }}
          />
        </Field>
      </div>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <div className="flex justify-end border-t border-border pt-4">
        <ActionButton type="submit" action={save} doneLabel="Saved" failedLabel={failure} variant="primary" size="compact">
          {organization ? "Save and continue" : "Continue"}
        </ActionButton>
      </div>
    </form>
  );
}

function VenueStep({ timezone: orgZone, venues, onDone }: { timezone: string; venues: VenueRow[]; onDone: (venue: Venue) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [floors, setFloors] = useState("Ground");
  const [timezone, setTimezone] = useState(orgZone);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const clear = (key: string) => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const parsed = parseFloors(floors);
  const undrawn = venues.filter((row) => row.zones === 0);

  const create = async () => {
    setProblem(null);
    const found: Errors = {};
    if (!name.trim()) found.name = "Give the venue a name, e.g. Kololo Pavilion.";
    else if (name.trim().length > 200) found.name = "Keep the name under 200 characters.";
    if (!city.trim()) found.city = "Add the city, so attendees can find it.";
    if (!timezone) found.timezone = "Choose the time zone the venue is in.";
    if (parsed.length === 0) found.floors = "Add at least one floor, e.g. Ground.";
    else if (new Set(parsed.map((f) => f.toLowerCase())).size !== parsed.length) found.floors = "Each floor needs its own name. Remove the repeated one.";
    else if (parsed.some((f) => f.length > 50)) found.floors = "Keep each floor name under 50 characters.";
    if (Object.keys(found).length) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirstInvalid();
      throw new Error("VALIDATION");
    }
    setErrors({});
    try {
      const venue = await configure.createVenue({ name: name.trim(), city: city.trim(), timezone, floors: parsed });
      // Let the check and the rule draw before the page moves on.
      timer.current = window.setTimeout(() => onDone(venue), 700);
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

  return (
    <form noValidate aria-label="Your first venue" onSubmit={(event: FormEvent) => event.preventDefault()} className="mt-8 flex flex-col gap-5">
      {undrawn.length > 0 ? (
        <Notice>
          <span>
            You have already added {undrawn.map((row, i) => (
              <span key={row.venue.id}>
                {i > 0 ? ", " : null}
                <Link to={`/venues/${row.venue.id}?edit=1`} className={linkClass}>
                  {row.venue.name}
                </Link>
              </span>
            ))}
            . Draw its rooms, or add another venue here.
          </span>
        </Notice>
      ) : null}
      <Field label="Venue name" id="venue-name" error={errors.name} hint="As attendees know the building.">
        <TextInput
          value={name}
          maxLength={200}
          autoComplete="off"
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            clear("name");
          }}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City" id="venue-city" error={errors.city}>
          <TextInput
            value={city}
            maxLength={100}
            autoComplete="address-level2"
            onChange={(event) => {
              setCity(event.target.value);
              clear("city");
            }}
          />
        </Field>
        <Field label="Time zone" id="venue-timezone" error={errors.timezone} hint="Your organisation's zone, unless the venue is elsewhere.">
          <TimeZoneSelect
            value={timezone}
            invalid={Boolean(errors.timezone)}
            onChange={(zone) => {
              setTimezone(zone);
              clear("timezone");
            }}
          />
        </Field>
      </div>
      <Field
        label="Floors"
        id="venue-floors"
        error={errors.floors}
        hint={
          parsed.length > 0 ? (
            <>
              <span className="font-mono tabular-nums">{parsed.length}</span> {parsed.length === 1 ? "floor" : "floors"}: {parsed.join(" · ")}. Separate
              them with commas, from the bottom up.
            </>
          ) : (
            "Separate floors with commas, from the bottom up, e.g. Ground, Level 1."
          )
        }
      >
        <TextInput
          value={floors}
          placeholder="Ground, Level 1, Level 2"
          onChange={(event) => {
            setFloors(event.target.value);
            clear("floors");
          }}
        />
      </Field>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <div className="flex justify-end border-t border-border pt-4">
        <ActionButton type="submit" action={create} doneLabel="Venue created" failedLabel={failure} reward keepDone variant="primary" size="compact">
          Create venue
        </ActionButton>
      </div>
    </form>
  );
}

function DoneStep({ organization, venue }: { organization: Organization | null; venue: Venue }) {
  return (
    <section aria-label="Setup complete" className="mt-8">
      <p role="status" className="text-17">
        <RewardMoment>Your organisation and first venue are ready</RewardMoment>
      </p>
      <p className="mt-4 text-15 leading-relaxed text-muted-foreground">
        {organization ? `${organization.name} now has ` : "You now have "}
        {venue.name} in {venue.city ?? "its city"}. Next, draw its rooms: zones for the large areas and rooms inside them, each with its
        own capacity. Gates and the Command Center map work from that drawing.
      </p>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link to={`/venues/${venue.id}?edit=1`} className={buttonClass("primary", "compact")}>
          Draw the venue's rooms
        </Link>
        <Link to="/events/new" className={buttonClass("secondary", "compact")}>
          Create your first event
        </Link>
      </div>
    </section>
  );
}
