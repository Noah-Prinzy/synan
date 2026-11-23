/**
 * The Attendee Portal's form control classes, in one place so every screen draws the same
 * field and the development controls page (/dev/controls) shows exactly what ships.
 * Sizes follow the attendee scale: 17px text (no zoom on focus on phones), 48px fields.
 */

export const fieldClass =
  "min-h-12 w-full border border-border bg-transparent px-3 py-2.5 text-17 text-foreground outline-none transition-colors duration-120 ease-standard placeholder:text-muted-foreground focus:border-brand aria-[invalid=true]:border-destructive read-only:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/*
 * Native select on purpose: phones get their own picker, the best control there is on a
 * phone. The popup Chrome and Edge draw on desktop takes its colours from the select
 * itself, so the select carries an opaque ground (a transparent one fell back to white,
 * which made the light option text unreadable) and every option states its colours.
 */
export const selectClass =
  "min-h-12 w-full border border-border bg-background px-3 py-2.5 text-17 text-foreground outline-none transition-colors duration-120 ease-standard focus:border-brand aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const optionClass = "bg-background text-foreground";

/**
 * Square checkbox: hairline at rest, the accent when checked (a checked control is "I acted"),
 * with a tick in the ground colour so "checked" never rests on colour alone.
 */
export const checkboxClass =
  "mt-0.5 size-5 shrink-0 appearance-none border border-border bg-transparent bg-center bg-no-repeat transition-colors duration-120 ease-standard checked:border-brand checked:bg-brand checked:bg-[image:var(--check-tick)] focus-visible:outline focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export const labelClass = "text-15 font-medium text-foreground";
export const hintClass = "text-13 leading-relaxed text-muted-foreground";
export const errorClass = "text-15 text-destructive";
