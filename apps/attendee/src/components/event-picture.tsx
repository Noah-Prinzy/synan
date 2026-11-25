import type { ReactNode } from "react";
import { dateParts } from "../data/format";
import type { EventSummary } from "../data/events";

/** "22 November", or "22–23 November" for an event over several days, in the event's own time zone. */
export function dateRange(event: EventSummary): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: event.timezone }).format(new Date(iso));
  const first = fmt(event.startsAt, { day: "numeric", month: "long" });
  const last = fmt(event.endsAt, { day: "numeric", month: "long" });
  if (first === last) return first;
  const [d1, m1] = first.split(" ");
  const [d2, m2] = last.split(" ");
  return m1 === m2 ? `${d1}–${d2} ${m1}` : `${first} – ${last}`;
}

/** Shared between a showcase card and its event page, so the picture can morph from one to the other. */
export function pictureName(slug: string): string {
  return `event-${slug.replace(/[^a-z0-9-]/gi, "")}`;
}

/**
 * The event's picture (D-37): the organiser's photograph, cropped to the slot; or, when there is
 * none, the designed cover. The cover is the event without a picture, on purpose: a quiet tonal
 * ground, one soft light in the accent, a still field of points, and the date set large. It reads
 * as designed, not missing. Fills its parent; `big` is the event page's full-width hero.
 */
export function EventPicture({ event, big = false, children }: { event: EventSummary; big?: boolean; children?: ReactNode }) {
  if (event.image) {
    return (
      <div className="relative size-full overflow-hidden bg-surface-2">
        <img src={event.image} alt="" className="absolute inset-0 size-full object-cover" loading={big ? "eager" : "lazy"} />
        {children}
      </div>
    );
  }
  const { day, month } = dateParts(event.startsAt, event.timezone);
  return (
    <div className="relative size-full overflow-hidden bg-surface-2">
      <div
        aria-hidden="true"
        className="absolute -inset-[20%] bg-[radial-gradient(42%_52%_at_24%_28%,color-mix(in_srgb,var(--brand)_24%,transparent),transparent_70%),radial-gradient(40%_40%_at_82%_88%,color-mix(in_srgb,var(--brand)_10%,transparent),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--foreground)_18%,transparent)_1px,transparent_1.4px)] bg-size-[24px_24px] [mask-image:radial-gradient(70%_80%_at_30%_35%,#000_20%,transparent_80%)]"
      />
      {children}
      {big ? null : (
        <p aria-hidden="true" className="absolute right-[6%] bottom-[6%] flex items-baseline gap-2.5 text-15 font-medium text-muted-foreground">
          <span className="font-mono text-56 leading-none tracking-[-0.04em] text-foreground/80">{day}</span>
          {month}
        </p>
      )}
    </div>
  );
}
