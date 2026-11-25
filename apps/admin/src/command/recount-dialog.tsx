/**
 * Recount (D-10): set a room's count to an observed headcount. Audited server-side.
 * A native <dialog> opened modally: focus is trapped, Escape cancels, and focus
 * returns to the control that opened it.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ERROR_COPY } from "@synan/contracts/copy";
import { formatNumber } from "@synan/ui/data";
import { ActionButton, Button, controlClass } from "@synan/ui/components";
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
      className="m-auto w-[calc(100vw-2rem)] max-w-104 bg-solid p-0 text-13 text-foreground shadow-pop backdrop:bg-scrim"
    >
      {room ? (
        <form onSubmit={submit}>
          <header className="px-6 pt-6">
            <h2 id={titleId} className="font-display text-21 leading-snug">
              Recount {room.name}
            </h2>
            <p id={hintId} className="mt-1 text-13 text-muted-foreground">
              Sets the count to the headcount you observed. Recorded in the audit log with your name.
            </p>
          </header>
          <div className="grid grid-cols-2 gap-4 px-6 pt-5">
            <div>
              <p className="text-12 text-muted-foreground">Counted now</p>
              <p className="mt-1.5 font-mono text-28 leading-none tabular-nums">{live ? formatNumber(live.occupancy) : "—"}</p>
            </div>
            <label className="block">
              <span className="text-12 text-muted-foreground">Headcount</span>
              <input
                autoFocus
                required
                inputMode="numeric"
                pattern="[0-9]*"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ""))}
                className={controlClass("compact", false, "mt-1.5 block h-10 font-mono text-21 tabular-nums")}
              />
            </label>
          </div>
          <label className="block px-6 pt-4">
            <span className="text-12 text-muted-foreground">Note (optional)</span>
            <input
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Counted from the balcony at 11:50"
              className={controlClass("compact", false, "mt-1.5 block")}
            />
          </label>
          {state === "error" ? (
            <p role="alert" className="px-6 pt-3 text-13 text-destructive">
              {ERROR_COPY.INTERNAL.title}. {ERROR_COPY.INTERNAL.message}
            </p>
          ) : null}
          <footer className="flex flex-wrap items-center justify-end gap-2 px-6 pt-6 pb-6">
            <Button type="button" size="compact" variant="quiet" onClick={close}>
              Cancel
            </Button>
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
              size="compact"
            >
              {valid ? `Set count to ${formatNumber(Number(count))}` : "Set count"}
            </ActionButton>
          </footer>
        </form>
      ) : null}
    </dialog>
  );
}
