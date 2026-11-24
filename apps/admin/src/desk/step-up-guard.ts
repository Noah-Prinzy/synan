/**
 * What a flow uses to run a privileged action behind the second factor (the prompt itself is
 * `StepUpProvider` in step-up.tsx): `const stepUp = useStepUp(); await stepUp(() => call())`.
 */
import { createContext, useContext } from "react";

/** Thrown into the flow when the clerk closes the prompt: nothing happened, nothing to report. */
export class StepUpCancelled extends Error {
  constructor() {
    super("step-up cancelled");
    this.name = "StepUpCancelled";
  }
}

export type Guard = <T>(action: () => Promise<T>) => Promise<T>;

export const StepUpContext = createContext<Guard | null>(null);

export function useStepUp(): Guard {
  const guard = useContext(StepUpContext);
  if (!guard) throw new Error("useStepUp outside StepUpProvider");
  return guard;
}
