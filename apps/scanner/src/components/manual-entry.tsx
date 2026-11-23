/**
 * ManualUidEntry (docs/06 S2 "123"): type a wristband number, or let a USB/Bluetooth
 * reader type it. The field takes letters A–F and digits, never autocorrects or
 * capitalises words, and Enter (the keyboard's Go key) checks it.
 */
import { useRef, useState, type FormEvent } from "react";
import { Sheet } from "./sheet";

export function ManualEntry({
  open,
  onClose,
  onSubmit,
  returnTo,
  perimeter,
}: {
  open: boolean;
  onClose: () => void;
  /** Return false when the text is not a wristband number or a pass code. */
  onSubmit: (value: string) => boolean;
  returnTo: { current: HTMLElement | null };
  perimeter: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    setValue("");
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Type the wristband number first.");
      return;
    }
    if (!onSubmit(value)) {
      setError("That isn't a wristband number. It is 8 to 32 characters: digits and the letters A to F.");
      return;
    }
    close();
  };

  return (
    <Sheet open={open} onClose={close} title="Type a wristband number" returnTo={returnTo} initial={input}>
      <form onSubmit={submit} noValidate className="mt-4">
        <label htmlFor="manual-uid" className="text-13 font-medium text-muted-foreground">
          Wristband number{perimeter ? " or pass code" : ""}
        </label>
        <input
          ref={input}
          id="manual-uid"
          name="uid"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "manual-uid-error" : "manual-uid-hint"}
          className="mt-2 min-h-14 w-full border border-input bg-background px-3 font-mono text-21 tracking-wider uppercase focus:border-brand focus-visible:outline-none"
        />
        {error ? (
          <p id="manual-uid-error" role="alert" className="mt-2 text-15 text-destructive">
            {error}
          </p>
        ) : (
          <p id="manual-uid-hint" className="mt-2 text-15 text-muted-foreground">
            A reader plugged into this device types it for you.
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={close} className="pressable min-h-14 border border-border text-17">
            Cancel
          </button>
          <button type="submit" className="pressable min-h-14 border border-transparent bg-action text-17 font-medium text-action-foreground">
            Check
          </button>
        </div>
      </form>
    </Sheet>
  );
}
