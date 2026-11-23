/**
 * A bottom sheet (manual entry) or a centred dialog (shift end) over the scan screen.
 * Square, hairline, on the ground colour; a scrim behind. Focus stays inside, Escape and
 * the scrim close it, and a sheet rides above the on-screen keyboard.
 */
import { useRef, type ReactNode } from "react";
import { useKeyboardInset, useModal } from "../../../../packages/ui/src/components/mobile";

export function Sheet({
  open,
  onClose,
  title,
  children,
  placement = "bottom",
  returnTo,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  placement?: "bottom" | "center";
  returnTo?: { current: HTMLElement | null };
  initial?: { current: HTMLElement | null };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, open, onClose, { returnTo, initial });
  const keyboard = useKeyboardInset(open && placement === "bottom");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ paddingBottom: keyboard }}>
      <div aria-hidden="true" className="fade-in absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fade-in relative mt-auto w-full border-t border-border bg-background pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-5 ${
          placement === "center" ? "mx-auto mb-auto max-w-md border" : "sm:mx-auto sm:max-w-lg sm:border-x"
        }`}
      >
        <h2 className="text-21 font-medium">{title}</h2>
        {children}
      </div>
    </div>
  );
}
