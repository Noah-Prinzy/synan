/**
 * Pieces every desk flow shares: the frame a step sits in, quick reasons as square chips, the
 * "what will happen" list, and the reward when a flow completes.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { RewardMoment, cn } from "@synan/ui/components";
import { SignalShape, type SignalState } from "@synan/ui/data";
import { GUTTER_X } from "../kit";

export type DeskOutcome =
  | { kind: "bound"; band: string; via: "scan" | "code" }
  | { kind: "rebound"; band: string; old: string | null }
  | { kind: "replaced"; band: string; old: string | null; emailed: boolean }
  | { kind: "resent"; to: string };

/** A flow's step: a ruled head with its title and a way out, then the body. */
export function FlowFrame({
  id,
  title,
  description,
  onCancel,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  onCancel?: () => void;
  children: ReactNode;
}) {
  // A step the clerk opened brings itself into view: on a phone it starts below the fold. Only
  // when its head is off screen, so nothing moves on a tablet or a laptop.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onCancel) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section ref={ref} aria-labelledby={id} className="scroll-mt-14">
      <header className={cn("flex items-start justify-between gap-3 pt-5", GUTTER_X)}>
        <div className="max-w-160 min-w-0">
          <h3 id={id} className="text-15 font-medium">
            {title}
          </h3>
          {description ? <div className="mt-1 text-13 leading-relaxed text-muted-foreground">{description}</div> : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={`Cancel: ${title}`}
            className="pressable -mt-2 -mr-2 grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {/* Fields keep a form's measure (40rem), so a wide pane never stretches them. */}
      <div className={cn("pt-4 pb-6", GUTTER_X)}>
        <div className="flex max-w-160 flex-col gap-4">{children}</div>
      </div>
    </section>
  );
}

/** Quick answers that fill a reason field with one tap. The chosen one carries the brand border. */
export function ReasonChips({ options, value, onPick }: { options: readonly string[]; value: string; onPick: (reason: string) => void }) {
  return (
    <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = value.trim() === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(option)}
            className={cn(
              "pressable min-h-11 px-3 text-13",
              on ? "bg-foreground text-background" : "bg-surface-2 text-foreground hover:bg-surface-3",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** What the action will do, one consequence per line, each with its state's shape. */
export function Consequences({ items }: { items: { signal: SignalState; text: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-3 text-13 leading-relaxed">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2.5">
          <SignalShape
            state={item.signal}
            className={cn("mt-1.5", item.signal === "stop" ? "text-destructive" : item.signal === "warn" ? "text-warning" : item.signal === "ok" ? "text-success" : "text-muted-foreground")}
          />
          <span className="min-w-0">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The moment a desk action lands: a drawn check, the word, one blue rule, then what it means. */
export function OutcomePanel({ outcome, name }: { outcome: DeskOutcome; name: string }) {
  const word = {
    bound: "Band bound",
    rebound: "Band rebound",
    replaced: "Lost band replaced",
    resent: "Pass sent",
  }[outcome.kind];
  let detail: ReactNode;
  switch (outcome.kind) {
    case "bound":
      detail = (
        <>
          Band <Mono>{outcome.band}</Mono> is now {name}'s{outcome.via === "code" ? ", bound from their phone" : ""}. It opens their doors
          from the first tap.
        </>
      );
      break;
    case "rebound":
      detail = (
        <>
          Band <Mono>{outcome.band}</Mono> replaces {outcome.old ? <Mono>{outcome.old}</Mono> : "the old band"}, which no longer opens
          any gate. Their pass is unchanged.
        </>
      );
      break;
    case "replaced":
      detail = (
        <>
          {outcome.old ? <Mono>{outcome.old}</Mono> : "The old band"} is marked lost. {name} has a new pass and band{" "}
          <Mono>{outcome.band}</Mono>.{outcome.emailed ? " The new pass is on its way to their email." : ""}
        </>
      );
      break;
    case "resent":
      detail = (
        <>
          A fresh copy went to <span className="break-all text-foreground">{outcome.to}</span>. Ask them to look in spam if it has not arrived
          in a minute.
        </>
      );
      break;
  }
  return (
    <div role="status" className={cn("py-5", GUTTER_X)}>
      <RewardMoment className="text-17 font-medium">{word}</RewardMoment>
      <p className="mt-2 max-w-120 text-13 leading-relaxed text-muted-foreground">{detail}</p>
      <p className="mt-1 text-12 text-muted-foreground">The search is ready for the next person.</p>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-12 text-foreground tabular-nums">{children}</span>;
}
