/**
 * The second factor, asked again before a privileged desk action (03 §3): replacing a band
 * (rebind or lost) and resending a pass. The server answers MFA_REQUIRED when the token has
 * not been stepped up recently; `useStepUp()` wraps an action so that answer opens this prompt,
 * and a confirmed code retries the action once. Cancelling leaves everything as it was.
 *
 * MOCK ONLY. On the real API the API client answers MFA_REQUIRED itself with the console's own
 * prompt (access/step-up.tsx), so this one never opens there. On the mock nothing else asks, so
 * this one stands in: marked as a mock on screen, verified by the desk mock. When the console's
 * prompt also runs on the mock, `StepUpProvider` becomes a pass-through and no flow changes.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, Field } from "@synan/ui/components";
import { deskErrorCode, deskFailure, desk, deskIsMock, fieldMessage, isOffline } from "./desk-api";
import { DeskInput } from "./desk-input";
import { StepUpCancelled, StepUpContext, type Guard } from "./step-up-guard";

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const waiting = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  const guard = useCallback<Guard>(async (action) => {
    try {
      return await action();
    } catch (error) {
      if (deskErrorCode(error) !== "MFA_REQUIRED") throw error;
      // Real API: the console's prompt already asked; MFA_REQUIRED here means it was cancelled.
      if (!deskIsMock) throw new StepUpCancelled();
      await new Promise<void>((resolve, reject) => {
        waiting.current = { resolve, reject };
        setOpen(true);
      });
      return action();
    }
  }, []);

  const settle = (confirmed: boolean) => {
    const pending = waiting.current;
    waiting.current = null;
    setOpen(false);
    if (confirmed) pending?.resolve();
    else pending?.reject(new StepUpCancelled());
  };

  return (
    <StepUpContext.Provider value={guard}>
      {children}
      <StepUpDialog open={open} onConfirmed={() => settle(true)} onCancel={() => settle(false)} />
    </StepUpContext.Provider>
  );
}

/** The form mounts per opening, so a code typed last time is never shown again. */
function StepUpDialog({ open, onConfirmed, onCancel }: { open: boolean; onConfirmed: () => void; onCancel: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width="sm"
      title="Confirm it's you"
      description="Replacing a wristband and resending a pass need a code from your authenticator. One code covers the next 15 minutes."
    >
      {open ? <StepUpForm onConfirmed={onConfirmed} onCancel={onCancel} /> : null}
    </Dialog>
  );
}

function StepUpForm({ onConfirmed, onCancel }: { onConfirmed: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (value: string) => {
    if (busy) return;
    if (!/^\d{6}$/.test(value)) {
      setError("Type the six digits your authenticator app shows now.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await desk.verifyMfa({ code: value });
      onConfirmed();
    } catch (failure) {
      const code = deskErrorCode(failure);
      setError(
        isOffline(failure)
          ? "You are offline, so the code could not be checked. Try again when the connection is back."
          : code === "INVALID_MFA_CODE"
            ? "That code was not accepted. Codes change every 30 seconds: type the one showing now."
            : code === "MFA_NOT_ENROLLED"
              ? "Your account has no authenticator yet. Ask an admin to set one up; until then, ask a supervisor to do this step."
              : (fieldMessage(failure, "code") ?? deskFailure(failure, "The code was not checked")),
      );
      setCode("");
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <Field label="Code from your authenticator app" error={error}>
        <DeskInput
          ref={input}
          autoFocus
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="6 digits"
          disabled={busy}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (error) setError(null);
            // Six digits is the whole answer: check it without another tap.
            if (digits.length === 6) void submit(digits);
          }}
          className="font-mono text-21 tracking-[0.3em] placeholder:font-sans placeholder:text-15 placeholder:tracking-normal"
        />
      </Field>
      <p className="mt-3 bg-surface-2 px-3 py-2 text-12 text-muted-foreground">
        <span className="font-mono text-11 tracking-[0.12em] text-foreground">MOCK</span> · On the real API the console's own prompt asks.
        Any six digits are accepted here, except 000000.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2 pt-3">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Confirm
        </Button>
      </div>
    </form>
  );
}
