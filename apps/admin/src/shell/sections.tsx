/**
 * The top bar's sections (D-37): Live · Events · People · Setup, each a button that opens a menu
 * of its pages (the disclosure pattern: the pages are ordinary links, so a link keeps its role and
 * its name). Exactly one section is current, the one holding the page you are on: ink, with a
 * short accent mark (`topLinkClass`). Inside its menu the current page is marked too. The menus
 * are opaque and open at once; Escape closes one and returns to its section, a click elsewhere
 * or following a link closes it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MENU_PANEL, MENU_ROW, topLinkClass } from "@synan/ui/shell";
import { cn } from "@synan/ui/components";
import { navItemActive, type NavEntry, type NavSection } from "../routes";

/** The entry for this path, and the section that holds it: one at most. */
export function currentEntry(sections: NavSection[], pathname: string): { section: NavSection; item: NavEntry } | null {
  for (const section of sections) {
    for (const item of section.items) if (navItemActive(item, pathname)) return { section, item };
  }
  return null;
}

/** One page in a section's menu: its name, and a muted line saying what it is for. */
export function SectionLink({ item, current, className }: { item: NavEntry; current: boolean; className?: string }) {
  return (
    <Link to={item.to} aria-current={current ? "page" : undefined} className={cn(MENU_ROW, "py-2 aria-[current=page]:font-medium", className)}>
      <span className="min-w-0">
        <span className="block">{item.label}</span>
        <span className="block text-12 font-normal text-muted-foreground">{item.note}</span>
      </span>
    </Link>
  );
}

export function SectionsNav({ sections }: { sections: NavSection[] }) {
  const location = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const baseId = useId();
  const current = currentEntry(sections, location.pathname);

  // Following a link closes the menu.
  useEffect(() => setOpen(null), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <nav ref={root} aria-label="Admin" className="flex items-center gap-1">
      {sections.map((section, index) => {
        const id = `${baseId}-${index}`;
        const expanded = open === section.label;
        const active = current?.section === section;
        return (
          <div
            key={section.label}
            className="relative"
            onKeyDown={(event) => {
              if (event.key === "Escape" && expanded) {
                event.preventDefault();
                setOpen(null);
                (event.currentTarget.querySelector("button") as HTMLButtonElement | null)?.focus();
              }
            }}
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? id : undefined}
              aria-current={active ? "true" : undefined}
              onClick={() => setOpen(expanded ? null : section.label)}
              className={topLinkClass(active, "font-medium aria-expanded:bg-surface-2 aria-expanded:text-foreground")}
            >
              {section.label}
            </button>
            {expanded ? (
              <ul id={id} className={cn("absolute top-full left-1/2 z-40 mt-2 w-72 -translate-x-1/2 py-2", MENU_PANEL)}>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <SectionLink item={item} current={current?.item === item} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
