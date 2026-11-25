/**
 * Dialog — a native <dialog> opened modally (docs/05 §7 tier 1). The browser traps focus,
 * makes the page behind inert and puts the dialog in the top layer, so nothing can clip it
 * or sit above it. Escape and the scrim close it; focus returns to whatever opened it.
 *
 * Opaque, square, no outline (D-37): the solid ground with the pop depth; the scrim is the one
 * dark wash (--scrim). Title, body and actions are separated by space, not rules. Sized to the
 * content up to `width`, never wider than the viewport, and scrolls inside its body when tall.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** The action row. Put the completing action last (right). */
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  /** A danger-zone dialog: the title is set in the stop colour. */
  tone?: "neutral" | "danger";
  /** Close when the scrim is clicked (default true). */
  dismissible?: boolean;
  className?: string;
}

const widths = { sm: "max-w-96", md: "max-w-120", lg: "max-w-160" } as const;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
  tone = "neutral",
  dismissible = true,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
      opener.current?.focus?.();
    }
  }, [open]);

  // Unmounting while open: hand focus back.
  useEffect(() => () => opener.current?.focus?.(), []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] border-0 bg-solid p-0 text-13 text-foreground shadow-pop backdrop:bg-scrim",
        widths[width],
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="shrink-0 px-6 pt-6 pb-2">
            <h2 id={titleId} className={cn("font-display text-21 leading-snug", tone === "danger" && "text-destructive")}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-13 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </header>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div> : null}
          {footer ? (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-2 pb-6">{footer}</footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
