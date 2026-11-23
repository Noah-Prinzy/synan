/**
 * Shell pieces for an instrument surface (docs/05 §7 tier 2): the frame, a top bar of
 * ruled cells, a navigation rail, and a status bar. Structure only — what goes in the
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

/** Full-viewport frame. The page never scrolls; regions scroll inside themselves. */
export function AppShell({ top, strip, nav, status, children }: AppShellProps) {
  return (
    <div className="grid h-dvh grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-background text-13 text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="col-span-2">{top}</div>
      <div className="col-span-2">{strip}</div>
      <div className="row-start-3 min-h-0">{nav}</div>
      <main id="main" tabIndex={-1} className="row-start-3 min-h-0 min-w-0 overflow-auto outline-none">
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

/** Class for one rail link. Active: foreground text and a 2px accent rule at the left edge. */
export function navItemClass(active: boolean, expanded: boolean): string {
  return cn(
    "relative flex h-8 items-center gap-3 text-13 transition-colors duration-120 ease-standard motion-reduce:transition-none",
    expanded ? "px-4" : "justify-center px-0",
    "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5",
    active
      ? "text-foreground before:bg-brand"
      : "text-muted-foreground hover:bg-card/60 hover:text-foreground before:bg-transparent",
  );
}

export interface NavRailProps {
  groups: NavGroup[];
  expanded: boolean;
  onToggle?: () => void;
  /** Render a router link for `item`, with `content` inside it. Use `navItemClass` for its class. */
  renderLink: (item: NavItem, content: ReactNode) => ReactNode;
  label?: string;
}

export function NavRail({ groups, expanded, onToggle, renderLink, label = "Main" }: NavRailProps) {
  return (
    <nav
      aria-label={label}
      className={cn("flex h-full flex-col overflow-y-auto border-r border-border", expanded ? "w-48" : "w-12")}
    >
      <ul className="flex-1 py-2">
        {groups.map((group, index) => (
          <li key={group.label} className={cn(index > 0 && "mt-2 border-t border-border pt-2")}>
            {expanded ? (
              <p className="px-4 pt-1 pb-1 text-11 text-muted-foreground">{group.label}</p>
            ) : (
              <p className="sr-only">{group.label}</p>
            )}
            <ul>
              {group.items.map((item) => (
                <li key={item.to}>
                  {renderLink(
                    item,
                    <>
                      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
                        {item.icon}
                      </span>
                      <span className={expanded ? "truncate" : "sr-only"}>{item.label}</span>
                    </>,
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={cn(
            "flex h-8 shrink-0 items-center gap-3 border-t border-border text-12 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none",
            expanded ? "px-4" : "justify-center",
          )}
        >
          <span aria-hidden="true" className="font-mono">
            {expanded ? "‹" : "›"}
          </span>
          <span className={expanded ? undefined : "sr-only"}>{expanded ? "Collapse menu" : "Expand menu"}</span>
        </button>
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
