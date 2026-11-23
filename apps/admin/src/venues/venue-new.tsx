/**
 * D2b · New venue `/venues/new` (docs/06 §2.3). Name, city, address, IANA time zone, floors and
 * an optional default room capacity. Creating the venue goes straight into the spatial editor
 * (D3) in edit mode, so a venue is never left with no zones. Cancel returns to the list; the
 * unsaved draft is kept in sessionStorage for the session and restored when the form reopens.
 *
 * Validation runs in the browser first with human copy; the server's field messages are mapped
 * back onto the same fields.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionButton, Field, TextInput, buttonClass } from "@synan/ui/components";
import type { CreateVenueBody } from "@synan/mock/command";
import { FormColumn, Notice, PageHeader, TimeZoneSelect, errorCopy, fieldErrors, linkClass, useDocumentTitle } from "../kit";
import { configure } from "../live/backend";
import { FloorsField, newFloor, type FloorItem } from "./floors-field";

const DRAFT_KEY = "synan.admin.venue-new.draft";

interface Draft {
  name: string;
  city: string;
  address: string;
  timezone: string;
  floors: FloorItem[];
  capacity: string;
}

const blank = (): Draft => ({
  name: "",
  city: "",
  address: "",
  timezone: "Africa/Kampala",
  floors: [newFloor("Ground")],
  capacity: "",
});

function isBlank(draft: Draft): boolean {
  return (
    !draft.name.trim() &&
    !draft.city.trim() &&
    !draft.address.trim() &&
    !draft.capacity.trim() &&
    draft.timezone === "Africa/Kampala" &&
    draft.floors.length === 1 &&
    draft.floors[0]?.name === "Ground"
  );
}

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const floors = Array.isArray(parsed.floors)
      ? parsed.floors.filter((f): f is FloorItem => typeof f?.id === "string" && typeof f?.name === "string")
      : [];
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      city: typeof parsed.city === "string" ? parsed.city : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
      timezone: typeof parsed.timezone === "string" && parsed.timezone ? parsed.timezone : "Africa/Kampala",
      floors: floors.length > 0 ? floors : [newFloor("Ground")],
      capacity: typeof parsed.capacity === "string" ? parsed.capacity : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null): void {
  try {
    if (draft === null || isBlank(draft)) window.sessionStorage.removeItem(DRAFT_KEY);
    else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft lasts as long as the page */
  }
}

type Errors = Record<string, string>;

/** Client-side checks, worded as the fix. Keys match the request body; floors by `floor:<id>`. */
function validate(draft: Draft): Errors {
  const errors: Errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Give the venue a name.";
  else if (name.length > 200) errors.name = "Keep the name under 200 characters.";
  if (!draft.city.trim()) errors.city = "Add the city, so attendees can find it.";
  else if (draft.city.trim().length > 100) errors.city = "Keep the city under 100 characters.";
  if (draft.address.trim().length > 500) errors.address = "Keep the address under 500 characters.";
  if (!draft.timezone) errors.timezone = "Choose the time zone the venue is in.";

  const seen = new Map<string, string>();
  for (const floor of draft.floors) {
    const value = floor.name.trim();
    if (!value) errors[`floor:${floor.id}`] = "Name this floor, or remove it.";
    else if (seen.has(value.toLowerCase())) errors[`floor:${floor.id}`] = `“${value}” is already a floor. Give each floor its own name.`;
    else seen.set(value.toLowerCase(), floor.id);
  }
  if (draft.floors.length === 0) errors.floors = "Add at least one floor.";

  const capacity = draft.capacity.trim();
  if (capacity) {
    const n = Number(capacity);
    if (!/^\d+$/.test(capacity) || !Number.isInteger(n) || n < 1) errors.capacity_default = "Enter a whole number of people, at least 1, or leave it empty.";
    else if (n > 100_000) errors.capacity_default = "That is more than any room holds. Check the number.";
  }
  return errors;
}

