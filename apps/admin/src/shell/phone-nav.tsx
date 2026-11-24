/**
 * Navigation on a phone. Below 640px the rail would take an eighth of the width, so it gives
 * way to a Menu cell at the start of the top bar that opens the same groups as a sheet from
 * the left: a native modal <dialog> (focus trapped, Escape closes, focus returns to Menu).
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { cn } from "@synan/ui/components";
import { NAV_GROUPS } from "../routes";

export function PhoneNav() {
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
        className="grid w-11 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
      >
        <MenuIcon size={18} strokeWidth={1.5} aria-hidden="true" />
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
        className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r border-border bg-background p-0 text-13 text-foreground backdrop:bg-scrim"
      >
        <div className="flex h-12 items-center justify-between border-b border-border pl-4">
          <span className="text-12 text-muted-foreground">Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="grid size-12 place-items-center text-muted-foreground hover:text-foreground"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Admin" className="overflow-y-auto py-2">
          {NAV_GROUPS.map((group, index) => (
            <div key={group.label} className={cn(index > 0 && "mt-2 border-t border-border pt-2")}>
              <p className="px-4 pt-1 pb-1 text-11 text-muted-foreground">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "relative flex h-11 items-center gap-3 px-4 text-15 before:absolute before:inset-y-2 before:left-0 before:w-0.5",
                          isActive ? "text-foreground before:bg-brand" : "text-muted-foreground before:bg-transparent hover:text-foreground",
                        )
                      }
                    >
                      <span aria-hidden="true" className="grid size-4 place-items-center">
                        {item.icon}
                      </span>
                      {item.label}
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
