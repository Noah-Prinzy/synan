/**
 * What the five wizard steps (D5) share: the step list, the form state each step keeps while
 * the wizard is open (so Back and the stepper never lose input), the two layouts a step sits
 * in, the footer (Back · Save and close · Continue) and small helpers.
 */
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { AccessRule } from "@synan/contracts/rest";
import type { EventRecord, PassTemplate, RuleInput, VenueDetail, WizardStep } from "@synan/mock/command";
import { ActionButton, Button, cn } from "@synan/ui/components";
import type { MatrixRoom } from "../parts/tier-matrix";

export const STEP_LABEL: Record<WizardStep, string> = {
  basics: "Basics",
  venue: "Venue & rooms",
  access: "Access rules",
  pass: "Pass template",
  review: "Review",
};

export interface BasicsForm {
  title: string;
  slug: string;
  /** The address follows the title until the user edits it. */
  slugEdited: boolean;
  description: string;
  timezone: string;
  /** The zone was chosen (or came from a saved draft), so the organisation's default must not replace it. */
  timezoneSet: boolean;
  starts_at: string | null;
  ends_at: string | null;
  listed: boolean;
}

export interface VenueForm {
  venue_id: string | null;
  /** Chosen rooms with the capacity override as typed ("" = the venue's own capacity). */
  rooms: { room_id: string; override: string }[];
}

export type PassForm = PassTemplate;

/** Unsaved input per step, kept while the wizard is open. */
export interface WizardForms {
  basics?: BasicsForm;
  venue?: VenueForm;
  access?: RuleInput[];
  pass?: PassForm;
}

/** Everything a step needs from the wizard around it. */
export interface StepContext {
  record: EventRecord | null;
  forms: WizardForms;
  setForm: <K extends keyof WizardForms>(key: K, value: WizardForms[K] | undefined) => void;
  /** The server returned a newer record. */
  saved: (record: EventRecord) => void;
  /** Go to a step of this draft. */
  goto: (step: WizardStep, draftId?: string) => void;
  /** Leave the wizard for the events list, the draft kept. */
  close: (record: EventRecord | null) => void;
  /** The draft was published from the review step (the wizard keeps showing the result). */
  onPublished: (record: EventRecord) => void;
  /** A venue's layout, fetched once per wizard. */
  loadVenue: (id: string) => Promise<VenueDetail>;
}

export function defaultPass(title: string): PassTemplate {
  return {
    headline: title,
    note: "Show this at the entrance to collect your wristband.",
    show_tier: true,
    show_sessions: true,
    wallet: true,
  };
}

export const toRuleInput = ({ id: _id, event_id: _event, ...rule }: AccessRule): RuleInput => rule;

/** The event's rooms in the venue's zone order, with the event's capacity, for the matrix. */
export function matrixRooms(venue: VenueDetail, picked: { room_id: string; capacity_override: number | null }[]): MatrixRoom[] {
  const byRoom = new Map(picked.map((p) => [p.room_id, p]));
  const zoneIndex = new Map(venue.zones.map((zone, index) => [zone.id, index]));
  const manyFloors = venue.floors.length > 1;
  return venue.rooms
    .filter((room) => byRoom.has(room.id))
    .map((room, index) => ({ room, index }))
    .sort((a, b) => (zoneIndex.get(a.room.zone_id) ?? 999) - (zoneIndex.get(b.room.zone_id) ?? 999) || a.index - b.index)
    .map(({ room }) => {
      const zone = venue.zones.find((z) => z.id === room.zone_id);
      return {
        id: room.id,
        name: room.name,
        zone: zone ? (manyFloors && zone.floor ? `${zone.floor} · ${zone.name}` : zone.name) : null,
        capacity: byRoom.get(room.id)?.capacity_override ?? room.capacity,
      };
    });
}

/** A step's body. `form` keeps a readable measure; `wide` fits the matrix. The aside holds context. */
export function StepLayout({
  width = "form",
  aside,
  asideLabel,
  asideAlways = false,
  children,
}: {
  width?: "form" | "wide";
  aside?: ReactNode;
  asideLabel?: string;
  /** Show the aside stacked under the step below 1280 too (otherwise only beside it). */
  asideAlways?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-8 px-4 py-6 sm:px-6 xl:gap-10",
        Boolean(aside) && (width === "wide" ? "xl:grid-cols-[minmax(0,60rem)_minmax(16rem,22rem)]" : "xl:grid-cols-[minmax(0,40rem)_minmax(16rem,24rem)]"),
      )}
    >
      <div className={cn("min-w-0", width === "form" ? "max-w-160" : "max-w-240")}>{children}</div>
      {aside ? (
        <aside aria-label={asideLabel} className={cn("min-w-0", asideAlways ? "max-w-160" : "hidden xl:block")}>
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** A quiet ruled heading inside a step, like the D2b form sections. */
export function StepSection({ id, title, children, meta }: { id: string; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
        <h2 id={id} className="text-12 font-medium">
          {title}
        </h2>
        {meta ? <span className="text-11 text-muted-foreground">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Context for the aside: a short ruled list of facts or guidance. */
export function AsideBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="border-b border-border pb-1.5 text-12 font-medium">{title}</h2>
      <div className="mt-2 text-13">{children}</div>
    </div>
  );
}

/**
 * Back on the left; Save and close and the step's completing action on the right. `onContinue`
 * and `onSaveClose` throw to show the failed state (validation messages sit on the fields).
 */
export function WizardFooter({
  onBack,
  onSaveClose,
  onContinue,
  continueLabel = "Continue",
  failedLabel,
  extra,
}: {
  onBack?: () => void;
  onSaveClose?: () => Promise<unknown>;
  onContinue?: () => Promise<unknown>;
  continueLabel?: string;
  failedLabel?: string;
  /** Anything else for the left side (Delete draft). */
  extra?: ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? (
          <Button variant="secondary" size="compact" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
            Back
          </Button>
        ) : null}
        {extra}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onSaveClose ? (
          <ActionButton action={onSaveClose} doneLabel="Draft saved" failedLabel={failedLabel} variant="plain" size="compact" className="text-muted-foreground hover:text-foreground">
            Save and close
          </ActionButton>
        ) : null}
        {onContinue ? (
          <ActionButton type="submit" action={onContinue} doneLabel="Saved" failedLabel={failedLabel} variant="primary" size="compact">
            {continueLabel}
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

/** Focus the first invalid control after errors are shown. */
export function focusFirstInvalid(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>("main [aria-invalid='true'], [data-wizard] [aria-invalid='true']")?.focus();
  });
}
