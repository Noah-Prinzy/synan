/**
 * Recount (D-10): set a room's count to an observed headcount. Audited server-side.
 * A native <dialog> opened modally: focus is trapped, Escape cancels, and focus
 * returns to the control that opened it.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ERROR_COPY } from "@synan/contracts/copy";
import { formatNumber } from "@synan/ui/data";
import { ActionButton } from "@synan/ui/components";
import { useCommand } from "../live/context";
import { useSlice } from "../live/slice";

export function RecountDialog({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  const { store } = useCommand();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const layout = useSlice(store.layout);
  const rooms = useSlice(store.rooms);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const titleId = useId();
  const hintId = useId();
  const room = layout?.rooms.find((r) => r.id === roomId);
  const live = roomId ? rooms.get(roomId) : undefined;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (roomId && !el.open) {
      opener.current = document.activeElement;
      setCount("");
      setNote("");
      setState("idle");
      el.showModal();
    } else if (!roomId && el.open) {
      el.close();
    }
  }, [roomId]);

  const close = () => {
    onClose();
    (opener.current as HTMLElement | null)?.focus?.();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const n = Number(count);
    if (!roomId || !Number.isInteger(n) || n < 0) return;
    setState("saving");
    try {
      await store.recount(roomId, n, note.trim() || undefined);
      close();
    } catch {
      setState("error");
    }
  };

  const valid = count !== "" && Number.isInteger(Number(count)) && Number(count) >= 0;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto w-full max-w-96 border border-foreground/25 bg-popover p-0 text-13 text-foreground backdrop:bg-scrim"
    >
      {room ? (
        <form onSubmit={submit}>
          <header className="border-b border-border px-4 pt-3 pb-2.5">
            <h2 id={titleId} className="text-15 font-medium">
              Recount {room.name}
            </h2>
            <p id={hintId} className="mt-1 text-12 text-muted-foreground">
              Sets the count to the headcount you observed. Recorded in the audit log with your name.
            </p>
          </header>
          <div className="grid grid-cols-2 border-b border-border">
            <div className="border-r border-border px-4 py-3">
              <p className="text-11 text-muted-foreground">Counted now</p>
              <p className="font-mono text-21 tabular-nums">{live ? formatNumber(live.occupancy) : "—"}</p>
            </div>
            <label className="block px-4 py-3">
              <span className="text-11 text-muted-foreground">Headcount</span>
              <input
                autoFocus
                required
                inputMode="numeric"
                pattern="[0-9]*"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))}
                className="mt-0.5 block w-full border-b border-border bg-transparent font-mono text-21 tabular-nums outline-none focus:border-brand"
              />
            </label>
          </div>
          <label className="block border-b border-border px-4 py-3">
            <span className="text-11 text-muted-foreground">Note (optional)</span>
            <input
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Counted from the balcony at 11:50"
              className="mt-1 block w-full bg-transparent text-13 outline-none placeholder:text-muted-foreground/60"
            />
          </label>
          {state === "error" ? (
            <p role="alert" className="border-b border-border px-4 py-2 text-12 text-destructive">
              {ERROR_COPY.INTERNAL.title}. {ERROR_COPY.INTERNAL.message}
            </p>
          ) : null}
          <footer className="grid grid-cols-2">
            <button type="button" onClick={close} className="border-r border-border px-4 py-2.5 text-left text-13 text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <ActionButton
              variant="primary"
              disabled={!valid}
              keepDone
              doneLabel="Count set"
              action={async () => {
                const n = Number(count);
                if (!roomId || !Number.isInteger(n) || n < 0) throw new Error("invalid");
                await store.recount(roomId, n, note.trim() || undefined);
                window.setTimeout(close, 700);
              }}
              className="h-full justify-items-start px-4 py-2.5 text-13"
            >
              {valid ? `Set count to ${formatNumber(Number(count))}` : "Set count"}
            </ActionButton>
          </footer>
        </form>
      ) : null}
    </dialog>
  );
}
