/**
 * Shell pieces for an instrument surface (docs/05 §7 tier 2): the frame, a top bar of
 * ruled cells, a navigation rail, and a status bar. Structure only — what goes in the
 * cells belongs to the app. No router dependency: the app renders its own links.
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { AmbientField } from "../../theme";

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
  // No ground of its own: <html> carries it (styles/theme.css), so the still ambient field
  // (fixed, out of the grid flow) shows between the ground and the frame (D-22).
  return (
    <div className="relative grid h-dvh grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden text-13 text-foreground">
      <AmbientField still />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2"
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

export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cn("flex h-12 items-stretch border-b border-border", className)}>{children}</header>;
}

/** One ruled cell in the top bar. */
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
    <div className={cn("flex min-w-0 items-center gap-3 border-r border-border px-4 last:border-r-0", grow && "flex-1", className)}>
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
        "flex h-full flex-col overflow-x-hidden overflow-y-auto border-r border-border",
        expanded ? RAIL_WIDTH.expanded : RAIL_WIDTH.collapsed,
      )}
    >
      <ul className="flex-1 pt-3 pb-4">
        {groups.map((group, index) => (
          <li
            key={group.label}
            className={cn(
              index > 0 &&
                (expanded
                  ? "mt-4"
                  : // Collapsed, a group has no label: a short centred rule marks where the next begins.
                    "relative mt-3 pt-3 before:absolute before:top-0 before:left-1/2 before:h-px before:w-5 before:-translate-x-1/2 before:bg-border"),
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
        <div className="shrink-0 border-t border-border py-2">
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
      className={cn("flex h-6 items-stretch overflow-hidden border-t border-border text-11 text-muted-foreground", className)}
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
    <span className={cn("flex shrink-0 items-center gap-1.5 border-r border-border px-3", className)}>
      <span>{label}</span>
      <span className="font-mono text-foreground tabular-nums">{children}</span>
    </span>
  );
}
