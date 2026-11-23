import { useEffect, useRef, useState } from "react";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import type { GateTone, ScanResult } from "@synan/contracts/enums";
import { MockClock, MockRealtime, createPortalStore, type ScenarioName } from "@synan/mock";
import { Placeholder } from "./placeholder";

/** Minimum time a verdict stays on screen so the operator can read it (docs/05 §7). */
const DWELL_MS = 2000;

const toneText: Record<GateTone, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
  none: "text-muted-foreground",
};
const toneRule: Record<GateTone, string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  none: "bg-border",
};

// Placeholder wiring: the mock realtime stands in for this gate's scan stream.
const clock = new MockClock();
const realtime = new MockRealtime({ clock, portal: createPortalStore({ clock }) });
const thisGate = realtime.gates[0];

const demos: ScenarioName[] = ["doors_open", "impossible_travel", "offline_conflict"];

export default function Scan() {
  const [shown, setShown] = useState<{ result: ScanResult; offline: boolean } | null>(null);
  const shownAt = useRef(0);
  const pending = useRef<{ result: ScanResult; offline: boolean } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const show = (next: { result: ScanResult; offline: boolean }) => {
      setShown(next);
      shownAt.current = performance.now();
    };
    const unsubscribe = realtime.subscribe("/stream/scans", (message) => {
      if (message.type !== "scan.result") return;
      if (thisGate && message.data.checkpoint_id !== thisGate.id) return;
      if (!SCAN_RESULT_COPY[message.data.result].shownAtGate) return;
      const next = { result: message.data.result, offline: message.data.offline };
      const waited = performance.now() - shownAt.current;
      if (waited >= DWELL_MS) {
        show(next);
        return;
      }
      pending.current = next;
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (pending.current) show(pending.current);
          pending.current = null;
        }, DWELL_MS - waited);
      }
    });
    return () => {
      unsubscribe();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = shown ? SCAN_RESULT_COPY[shown.result] : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Viewfinder area: top 60%. Camera and NFC arrive in Phase 3. */}
      <div className="flex basis-3/5 items-center justify-center border-b border-border">
        <div aria-hidden="true" className="size-48 border border-foreground/60" />
      </div>

      <section aria-live="assertive" aria-label="Verdict" className="relative flex basis-2/5 flex-col justify-center px-4 py-6">
        {copy && shown ? (
          <>
            <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 ${toneRule[copy.tone]}`} />
            <p className={`font-mono text-11 uppercase tracking-[0.14em] ${toneText[copy.tone]}`}>
              {thisGate?.label}
              {shown.offline ? " · LOCAL" : ""}
            </p>
            <p className={`mt-2 text-56 font-semibold leading-none tracking-tight sm:text-96 ${toneText[copy.tone]}`}>
              {copy.label}
            </p>
            <p className="mt-3 text-15 text-muted-foreground">{copy.instruction}</p>
          </>
        ) : (
          <Placeholder
            id="S2"
            title="Scan"
            purpose="Viewfinder above, one verdict panel here: admitted, already inside, or denied with the reason in words. Verdicts stay at least two seconds."
          >
            <div className="flex flex-wrap gap-2">
              {demos.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => realtime.play(name)}
                  className="border border-border px-3 py-2 font-mono text-11 uppercase tracking-[0.12em] text-muted-foreground hover:border-brand hover:text-foreground"
                >
                  Replay {name}
                </button>
              ))}
            </div>
          </Placeholder>
        )}
      </section>
    </div>
  );
}
