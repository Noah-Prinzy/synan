import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AppShell, NavRail, navItemClass } from "@synan/ui/shell";
import { DEV_TOOLS } from "../live/backend";
import { NAV_GROUPS } from "../routes";
import { AlertStrip } from "./alert-strip";
import { ScreenBoundary } from "./screen-boundary";
import { AdminStatusBar } from "./status-bar";
import { PhoneNav } from "./phone-nav";
import { AdminTopBar } from "./top-bar";

/** Development only: the scenario switcher and frame sampler, floating apart from the product. */
const DevTools = DEV_TOOLS ? lazy(() => import("../dev/dev-tools")) : null;

/** The one breakpoint (docs/05 §2): 1280. Below it the rails collapse. */
export const WIDE_QUERY = "(min-width: 80rem)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const NAV_KEY = "synan.admin.nav";

function readNavPreference(): boolean {
  try {
    return window.localStorage.getItem(NAV_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

export function AdminShell() {
  const wide = useMediaQuery(WIDE_QUERY);
  const location = useLocation();
  const [preferExpanded, setPreferExpanded] = useState(readNavPreference);
  const expanded = wide && preferExpanded;

  return (
    <AppShell
      top={<AdminTopBar menu={<PhoneNav />} />}
      strip={<AlertStrip />}
      nav={
        // Below 640px the rail gives way to the Menu cell in the top bar (PhoneNav).
        <div className="hidden h-full sm:block">
        <NavRail
          label="Admin"
          groups={NAV_GROUPS}
          expanded={expanded}
          onToggle={
            wide
              ? () => {
                  const next = !preferExpanded;
                  setPreferExpanded(next);
                  try {
                    window.localStorage.setItem(NAV_KEY, next ? "expanded" : "collapsed");
                  } catch {
                    /* preference lasts for this page only */
                  }
                }
              : undefined
          }
          renderLink={(item, content) => (
            <NavLink
              to={item.to}
              end={item.end}
              title={expanded ? undefined : item.label}
              className={({ isActive }) => navItemClass(isActive, expanded)}
            >
              {content}
            </NavLink>
          )}
        />
        </div>
      }
      status={<AdminStatusBar />}
    >
      <ScreenBoundary resetKey={location.pathname}>
        <Outlet />
      </ScreenBoundary>
      {DevTools ? (
        <Suspense fallback={null}>
          <DevTools />
        </Suspense>
      ) : null}
    </AppShell>
  );
}
