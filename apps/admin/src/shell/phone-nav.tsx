/**
 * Navigation on a phone. Below 640px the rail would take an eighth of the width, so it gives
 * way to a Menu cell at the start of the top bar that opens the same groups as a sheet from
 * the left: a native modal <dialog> (focus trapped, Escape closes, focus returns to Menu).
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { Wordmark } from "@synan/ui/brand";
import { cn } from "@synan/ui/components";
import { NAV_ROW_ACTIVE, NAV_ROW_REST } from "@synan/ui/shell";
import type { NavSection } from "../routes";

/** `groups` is the signed-in role's navigation (`navFor`), the same the rail shows. */
export function PhoneNav({ groups }: { groups: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Following a link closes the sheet.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex items-stretch border-r border-border sm:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Menu"
        className="grid w-12 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:bg-foreground/4 hover:text-foreground focus-visible:-outline-offset-2 motion-reduce:transition-none"
      >
        <MenuIcon size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] flex-col border-r border-border bg-background p-0 text-13 text-foreground transition-transform duration-180 ease-standard backdrop:bg-scrim open:flex starting:open:-translate-x-full motion-reduce:transition-none"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-5">
          {/* On a phone the lockup lives here rather than in the top bar (top-bar.tsx). */}
          <span className="flex items-baseline gap-2.5">
            <Wordmark small className="text-17" />
            <span className="text-12 text-muted-foreground">Command</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="grid size-12 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:bg-foreground/4 hover:text-foreground focus-visible:-outline-offset-2 motion-reduce:transition-none"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto pt-3 pb-6">
          {groups.map((group, index) => (
            <div key={group.label} className={cn(index > 0 && "mt-5")}>
              <p className="flex h-7 items-center px-5 text-12 text-muted-foreground">{group.label}</p>
              <ul className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          // The rail's row at touch size: 44px, 15px label, the same surface and rule.
                          "relative mx-2 flex h-11 items-center gap-3 px-3 text-15 transition-colors duration-120 ease-standard motion-reduce:transition-none before:absolute before:inset-y-3 before:left-0 before:w-0.5",
                          isActive ? NAV_ROW_ACTIVE : NAV_ROW_REST,
                        )
                      }
                    >
                      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center [&_svg]:size-4">
                        {item.icon}
                      </span>
                      <span className="whitespace-nowrap">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </dialog>
    </div>
  );
}
