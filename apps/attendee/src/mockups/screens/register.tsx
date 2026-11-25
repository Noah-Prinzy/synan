/**
 * DEVELOPMENT ONLY — (c) one registration step: "About you" for Nexus Summit 2026, from the
 * event's real profile schema. Calm: one centred statement, the form on one soft surface.
 * Stage: plus a compact event card with a rounded picture, an editorial two-column layout.
 * Field: Stage plus mono details (the step counter, dates).
 *
 * The Organisation field opens in its error state (empty, as if Continue had been pressed once);
 * type in it and press Continue for the reward tick.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { CalmPage } from "../shell";
import { Arrow } from "../nav";
import { EventPicture } from "../scenes";
import { FEATURED, dateRange, monthShort, dayNum, profileFields, type MockEvent } from "../data";
import "./forms.css";

/* ------------------------------------------------------------------ shared with the pass */

/** A small static tick (the drawn RewardTick is for the moment an action completes). */
export function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3.5 9.5 7.5 13.5 14.5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Field: "22–23 NOV · NEXUS HALL". Elsewhere: "Nexus Hall · 22–23 November". */
function eventLine(event: MockEvent, mono: boolean) {
  if (!mono) return `${event.venue.name} · ${dateRange(event)}`;
  const a = dayNum(event.starts_at);
  const b = dayNum(event.ends_at);
  return `${a === b ? a : `${a}–${b}`} ${monthShort(event.starts_at)} · ${event.venue.name}`;
}

/** Stage and Field: the compact event card, a small rounded picture beside the name. */
export function EventCard({ event, onWhite = false, children }: { event: MockEvent; onWhite?: boolean; children?: ReactNode }) {
  const dx = useDx();
  const mono = dx.d === 3;
  return (
    <div className={`dxf-event ${onWhite ? "is-on-white" : ""}`}>
      <span className="dxf-event-img">
        <EventPicture event={event} photo={dx.photo} tag={false} />
      </span>
      <span className="dxf-event-text">
        <span className="dxf-event-title">{event.title}</span>
        <span className={mono ? "dxf-mono-caps dxf-event-meta" : "dx-small dxf-event-meta"}>{eventLine(event, mono)}</span>
      </span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ stepper */

const STEPS = ["Your details", "About you", "Confirm"] as const;

/** Words, a small blue mark on the current step, a soft track. No rules. */
function Stepper({ current }: { current: number }) {
  const dx = useDx();
  const pad = (k: number) => String(k).padStart(2, "0");
  return (
    <nav className="dxf-steps-wrap" aria-label="Registration steps">
      {dx.d === 3 ? (
        <p className="dx-eyebrow dxf-count">
          <span>Step</span>
          <span className="dxf-count-num">
            {pad(Math.min(current, 2) + 1)} / {pad(STEPS.length)}
          </span>
        </p>
      ) : null}
      <ol className="dxf-steps">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "current" : "next";
          return (
            <li key={label} className="dxf-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="dxf-step-mark" aria-hidden="true">
                {state === "done" ? <Tick /> : state === "current" ? <span className="dxf-step-dot" /> : null}
              </span>
              <span>{label}</span>
              {state === "done" ? <span className="dx-sr">, done</span> : null}
            </li>
          );
        })}
      </ol>
      <span className="dxf-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.min(1, (current + 0.5) / STEPS.length)})` }} />
      </span>
    </nav>
  );
}

/* ------------------------------------------------------------------ the step */

const QUIET_WIDE = { x: 0.06, y: 0.06, w: 0.88, h: 0.86, floor: 0.2 };

