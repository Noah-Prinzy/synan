/**
 * Development only (/dev/controls, never in a production build): every control the
 * Attendee Portal uses, in every state, on the real theme. Look at it after any change to
 * the theme or to components/form-styles.ts — this is where a browser-drawn default (the
 * white select list, a pale autofill fill) shows up before an attendee sees it.
 */
import { useState } from "react";
import { ActionButton, Badge, RewardMoment, buttonClass } from "@synan/ui/components";
import { PageHeader, PageShell, Section } from "../components/page";
import { StateBlock } from "../components/states";
import { EventPicture } from "../components/event-picture";
import { checkboxClass, chipClass, errorClass, fieldClass, hintClass, labelClass, optionClass, selectClass } from "../components/form-styles";
import type { EventSummary } from "../data/events";

/** A sample event without a photograph: the designed cover. */
const sampleEvent: EventSummary = {
  id: "sample",
  slug: "sample",
  title: "Sample Event",
  startsAt: "2026-11-22T06:00:00Z",
  endsAt: "2026-11-22T14:00:00Z",
  timezone: "Africa/Kampala",
  venue: "Nexus Hall",
  city: "Kampala",
  state: "live",
  admitted: 864,
  admittedShown: true,
  capacity: 1200,
  image: null,
  sessionCount: 6,
};