const FIELD_ORDER = ["name", "city", "address", "timezone", "floors", "capacity_default"];

export default function VenueNew() {
  useDocumentTitle("New venue");
  const navigate = useNavigate();
  const [initial] = useState(() => readDraft());
  const [draft, setDraft] = useState<Draft>(() => initial ?? blank());
  const [restored, setRestored] = useState(initial !== null && !isBlank(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState("Didn't work — try again");
  const [problem, setProblem] = useState<string | null>(null);
  const created = useRef(false);
  const leaveTimer = useRef<number | null>(null);

  // Keep the draft for the session: Cancel (or any navigation away) and coming back restores it.
  useEffect(() => {
    if (!created.current) writeDraft(draft);
  }, [draft]);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Clear the message on the field being fixed; the rest stay until the next attempt.
    const errorKey = key === "capacity" ? "capacity_default" : key;
    if (errors[errorKey]) setErrors(({ [errorKey]: _gone, ...rest }) => rest);
  };

  const focusFirst = (found: Errors) => {
    const key = FIELD_ORDER.find((k) => found[k]) ?? Object.keys(found).find((k) => k.startsWith("floor:"));
    if (!key) return;
    window.requestAnimationFrame(() => {
      const id = key.startsWith("floor:") ? null : `venue-${key}`;
      const el = id ? document.getElementById(id) : document.querySelector<HTMLElement>("fieldset [aria-invalid='true']");
      el?.focus();
    });
  };

  const create = async () => {
    setProblem(null);
    const found = validate(draft);
    // Floor messages are keyed by floor for the list; map them for the field component.
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFailure("Check the marked fields");
      focusFirst(found);
      throw new Error("VALIDATION");
    }
    setErrors({});
    const capacity = draft.capacity.trim();
    const body: CreateVenueBody = {
      name: draft.name.trim(),
      city: draft.city.trim(),
      address: draft.address.trim() || undefined,
      timezone: draft.timezone,
      floors: draft.floors.map((f) => f.name.trim()),
      capacity_default: capacity ? Number(capacity) : null,
    };
    try {
      const venue = await configure.createVenue(body);
      created.current = true;
      writeDraft(null);
      // Let the check draw, then go straight into drawing the venue.
      leaveTimer.current = window.setTimeout(
        () => navigate(`/venues/${venue.id}?edit=1`, { state: { created: venue.name } }),
        650,
      );
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setFailure("Check the marked fields");
        focusFirst(fields);
      } else {
        const copy = errorCopy(error);
        setProblem(`${copy.title}. ${copy.message}`);
        setFailure("Didn't work — try again");
      }
      throw error;
    }
  };

  const startOver = () => {
    writeDraft(null);
    setDraft(blank());
    setErrors({});
    setRestored(false);
    setProblem(null);
  };

  const floorErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith("floor:"))
      .map(([key, value]) => [key.slice("floor:".length), value]),
  );

  return (
    <div className="min-h-full pb-10">
      <PageHeader
        code="D2b"
        back={
          <Link to="/venues" className={linkClass}>
            Venues
          </Link>
        }
        title="New venue"
        meta="Name the building and its floors. Next you draw its zones and rooms."
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,40rem)_minmax(0,22rem)] xl:gap-10">
        <FormColumn>
          <form
            noValidate
            onSubmit={(event: FormEvent) => event.preventDefault()}
            aria-label="New venue"
            className="flex flex-col gap-6"
          >
            {restored ? (
              <Notice>
                <span>
                  Your unsaved venue from earlier is back.{" "}
                  <button type="button" onClick={startOver} className={linkClass}>
                    Start over
                  </button>
                </span>
              </Notice>
            ) : null}

            <section aria-labelledby="venue-building" className="flex flex-col gap-4">
              <h2 id="venue-building" className="border-b border-border pb-1.5 text-12 font-medium">
                The building
              </h2>
              <Field label="Name" id="venue-name" error={errors.name} hint="As attendees know it, e.g. Kololo Pavilion.">
                <TextInput
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                  autoComplete="off"
                  maxLength={200}
                  autoFocus={!restored}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" id="venue-city" error={errors.city}>
                  <TextInput value={draft.city} onChange={(event) => set("city", event.target.value)} autoComplete="address-level2" maxLength={100} />
                </Field>
                <Field label="Time zone" id="venue-timezone" error={errors.timezone} hint="Event times here are shown in this zone.">
                  <TimeZoneSelect value={draft.timezone} onChange={(zone) => set("timezone", zone)} invalid={Boolean(errors.timezone)} />
                </Field>
              </div>
              <Field label="Address" id="venue-address" optional error={errors.address} hint="Street and area. Shown on passes and in discovery.">
                <TextInput value={draft.address} onChange={(event) => set("address", event.target.value)} autoComplete="street-address" maxLength={500} />
              </Field>
            </section>

            <section aria-label="Floors" className="flex flex-col gap-2">
              <FloorsField
                floors={draft.floors}
                onChange={(floors) => {
                  setDraft((current) => ({ ...current, floors }));
                  // A floor's message clears once it has a name (or is gone); the rest wait for the next attempt.
                  setErrors((current) => {
                    const named = new Set(floors.filter((f) => f.name.trim()).map((f) => `floor:${f.id}`));
                    const present = new Set(floors.map((f) => `floor:${f.id}`));
                    return Object.fromEntries(
                      Object.entries(current).filter(
                        ([key]) => key !== "floors" && (!key.startsWith("floor:") || (present.has(key) && !named.has(key))),
                      ),
                    );
                  });
                }}
                errors={floorErrors}
                listError={errors.floors}
              />
            </section>

            <section aria-labelledby="venue-rooms" className="flex flex-col gap-4">
              <h2 id="venue-rooms" className="border-b border-border pb-1.5 text-12 font-medium">
                Rooms
              </h2>
              <Field
                label="Default room capacity"
                id="venue-capacity_default"
                optional
                error={errors.capacity_default}
                hint="New rooms start with this many places. Each room can be changed in the editor."
                className="max-w-60"
              >
                <TextInput
                  value={draft.capacity}
                  onChange={(event) => set("capacity", event.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  suffix="people"
                  className="font-mono tabular-nums"
                />
              </Field>
            </section>

            {problem ? <Notice tone="danger">{problem}</Notice> : null}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Link to="/venues" className={buttonClass("secondary", "compact")}>
                Cancel
              </Link>
              <ActionButton
                type="submit"
                action={create}
                doneLabel="Venue created"
                failedLabel={failure}
                reward
                keepDone
                variant="primary"
                size="compact"
              >
                Create venue
              </ActionButton>
            </div>
            <p className="-mt-3 text-right text-12 text-muted-foreground">
              Cancel keeps what you typed for this session.
            </p>
          </form>
        </FormColumn>

        <aside aria-label="What happens next" className="hidden px-4 py-6 xl:block xl:px-0">
          <h2 className="border-b border-border pb-1.5 text-12 font-medium">What happens next</h2>
          <ol className="mt-1 text-13">
            {[
              ["Create the venue", "Its name, city, time zone and floors."],
              ["Draw its zones", "Drag on the grid: one zone per hall, wing or garden."],
              ["Draw rooms inside them", "Each with a capacity and the points where it warns and stops entry."],
              ["Publish the layout", "Gates and the Command Center map use it from then on."],
            ].map(([title, text], index) => (
              <li key={title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 border-b border-border py-2.5">
                <span className={`font-mono text-11 tabular-nums ${index === 0 ? "text-foreground" : "text-muted-foreground"}`}>{index + 1}</span>
                <span>
                  <span className={index === 0 ? "text-foreground" : "text-foreground/80"}>{title}</span>
                  <span className="mt-0.5 block text-12 text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
