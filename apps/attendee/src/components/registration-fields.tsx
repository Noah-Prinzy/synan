/**
 * The building blocks of an attendee's details form, shared by registration (A3) and the
 * invitation reply (A10): a labelled field with its hint or error, the event's own questions
 * rendered from its profile schema, and the separate, unticked zone-presence consent row (03 §5).
 */
import type { ReactNode } from "react";
import type { ProfileField } from "../data/registration";
import { checkboxClass, chipClass, fieldClass, optionClass, selectClass } from "./form-styles";

export function Field({
  id,
  label,
  optional = false,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-15 font-medium text-foreground">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-15 text-destructive">
          <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-13 leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hasHint?: unknown): string | undefined {
  return error ? `${id}-error` : hasHint ? `${id}-hint` : undefined;
}

/** The event-defined questions (text, select, multi-select), each saying why it is asked. */
export function ProfileFieldList({
  fields,
  answers,
  errors,
  onAnswer,
  onToggle,
}: {
  fields: ProfileField[];
  answers: Record<string, string | string[]>;
  errors: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  onToggle: (id: string, option: string) => void;
}) {
  return (
    <>
      {fields.map((field: ProfileField) => {
        if (field.kind === "multi") {
          const value = answers[field.id];
          const selected = Array.isArray(value) ? value : [];
          return (
            <fieldset
              key={field.id}
              id={field.id}
              tabIndex={-1}
              aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
              className="flex flex-col gap-3 border-0 p-0 outline-none"
            >
              <legend className="mb-2 text-15 font-medium">
                {field.label}
                {!field.required ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
              </legend>
              {/* Choices as square tonal chips; the chosen ones are ink, with a tick (D-37). */}
              <div className="flex flex-wrap gap-2">
                {field.options.map((option) => (
                  <label key={option} className={chipClass}>
                    <input
                      type="checkbox"
                      checked={selected.includes(option)}
                      onChange={() => onToggle(field.id, option)}
                      className="peer sr-only"
                    />
                    <span aria-hidden="true" className="hidden peer-checked:inline">
                      ✓
                    </span>
                    {option}
                  </label>
                ))}
              </div>
              {errors[field.id] ? (
                <p id={`${field.id}-error`} className="text-15 text-destructive">
                  <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
                  {errors[field.id]}
                </p>
              ) : field.hint ? (
                <p id={`${field.id}-hint`} className="text-13 leading-relaxed text-muted-foreground">
                  {field.hint}
                </p>
              ) : null}
            </fieldset>
          );
        }

        const value = answers[field.id];
        const current = typeof value === "string" ? value : "";

        if (field.kind === "select") {
          return (
            <Field
              key={field.id}
              id={field.id}
              label={field.label}
              optional={!field.required}
              hint={field.hint}
              error={errors[field.id]}
            >
              <select
                id={field.id}
                value={current}
                onChange={(changeEvent) => onAnswer(field.id, changeEvent.target.value)}
                aria-invalid={errors[field.id] ? true : undefined}
                aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
                className={`${selectClass} ${current === "" ? "text-muted-foreground" : ""}`}
              >
                {/* The prompt is shown until a choice is made, and is never itself a choice. */}
                <option value="" disabled hidden className={optionClass}>
                  Choose one
                </option>
                {field.options.map((option) => (
                  <option key={option} value={option} className={optionClass}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          );
        }

        return (
          <Field
            key={field.id}
            id={field.id}
            label={field.label}
            optional={!field.required}
            hint={field.hint}
            error={errors[field.id]}
          >
            <input
              id={field.id}
              type="text"
              value={current}
              placeholder={field.placeholder}
              enterKeyHint="next"
              onChange={(inputEvent) => onAnswer(field.id, inputEvent.target.value)}
              aria-invalid={errors[field.id] ? true : undefined}
              aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
              className={fieldClass}
            />
          </Field>
        );
      })}
    </>
  );
}

/** Zone-presence consent: its own row, unticked by default, with what is stored (03 §5, P-12). */
export function ConsentRow({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="pt-2">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(changeEvent) => onChange(changeEvent.target.checked)}
          className={checkboxClass}
        />
        <span className="flex flex-col gap-1.5">
          <span className="text-15 font-medium text-foreground">
            Share which zones I enter <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <span className="max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
            Lets the organisers see which areas you enter during the event, for crowd safety. Your pass
            works the same either way.
          </span>
        </span>
      </label>
      <details className="mt-3 pl-8">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-15 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none">
          What we store
        </summary>
        <p className="mt-1 max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
          The zone you entered, when you entered and left, and the pass that let you in. Never where you
          stood. These records are deleted when the event closes and its grace period ends; only counts
          without your name are kept. You can withdraw at any time in Account.
        </p>
      </details>
    </div>
  );
}