function Sample({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-12 text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export default function DevControls() {
  const [choice, setChoice] = useState("");
  const [moment, setMoment] = useState(0);
  return (
    <PageShell>
      <PageHeader label="Development" title="Controls." more="Every attendee control in every state.">
        Tab through the page to see focus.
      </PageHeader>
      <div className="mx-auto max-w-4xl">

      <Section label="Text fields">
        <div className="grid gap-6 md:grid-cols-2">
          <Sample label="default + placeholder">
            <label className={labelClass} htmlFor="s1">Full name</label>
            <input id="s1" className={fieldClass} placeholder="As it appears on your pass" />
          </Sample>
          <Sample label="filled, long value">
            <label className={labelClass} htmlFor="s2">Email</label>
            <input id="s2" className={fieldClass} defaultValue="a.very.long.address.for.testing.overflow@example-organisation.co.ug" />
          </Sample>
          <Sample label="invalid">
            <label className={labelClass} htmlFor="s3">Email</label>
            <input id="s3" className={fieldClass} aria-invalid defaultValue="amara@" aria-describedby="s3e" />
            <p id="s3e" className={errorClass}>✕ That email doesn&apos;t look complete.</p>
          </Sample>
          <Sample label="with hint">
            <label className={labelClass} htmlFor="s4">Phone <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input id="s4" type="tel" className={fieldClass} />
            <p className={hintClass}>Only used if the desk needs to reach you on the day.</p>
          </Sample>
          <Sample label="read-only">
            <input className={fieldClass} readOnly defaultValue="amara@example.com" aria-label="Read-only sample" />
          </Sample>
          <Sample label="disabled">
            <input className={fieldClass} disabled defaultValue="Can't change this" aria-label="Disabled sample" />
          </Sample>
          <Sample label="autofill: use the browser's autofill on this field">
            <input className={fieldClass} autoComplete="email" name="email" type="email" aria-label="Autofill sample" />
          </Sample>
          <Sample label="desk code (mono)">
            <input
              className={`${fieldClass} font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case`}
              placeholder="6 letters and numbers"
              aria-label="Desk code sample"
            />
          </Sample>
        </div>
      </Section>

      <Section label="Selects">
        <div className="grid gap-6 md:grid-cols-2">
          <Sample label="empty: prompt is not a choice">
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className={`${selectClass} ${choice === "" ? "text-muted-foreground" : ""}`}
              aria-label="Select sample"
            >
              <option value="" disabled hidden className={optionClass}>Choose one</option>
              {["Founder or executive", "Engineer or developer", "Designer or product", "Student", "Something else"].map((option) => (
                <option key={option} className={optionClass}>{option}</option>
              ))}
            </select>
          </Sample>
          <Sample label="invalid">
            <select defaultValue="" aria-invalid className={`${selectClass} text-muted-foreground`} aria-label="Invalid select sample">
              <option value="" disabled hidden className={optionClass}>Choose one</option>
              <option className={optionClass}>Vegetarian</option>
            </select>
            <p className={errorClass}>✕ Choose one to continue.</p>
          </Sample>
          <Sample label="disabled">
            <select disabled defaultValue="Vegan" className={selectClass} aria-label="Disabled select sample">
              <option className={optionClass}>Vegan</option>
            </select>
          </Sample>
        </div>
      </Section>

      <Section label="Choices">
        <p className="mb-3 font-mono text-12 text-muted-foreground">chips: buttons with aria-pressed (filters)</p>
        <div role="group" aria-label="Chip sample" className="mb-6 flex flex-wrap gap-2">
          {["All", "Live", "Upcoming"].map((label, index) => (
            <button key={label} type="button" aria-pressed={index === 0} className={chipClass}>
              {label}
              <span className="font-mono text-13 opacity-70">{index + 2}</span>
            </button>
          ))}
        </div>
        <p className="mb-3 font-mono text-12 text-muted-foreground">chips: checkboxes (multi-select questions)</p>
        <div className="mb-6 flex flex-wrap gap-2">
          {["Infrastructure", "Policy", "Product"].map((label, index) => (
            <label key={label} className={chipClass}>
              <input type="checkbox" defaultChecked={index !== 1} className="peer sr-only" />
              <span aria-hidden="true" className="hidden peer-checked:inline">
                ✓
              </span>
              {label}
            </label>
          ))}
        </div>
        <p className="mb-3 font-mono text-12 text-muted-foreground">checkboxes (consent)</p>
        <div className="flex flex-col gap-2">
          {[
            { label: "Unchecked", props: {} },
            { label: "Checked", props: { defaultChecked: true } },
            { label: "Disabled", props: { disabled: true } },
            { label: "Disabled, checked", props: { disabled: true, defaultChecked: true } },
          ].map((item) => (
            <label key={item.label} className="flex min-h-11 cursor-pointer items-center gap-3 text-15">
              <input type="checkbox" className={`${checkboxClass} mt-0`} {...item.props} />
              {item.label}
            </label>
          ))}
        </div>
      </Section>

      <Section label="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass("primary", "md")}>Primary</button>
          <button type="button" className={buttonClass("secondary", "md")}>Secondary</button>
          <button type="button" className={buttonClass("quiet", "md")}>Quiet</button>
          <button type="button" className={buttonClass("danger", "md")}>Danger</button>
          <button type="button" disabled className={buttonClass("primary", "md")}>Disabled</button>
          <button type="button" className={buttonClass("secondary", "sm")}>Small</button>
          <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-13 font-semibold">AO</span>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ActionButton doneLabel="Sent" action={() => new Promise((resolve) => setTimeout(resolve, 900))} className="min-h-12 px-5 text-15">
            Works, then done
          </ActionButton>
          <ActionButton
            doneLabel="Sent"
            failedLabel="Couldn't send. Try again"
            action={() => new Promise((_, reject) => setTimeout(() => reject(new Error("no")), 900))}
            className="min-h-12 px-5 text-15"
          >
            Works, then fails
          </ActionButton>
          <ActionButton variant="primary" reward keepDone doneLabel="Bound" action={() => new Promise((resolve) => setTimeout(resolve, 900))} className="min-h-12 px-5 text-15">
            Key moment
          </ActionButton>
        </div>
      </Section>

      <Section label="States">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="success" dot>READY</Badge>
          <Badge tone="neutral" dot>NOT YET BOUND</Badge>
          <Badge tone="warning" dot>UNDER REVIEW</Badge>
          <Badge tone="destructive" dot>REVOKED</Badge>
          <Badge tone="success" dot pulse>Live now</Badge>
        </div>
        <div className="mt-6 flex min-h-11 items-center gap-4">
          <button type="button" onClick={() => setMoment((n) => n + 1)} className={buttonClass("secondary", "sm")}>
            Play the key moment
          </button>
          {/* After a press only, as in the product: haptics need a user gesture. */}
          {moment > 0 ? (
            <p key={moment} className="text-15 font-medium text-success">
              <RewardMoment>Registered</RewardMoment>
            </p>
          ) : null}
        </div>
        <div className="mt-6">
          <StateBlock glyph="·" title="Nothing on your agenda yet.">Sessions appear here once you&apos;re registered.</StateBlock>
        </div>
      </Section>

      <Section label="On a picture (the event page)">
        <div className="relative h-96">
          <EventPicture event={sampleEvent} big />
          <div className="absolute inset-x-4 bottom-4 flex flex-col items-start gap-4 bg-glass p-5 text-glass-ink backdrop-blur-xl sm:w-90">
            <Badge tone="success" dot>
              Live now
            </Badge>
            <p className="text-17">
              <span className="mr-3 font-mono text-12 tracking-[0.08em] text-glass-ink-2 uppercase">When</span>22 November
            </p>
            <a href="#content" className={buttonClass("primary", "md", "w-full")}>
              Register
            </a>
          </div>
        </div>
      </Section>
      </div>
    </PageShell>
  );
}
