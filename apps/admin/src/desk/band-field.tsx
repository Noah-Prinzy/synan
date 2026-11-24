/**
 * Where a band number arrives. A USB or Bluetooth reader behaves as a keyboard: it types the
 * UID into the focused field and presses Enter, so Enter submits. A clerk without a reader
 * types the number printed inside the band. Spaces, colons and dashes are tolerated; the value
 * is shown in capitals, in mono, as it is printed.
 *
 * After a refusal the text is selected, so the next scan replaces it instead of appending.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { Nfc } from "lucide-react";
import { Field } from "@synan/ui/components";
import { DeskInput } from "./desk-input";
import { scanTargets, type ScanTarget } from "./scan";

export interface BandFieldHandle {
  focus: (select?: boolean) => void;
}

export const BandField = forwardRef<
  BandFieldHandle,
  {
    label: ReactNode;
    hint?: ReactNode;
    value: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    error?: string | null;
    disabled?: boolean;
    autoFocus?: boolean;
  }
>(function BandField({ label, hint, value, onChange, onSubmit, error, disabled, autoFocus }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const submit = useRef(onSubmit);
  submit.current = onSubmit;
  const change = useRef(onChange);
  change.current = onChange;

  useImperativeHandle(ref, () => ({
    focus: (select = false) => {
      input.current?.focus();
      if (select) input.current?.select();
    },
  }));

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // A refusal selects the number, so the next scan replaces it.
  useEffect(() => {
    if (error && document.activeElement === input.current) input.current?.select();
  }, [error]);

  useEffect(() => {
    const target: ScanTarget = (uid) => {
      change.current(uid);
      input.current?.focus();
      submit.current(uid);
    };
    scanTargets.push(target);
    return () => {
      const index = scanTargets.indexOf(target);
      if (index >= 0) scanTargets.splice(index, 1);
    };
  }, []);

  return (
    <Field label={label} hint={hint} error={error}>
      <DeskInput
        ref={input}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!disabled) onSubmit(event.currentTarget.value);
          }
        }}
        placeholder="Scan or type the band number"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        lead={<Nfc size={16} strokeWidth={1.5} />}
        className="font-mono tracking-wide placeholder:font-sans placeholder:tracking-normal"
      />
    </Field>
  );
});
