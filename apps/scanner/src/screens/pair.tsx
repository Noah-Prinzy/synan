/**
 * S1 · Choose gate (docs/06 §3.2). The staff member's assignments for this shift as large
 * rows; a gate outside the shift is shown with the plain reason and cannot be chosen
 * (P-15). Scanning a printed gate code arrives in Phase 3.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import { EVENT, GATES } from "../data/mock";
import { pairGate, useScanner } from "../data/store";

export default function Pair() {
  const { gateId } = useScanner();
  const navigate = useNavigate();
  const ended = Boolean((useLocation().state as { ended?: boolean } | null)?.ended);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-6 pb-4 sm:px-6">
        {ended ? (
          <p role="status" className="mb-5 border border-border px-4 py-3 text-15">
            Shift ended. Hand this device to your supervisor.
          </p>
        ) : null}
        <p className="text-13 font-medium text-muted-foreground">{EVENT.title}</p>
        <h1 className="mt-1 text-28 font-medium leading-tight">Choose your gate</h1>
        <p className="mt-2 text-15 text-muted-foreground">Your gates for this shift.</p>
      </div>
      <ul className="border-t border-border">
        {GATES.map((gate) => {
          const current = gate.id === gateId;
          const body = (
            <>
              <span className="min-w-0">
                <span className="block text-17 font-medium">{gate.label}</span>
                <span className="mt-0.5 block text-15 text-muted-foreground">
                  {gate.perimeter ? "Entrance · passes and wristbands" : `Inside · wristbands only${gate.roomName ? ` · ${gate.roomName}` : ""}`}
                </span>
                {gate.shift.now ? null : (
                  <span className="mt-1 block text-15 text-warning">
                    {ERROR_COPY.OUTSIDE_SHIFT.message} Your shift here starts at <span className="font-mono">{gate.shift.starts}</span>.
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-13 text-muted-foreground">
                  {gate.shift.starts}–{gate.shift.ends}
                </span>
                {current ? <span className="mt-1 block text-13 text-foreground">Current</span> : null}
              </span>
            </>
          );
          return (
            <li key={gate.id} className="border-b border-border">
              {gate.shift.now ? (
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    pairGate(gate);
                    navigate("/", { replace: true });
                  }}
                  className={`pressable relative flex min-h-18 w-full items-center justify-between gap-4 border border-transparent px-4 py-3 text-left sm:px-6`}
                >
                  {current ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
                  {body}
                </button>
              ) : (
                <div aria-disabled="true" className="flex min-h-18 items-center justify-between gap-4 px-4 py-3 opacity-80 sm:px-6">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
