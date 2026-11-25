/**
 * PassTemplatePreview (docs/06 D5 step 4): the pass as the attendee portal shows it
 * (apps/attendee screens/pass.tsx), at phone width, filled with a sample attendee. Static:
 * the code is a fixed pattern on the pure white field, labelled as a sample so it is never
 * mistaken for a working code.
 */
import type { JSX } from "react";
import { CalendarDays, Wallet } from "lucide-react";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { PassTemplate } from "@synan/mock/command";
import { TIER_LABEL } from "../../kit";

const SIZE = 25;

/** A fixed QR-like pattern: three finder squares and seeded modules. Not a real code. */
const SAMPLE_PATH = (() => {
  let seed = 0x5a17;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const finder = (x: number, y: number) => x < 8 && y < 8;
  const inFinder = (x: number, y: number) => finder(x, y) || finder(SIZE - 1 - x, y) || finder(x, SIZE - 1 - y);
  const finderOn = (x: number, y: number) => {
    const fx = x < 8 ? x : SIZE - 1 - x;
    const fy = y < 8 ? y : SIZE - 1 - y;
    if (fx === 7 || fy === 7) return false; // separator
    const ring = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
    return ring === 3 || ring <= 1;
  };
  let d = "";
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const on = inFinder(x, y) ? finderOn(x, y) : y === 6 || x === 6 ? (x + y) % 2 === 0 : next() < 0.48;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
})();

function SampleCode() {
  return (
    <figure className="flex flex-col items-center">
      <div className="w-full max-w-50 border border-qr-ink bg-qr-field p-3">
        <svg viewBox={`-1 -1 ${SIZE + 2} ${SIZE + 2}`} role="img" aria-label="Sample code" className="block h-auto w-full text-qr-ink" shapeRendering="crispEdges">
          <path d={SAMPLE_PATH} fill="currentColor" />
        </svg>
      </div>
      <figcaption className="mt-2 text-12 text-muted-foreground">Sample code</figcaption>
    </figure>
  );
}

export function PassPreview({
  template,
  eventTitle,
  dates,
  venue,
  tier = "ORDINARY",
}: {
  template: PassTemplate;
  eventTitle: string;
  dates: string;
  venue: string | null;
  tier?: AttendeeTier;
}): JSX.Element {
  const headline = template.headline.trim();
  const note = template.note.trim();
  return (
    <article aria-label="Pass preview" className="w-full max-w-80 bg-background text-foreground">
      <header className="px-4 py-3.5">
        <p className="font-display text-17 leading-tight text-balance">{eventTitle.trim() || "Untitled event"}</p>
        {headline && headline !== eventTitle.trim() ? <p className="mt-1 text-13 text-foreground/90">{headline}</p> : null}
        <p className="mt-1.5 text-12 text-muted-foreground">
          <span className="font-mono tabular-nums">{dates}</span>
          {venue ? <> · {venue}</> : null}
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto]">
        <div className="px-4 py-3">
          <p className="text-12 text-muted-foreground">Guest</p>
          <p className="mt-0.5 font-display text-21 leading-none">Sample Attendee</p>
        </div>
        {template.show_tier ? (
          <div className="flex flex-col justify-end px-4 py-3">
            <p className="text-12 text-muted-foreground">Tier</p>
            <p className="mt-0.5 font-mono text-13">{TIER_LABEL[tier]}</p>
          </div>
        ) : null}
      </div>

      <div aria-hidden="true" className="mx-6 h-1 bg-[radial-gradient(circle,var(--muted-foreground)_1px,transparent_1.5px)] bg-size-[8px_4px] opacity-50" />

      <div className="px-6 pt-4 pb-4">
        <SampleCode />
        {note ? <p className="mt-3 text-center text-12 leading-relaxed text-muted-foreground">{note}</p> : null}
      </div>

      {template.show_sessions ? (
        <div className="flex items-center gap-2 px-4 py-2.5 text-12">
          <CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" className="text-muted-foreground" />
          <span>Your sessions</span>
          <span className="ml-auto text-12 text-muted-foreground">
            <span className="font-mono tabular-nums">3</span> booked
          </span>
        </div>
      ) : null}
      {template.wallet ? (
        <div className="flex items-center gap-2 px-4 py-2.5 text-12">
          <Wallet size={14} strokeWidth={1.5} aria-hidden="true" className="text-muted-foreground" />
          <span>Add to Wallet</span>
        </div>
      ) : null}
    </article>
  );
}
