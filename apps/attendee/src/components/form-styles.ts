/**
 * The Attendee Portal's form control classes, in one place so every screen draws the same
 * field and the development controls page (/dev/controls) shows exactly what ships.
 * Sizes follow the attendee scale: 17px text (no zoom on focus on phones), 52px fields. Fields
 * are tonal blocks with a 2px edge along the foot (D-37, docs/05 §5), like the shared controlClass.
 */

export const fieldClass =
  "min-h-13 w-full bg-field px-4 py-2.5 text-17 text-foreground outline-none transition-[background-color,box-shadow] duration-120 ease-standard placeholder:text-muted-foreground shadow-[inset_0_-2px_0_var(--field-edge)] hover:bg-field-hover focus:shadow-[inset_0_0_0_2px_var(--brand)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--destructive),inset_0_-2px_0_var(--destructive)] read-only:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/*
 * Native select on purpose: phones get their own picker, the best control there is on a
 * phone. The popup Chrome and Edge draw on desktop takes its colours from the select
 * itself, so the select carries an opaque ground (a transparent one fell back to white,
 * which made the light option text unreadable) and every option states its colours.
 */
export const selectClass =
  "min-h-13 w-full bg-(--field-solid) px-4 py-2.5 text-17 text-foreground outline-none transition-[box-shadow] duration-120 ease-standard shadow-[inset_0_-2px_0_var(--field-edge)] focus:shadow-[inset_0_0_0_2px_var(--brand)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--destructive),inset_0_-2px_0_var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const optionClass = "bg-background text-foreground";

/**
 * Square checkbox: a tonal square with a 2px edge at rest (3:1 or more), the accent when checked (a checked control is "I acted"),
 * with a tick in the ground colour so "checked" never rests on colour alone.
 */
export const checkboxClass =
  "mt-0.5 size-5 shrink-0 appearance-none bg-field bg-center bg-no-repeat shadow-[inset_0_0_0_2px_var(--field-edge)] transition-colors duration-120 ease-standard checked:bg-brand checked:shadow-none checked:bg-[image:var(--check-tick)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const labelClass = "text-15 font-medium text-foreground";
export const hintClass = "text-13 leading-relaxed text-muted-foreground";
export const errorClass = "text-15 text-destructive";
