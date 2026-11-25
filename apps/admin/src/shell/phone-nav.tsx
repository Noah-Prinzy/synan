/**
 * Navigation on a phone (below 640px): the sections give way to a Menu button at the end of the
 * top bar that opens them as one full-height sheet — each section's name in mono capitals over
 * its pages in large words, the current one marked. A native modal <dialog>: focus is trapped,
 * Escape closes, focus returns to Menu.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { Wordmark } from "@synan/ui/brand";
import { cn } from "@synan/ui/components";
import type { NavSection } from "../routes";
import { currentEntry } from "./sections";

const ICON_CELL = "grid size-11 shrink-0 place-items-center text-foreground hover:bg-surface-2 aria-expanded:bg-surface-2";

/** `groups` is the signed-in role's navigation (`navFor`), the same the top bar shows. */
export function PhoneNav({ groups }: { groups: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const current = currentEntry(groups, location.pathname);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Following a link closes the sheet.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex items-center sm:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={cn(ICON_CELL, "bg-surface-2")}>
        <MenuIcon size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">Menu</span>
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-full max-w-none flex-col bg-solid p-0 text-13 text-foreground backdrop:bg-scrim open:flex"
      >
        <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
          <Wordmark small className="text-17" />
          <button type="button" onClick={() => setOpen(false)} className={ICON_CELL}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>
        <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
          {groups.map((group) => (
            <section key={group.label} className="mb-8" aria-labelledby={`phone-nav-${group.label}`}>
              <h2
                id={`phone-nav-${group.label}`}
                className={cn("eyebrow-mono mb-1", current?.section === group && "text-foreground")}
              >
                {group.label}
              </h2>
              <ul>
                {group.items.map((item) => {
                  const active = current?.item === item;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        aria-current={active ? "page" : undefined}
                        className="relative -mx-4 flex min-h-12 items-center px-4 text-17 text-muted-foreground hover:bg-surface-2 hover:text-foreground aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      </dialog>
    </div>
  );
}
