/**
 * Development only (/dev/controls, never in a production build): every control the
 * Attendee Portal uses, in every state, on the real theme. Look at it after any change to
 * the theme or to components/form-styles.ts — this is where a browser-drawn default (the
 * white select list, a pale autofill fill) shows up before an attendee sees it.
 */
import { useState } from "react";
import { ActionButton, Badge, RewardMoment, buttonClass } from "@synan/ui/components";
import { PageHeader, PageShell, RuledRow } from "../components/page";
import { StateBlock } from "../components/states";
import { checkboxClass, errorClass, fieldClass, hintClass, labelClass, optionClass, selectClass } from "../components/form-styles";

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
    <PageShell bleed>
      <PageHeader label="Development" title="Controls">
        Every attendee control in every state. Tab through the page to see focus.
      </PageHeader>

      <RuledRow label="Text fields">
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
      </RuledRow>

      <RuledRow label="Selects">
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
      </RuledRow>

      <RuledRow label="Choices">
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
      </RuledRow>

      <RuledRow label="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass("primary", "md")}>Primary</button>
          <button type="button" className={buttonClass("secondary", "md")}>Secondary</button>
          <button type="button" className={buttonClass("quiet", "md")}>Quiet</button>
          <button type="button" className={buttonClass("danger", "md")}>Danger</button>
          <button type="button" disabled className={buttonClass("primary", "md")}>Disabled</button>
          <button type="button" className={buttonClass("secondary", "sm")}>Small</button>
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
      </RuledRow>

      <RuledRow label="States">
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
        <div className="mt-6 border border-border">
          <StateBlock glyph="·" title="Nothing on your agenda yet.">Sessions appear here once you&apos;re registered.</StateBlock>
        </div>
      </RuledRow>
    </PageShell>
  );
}
