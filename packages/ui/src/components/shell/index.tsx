/**
 * Shell pieces for an instrument surface (docs/05 §7 tier 2): the frame, the top bar and its
 * parts (section links, the account avatar, the menu panel), a navigation rail, and a status
 * bar. No rules anywhere (D-37): space and tone separate the regions. Structure only — what goes in the
 * cells belongs to the app. No router dependency: the app renders its own links.
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/* ---------------------------------------------------------------- AppShell */

export interface AppShellProps {
  top: ReactNode;
  /** A thin strip under the top bar (Admin: alert banners only). */
  strip?: ReactNode;
  nav?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}

/**
 * Full-viewport frame. The page never scrolls; regions scroll inside themselves.
 * The frame and the main region are positioned, so absolutely placed descendants (visually
 * hidden live regions, popover anchors) stay inside them: an unpositioned main let those
 * reach past the viewport, which made the document itself scrollable and shifted the whole
 * frame up when a field was focused.
 */
export function AppShell({ top, strip, nav, status, children }: AppShellProps) {
  // No ground of its own: <html> carries it (styles/theme.css).
  return (
    <div className="relative grid h-dvh grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden text-13 text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-solid focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>
      <div className="col-span-2">{top}</div>
      <div className="col-span-2">{strip}</div>
      <div className="row-start-3 min-h-0">{nav}</div>
      <main id="main" tabIndex={-1} className="relative row-start-3 min-h-0 min-w-0 overflow-auto outline-none [scrollbar-gutter:stable]">
        {children}
      </main>
      <div className="col-span-2">{status}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ TopBar */

/** The full-width top bar: one solid band, no rule under it. */
export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cn("flex h-14 items-stretch bg-solid", className)}>{children}</header>;
}

/** One region of the top bar, held apart from the next by space. */
export function TopBarCell({
  children,
  className,
  grow = false,
}: {
  children: ReactNode;
  className?: string;
  grow?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 px-4", grow && "flex-1", className)}>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- NavRail */

export interface NavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  /** Match the path exactly (the index route). */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * One row of navigation, shared by the rail and anything that lists the same items: 36px (44px
 * under a coarse pointer), a 16px icon and a 13px label on one grid. Hover lays a faint surface
 * under the row; active keeps that surface a step stronger, sets the text in the foreground and
 * adds a short 2px accent rule at the row's left edge. Blue is the rule only, never the surface.
 */
export const NAV_ROW =
  "relative flex h-9 items-center gap-3 text-13 transition-colors duration-120 ease-standard motion-reduce:transition-none pointer-coarse:h-11 before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 pointer-coarse:before:inset-y-3";
export const NAV_ROW_ACTIVE = "bg-foreground/7 text-foreground before:bg-brand";
export const NAV_ROW_REST = "text-muted-foreground before:bg-transparent hover:bg-foreground/4 hover:text-foreground";

/** Class for one rail link. Expanded: an inset row with its label. Collapsed: a centred square. */
export function navItemClass(active: boolean, expanded: boolean): string {
  return cn(
    NAV_ROW,
    expanded ? "mx-2 px-3" : "mx-auto w-10 justify-center pointer-coarse:w-11",
    active ? NAV_ROW_ACTIVE : NAV_ROW_REST,
  );
}

export interface NavRailProps {
  groups: NavGroup[];
  expanded: boolean;
  onToggle?: () => void;
  /** The toggle's icons (16px), the app's own icon set: [collapse, expand]. */
  toggleIcons?: [ReactNode, ReactNode];
  /** Render a router link for `item`, with `content` inside it. Use `navItemClass` for its class. */
  renderLink: (item: NavItem, content: ReactNode) => ReactNode;
  label?: string;
}

/** Rail widths: expanded fits the longest label without truncation; collapsed is one icon column. */
export const RAIL_WIDTH = { expanded: "w-52", collapsed: "w-14" } as const;

export function NavRail({ groups, expanded, onToggle, toggleIcons, renderLink, label = "Main" }: NavRailProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex h-full flex-col overflow-x-hidden overflow-y-auto",
        expanded ? RAIL_WIDTH.expanded : RAIL_WIDTH.collapsed,
      )}
    >
      <ul className="flex-1 pt-3 pb-4">
        {groups.map((group, index) => (
          <li
            key={group.label}
            className={cn(
              index > 0 &&
                (expanded ? "mt-4" : /* collapsed: a group has no label, only more space */ "mt-6"),
            )}
          >
            {expanded ? (
              <p className="flex h-7 items-center px-5 text-12 text-muted-foreground">{group.label}</p>
            ) : (
              <p className="sr-only">{group.label}</p>
            )}
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => (
                <li key={item.to}>
                  {renderLink(
                    item,
                    <>
                      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center [&_svg]:size-4">
                        {item.icon}
                      </span>
                      <span className={expanded ? "whitespace-nowrap" : "sr-only"}>{item.label}</span>
                    </>,
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {onToggle ? (
        <div className="shrink-0 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            title={expanded ? undefined : "Expand menu"}
            className={cn(
              NAV_ROW,
              NAV_ROW_REST,
              expanded ? "mx-2 w-[calc(100%-1rem)] px-3 text-left" : "mx-auto w-10 justify-center pointer-coarse:w-11",
            )}
          >
            <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center [&_svg]:size-4">
              {toggleIcons ? (expanded ? toggleIcons[0] : toggleIcons[1]) : expanded ? "‹" : "›"}
            </span>
            <span className={expanded ? "whitespace-nowrap" : "sr-only"}>{expanded ? "Collapse menu" : "Expand menu"}</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}

/* --------------------------------------------------------------- StatusBar */

export function StatusBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer
      className={cn("flex h-6 items-stretch overflow-hidden bg-solid text-11 text-muted-foreground", className)}
    >
      {children}
    </footer>
  );
}

/** One measurement in the status bar: a sans label and a mono value. */
export function StatusItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 px-3", className)}>
      <span>{label}</span>
      <span className="font-mono text-foreground tabular-nums">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------- top-bar parts (D-37) */

/**
 * A section link in a top bar (Admin: Live · Events · People · Setup). Words only; the current
 * one is ink and carries a short accent mark under it, the rest are muted until the pointer is
 * on them. 44px under a coarse pointer.
 */
export function topLinkClass(active: boolean, className?: string): string {
  return cn(
    "relative inline-flex h-10 items-center px-3 text-15 transition-colors duration-120 ease-standard motion-reduce:transition-none pointer-coarse:h-11",
    "after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2",
    active ? "text-foreground after:bg-brand" : "text-muted-foreground after:bg-transparent hover:bg-surface-2 hover:text-foreground",
    className,
  );
}

/** A person's initials in a round tonal disc (round by nature: an avatar). */
export function Avatar({ initials, className, size = "md" }: { initials: string; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-surface-2 font-sans font-semibold tracking-[0.02em] text-foreground",
        size === "sm" ? "size-8 text-11" : "size-10 text-13",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** The ground of a menu or popover opened from a top bar: opaque, square, the pop depth, no outline. */
export const MENU_PANEL = "bg-solid text-foreground shadow-pop";

/** One row in such a menu: a tonal step under the pointer, never a rule between rows. */
export const MENU_ROW =
  "flex min-h-10 w-full items-center gap-3 px-3 text-left text-13 text-foreground hover:bg-surface-2 aria-[current=page]:bg-surface-2 pointer-coarse:min-h-11";
