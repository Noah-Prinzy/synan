/**
 * A small menu button (WAI-ARIA menu button pattern): Enter/Space/ArrowDown open it
 * and focus the first item, arrows move, Escape closes and returns focus, a click
 * outside closes. Hand-rolled rather than Radix to keep the chrome's JS small; swap
 * for Radix DropdownMenu if it grows submenus or typeahead.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function Menu({
  button,
  buttonLabel,
  buttonClassName,
  align = "start",
  onOpen,
  children,
}: {
  button: ReactNode;
  buttonLabel?: string;
  buttonClassName?: string;
  align?: "start" | "end";
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  const onKey = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      all[(index + 1) % all.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      all[(index - 1 + all.length) % all.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      all[all.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className="relative flex h-full min-w-0 flex-1 items-stretch">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={buttonLabel}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            onOpen?.();
            setOpen(true);
          }
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          onKeyDown={onKey}
          className={`absolute top-full z-40 mt-px max-h-[calc(100dvh-4rem)] w-max max-w-[min(26rem,calc(100vw-1rem))] min-w-64 overflow-y-auto overscroll-contain border border-border bg-popover py-1 text-13 max-sm:fixed max-sm:inset-x-2 max-sm:top-12 max-sm:w-auto max-sm:max-w-none max-sm:min-w-0 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children(() => close())}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  current = false,
}: {
  onSelect: () => void;
  children: ReactNode;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-current={current || undefined}
      onClick={onSelect}
      className="relative flex w-full items-start gap-3 px-3 py-2 text-left outline-none transition-colors duration-120 ease-standard before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 hover:bg-muted/60 focus-visible:bg-muted/60 aria-[current=true]:before:bg-brand motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

export function MenuNote({ children }: { children: ReactNode }) {
  return <div className="border-b border-border px-3 pt-1.5 pb-2 text-12 text-muted-foreground">{children}</div>;
}