export default function Register() {
  const dx = useDx();
  const stage = dx.d !== 1;
  const event = FEATURED;
  const fields = profileFields(event.slug);
  const uid = useId().replace(/:/g, "");

  const [values, setValues] = useState<Record<string, string>>({ organization: "", role: "Engineer or developer", meal: "No preference" });
  const [tracks, setTracks] = useState<string[]>(["Infrastructure", "Product"]);
  // Opens as if Continue had been pressed once with Organisation empty: the one error state.
  const [checked, setChecked] = useState(true);
  const [saved, setSaved] = useState(0);
  const [fading, setFading] = useState(false);
  const orgRef = useRef<HTMLInputElement>(null);

  const orgEmpty = !(values.organization ?? "").trim();
  const orgError = checked && orgEmpty;

  useEffect(() => {
    if (!saved) return;
    setFading(false);
    const t = window.setTimeout(() => setFading(true), 2600);
    return () => window.clearTimeout(t);
  }, [saved]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setChecked(true);
    if (orgEmpty) {
      orgRef.current?.focus();
      return;
    }
    setSaved((k) => k + 1);
  };

  const step = saved ? 2 : 1;

  const intro = (
    <div className="dxf-reg-intro">
      {stage ? (
        <EventCard event={event} />
      ) : (
        <p className="dx-eyebrow">
          {event.title} · {dateRange(event)}
        </p>
      )}
      <h1 className="dx-display dxf-statement">
        A little about you. <span className="dx-tone2 dxf-break">So the day fits you.</span>
      </h1>
      <Stepper current={step} />
      {stage ? <p className="dx-small dx-muted dxf-reg-note">About a minute. You can change any of this later at the desk.</p> : null}
    </div>
  );

  return (
    <CalmPage quiet={stage ? QUIET_WIDE : undefined}>
      <div className={`dxf-reg ${stage ? "is-stage" : "is-calm"}`}>
        {intro}
        <form className="dx-surface dxf-form" noValidate onSubmit={onSubmit} aria-label="About you">
          {fields.map((field) => {
            const id = `${uid}-${field.key}`;
            const hintId = `${id}-hint`;
            const errId = `${id}-error`;
            const optional = !field.required ? <span className="dxf-optional">Optional</span> : null;

            if (field.type === "multiselect") {
              return (
                <div key={field.key} className="dxf-field" role="group" aria-labelledby={`${id}-label`} aria-describedby={field.hint ? hintId : undefined}>
                  <p id={`${id}-label`} className="dx-label dxf-label">
                    {field.label}
                    {optional}
                  </p>
                  <div className="dxf-chips">
                    {(field.options ?? []).map((option) => {
                      const on = tracks.includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          className="dx-chip dxf-chip"
                          aria-pressed={on}
                          onClick={() => setTracks((list) => (on ? list.filter((x) => x !== option) : [...list, option]))}
                        >
                          {on ? (
                            <span className="dxf-chip-mark" aria-hidden="true">
                              <Tick size={13} />
                            </span>
                          ) : null}
                          {option}
                        </button>
                      );
                    })}
                  </div>
                  {field.hint ? (
                    <p id={hintId} className="dxf-hint">
                      {field.hint}
                    </p>
                  ) : null}
                </div>
              );
            }

            if (field.type === "select") {
              return (
                <div key={field.key} className="dxf-field">
                  <label htmlFor={id} className="dx-label dxf-label">
                    {field.label}
                    {optional}
                  </label>
                  <select
                    id={id}
                    className="dx-input dxf-select"
                    value={values[field.key] ?? ""}
                    required={field.required}
                    aria-describedby={field.hint ? hintId : undefined}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  >
                    <option value="" disabled>
                      Choose one
                    </option>
                    {(field.options ?? []).map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                  {field.hint ? (
                    <p id={hintId} className="dxf-hint">
                      {field.hint}
                    </p>
                  ) : null}
                </div>
              );
            }

            const isOrg = field.key === "organization";
            const invalid = isOrg && orgError;
            return (
              <div key={field.key} className="dxf-field">
                <label htmlFor={id} className="dx-label dxf-label">
                  {field.label}
                  {optional}
                </label>
                <input
                  id={id}
                  ref={isOrg ? orgRef : undefined}
                  className="dx-input"
                  type="text"
                  autoComplete={isOrg ? "organization" : "off"}
                  placeholder={field.placeholder ?? undefined}
                  value={values[field.key] ?? ""}
                  required={field.required}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errId : field.hint ? hintId : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
                {invalid ? (
                  <p id={errId} className="dx-error dxf-error">
                    <ErrorMark />
                    <span>
                      Add where you work: it is printed on your badge under your name. Working for yourself? Write <q>Independent</q>.
                    </span>
                  </p>
                ) : field.hint ? (
                  <p id={hintId} className="dxf-hint">
                    {field.hint}
                  </p>
                ) : null}
              </div>
            );
          })}

          <div className="dxf-actions">
            <Link to={dx.href({ screen: "event" })} className="dx-btn is-ghost dxf-back">
              <BackArrow /> Back
            </Link>
            <p className={`dxf-saved ${saved && !fading ? "is-on" : ""}`} role="status" aria-live="polite">
              {saved ? (
                <>
                  <RewardTick key={saved} label="Saved" />
                  <span>Saved. Next, confirm.</span>
                </>
              ) : null}
            </p>
            <button type="submit" className="dx-btn is-action dxf-primary">
              Continue <Arrow />
            </button>
          </div>
        </form>
      </div>
    </CalmPage>
  );
}

function ErrorMark() {
  return (
    <svg className="dxf-error-mark" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8H4M7.5 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
