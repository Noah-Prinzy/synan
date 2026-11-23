/**
 * ReadinessChecklist (docs/06 D5 review, D6.1 overview; P-13): what an event still needs before
 * it can be published. Each line is a shape + a word + the requirement and what was found:
 *   ok (square)    met
 *   stop (diamond) unmet, and publishing is refused until it is
 *   warn (triangle) unmet, recommended but not blocking
 * Unmet lines that a wizard step can fix offer "Fix" when `onFix` is given.
 */
import type { JSX } from "react";
import type { ReadinessItem, WizardStep } from "@synan/mock/command";
import { cn } from "@synan/ui/components";
import { SignalShape, signalTone, type SignalState } from "@synan/ui/data";

function stateOf(item: ReadinessItem): SignalState {
  if (item.met) return "ok";
  return item.blocking ? "stop" : "warn";
}

const WORD: Record<"ok" | "stop" | "warn", string> = { ok: "Done", stop: "Required", warn: "Suggested" };

/** "Ready to publish" or "2 things to do before publishing". */
export function readinessSummary(items: ReadinessItem[]): { ready: boolean; text: string; suggestions: number } {
  const blocking = items.filter((item) => item.blocking && !item.met).length;
  const suggestions = items.filter((item) => !item.blocking && !item.met).length;
  if (blocking === 0) return { ready: true, text: "Ready to publish", suggestions };
  return { ready: false, text: `${blocking} ${blocking === 1 ? "thing" : "things"} to do before publishing`, suggestions };
}

export function ReadinessChecklist({
  items,
  onFix,
  title = "Readiness",
}: {
  items: ReadinessItem[];
  onFix?: (step: WizardStep) => void;
  title?: string;
}): JSX.Element {
  const summary = readinessSummary(items);
  return (
    <section aria-label={title} className="min-w-0 border border-border">
      <header className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 border-b border-border px-4">
        <h2 className="py-1.5 text-12 font-medium">{title}</h2>
        <p role="status" className={cn("flex items-center gap-1.5 py-1.5 text-12", summary.ready ? "text-success" : "text-foreground")}>
          <SignalShape state={summary.ready ? "ok" : "stop"} className={summary.ready ? undefined : "text-destructive"} />
          {summary.text}
          {summary.suggestions > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              · {summary.suggestions} {summary.suggestions === 1 ? "suggestion" : "suggestions"}
            </span>
          ) : null}
        </p>
      </header>
      <ul>
        {items.map((item) => {
          const state = stateOf(item) as "ok" | "stop" | "warn";
          const fixable = !item.met && item.step !== null && onFix;
          return (
            <li key={item.key} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border px-4 py-2 last:border-b-0">
              <SignalShape state={state} className={cn("mt-1", signalTone(state))} />
              <div className="min-w-0">
                <p className="text-13">
                  {item.label}
                  <span className="sr-only">: {WORD[state]}.</span>
                </p>
                <p className="mt-0.5 text-12 text-muted-foreground">{item.detail}</p>
              </div>
              <div className="flex items-center gap-3 pt-0.5">
                <span aria-hidden="true" className={cn("text-11", item.met ? "text-muted-foreground" : signalTone(state))}>
                  {WORD[state]}
                </span>
                {fixable ? (
                  <button
                    type="button"
                    onClick={() => onFix(item.step as WizardStep)}
                    aria-label={`Fix: ${item.label}`}
                    className="text-12 text-foreground underline decoration-border underline-offset-4 transition-colors duration-120 ease-standard hover:decoration-brand motion-reduce:transition-none pointer-coarse:py-2"
                  >
                    Fix
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
