/**
 * Six boxes for an authenticator code (the `OtpInput` of 06 §2.1). Typing moves to the next box,
 * Backspace on an empty box goes back, arrows move, and pasting or autofilling a whole code fills
 * every box at once. `onComplete` fires when the sixth digit arrives. 44px boxes: comfortable on a
 * phone, and the code is the only thing on the page that needs typing.
 */
import { forwardRef, useImperativeHandle, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@synan/ui/components";

export const CODE_LENGTH = 6;

export interface CodeInputHandle {
  focus(): void;
}

export const CodeInput = forwardRef<
  CodeInputHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onComplete?: (code: string) => void;
    invalid?: boolean;
    disabled?: boolean;
    /** Names the group for assistive tech ("Code from your authenticator"). */
    label: string;
    describedBy?: string;
  }
>(function CodeInput({ value, onChange, onComplete, invalid = false, disabled = false, label, describedBy }, ref) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // The latest value, ahead of React's render: typing fast moves focus before the state settles,
  // and the focus guard below must not pull the caret back to a box that was just filled.
  const latest = useRef(value);
  latest.current = value;
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");

  useImperativeHandle(ref, () => ({
    focus: () => boxes.current[Math.min(latest.current.length, CODE_LENGTH - 1)]?.focus(),
  }));

  const focusAt = (i: number) => {
    const box = boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))];
    box?.focus();
    box?.select();
  };

  const write = (from: number, text: string) => {
    const incoming = text.replace(/\D/g, "");
    if (!incoming) return;
    const next = (latest.current.slice(0, from) + incoming).slice(0, CODE_LENGTH);
    latest.current = next;
    onChange(next);
    if (next.length === CODE_LENGTH) {
      boxes.current[CODE_LENGTH - 1]?.focus();
      onComplete?.(next);
    } else focusAt(next.length);
  };

  const onKeyDown = (i: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const now = latest.current;
      if (now[i]) {
        latest.current = now.slice(0, i) + now.slice(i + 1);
        onChange(latest.current);
      } else if (i > 0) {
        latest.current = now.slice(0, i - 1);
        onChange(latest.current);
        focusAt(i - 1);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(i - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(Math.min(i + 1, latest.current.length));
    }
  };

  const onPaste = (i: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    write(i === 0 ? 0 : Math.min(i, latest.current.length), event.clipboardData.getData("text"));
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex gap-1.5">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={i === 0 ? CODE_LENGTH : 1}
          aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digit}
          onFocus={(event) => {
            // Always type into the first empty box, so a click on the last box cannot leave gaps.
            if (i > latest.current.length) focusAt(latest.current.length);
            else event.target.select();
          }}
          onChange={(event) => write(Math.min(i, latest.current.length), event.target.value)}
          onKeyDown={onKeyDown(i)}
          onPaste={onPaste(i)}
          className={cn(
            "h-11 w-10 bg-field text-center font-mono text-21 text-foreground tabular-nums outline-none transition-[background-color,box-shadow] duration-120 ease-standard hover:bg-field-hover focus-visible:shadow-[inset_0_0_0_2px_var(--brand)] disabled:opacity-50 motion-reduce:transition-none",
            invalid ? "shadow-[inset_0_0_0_1px_var(--destructive),inset_0_-2px_0_var(--destructive)]" : "shadow-[inset_0_-2px_0_var(--field-edge)]",
          )}
        />
      ))}
    </div>
  );
});
