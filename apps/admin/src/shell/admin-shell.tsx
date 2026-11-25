import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppShell } from "@synan/ui/shell";
import { useSession } from "../access/session";
import { DEV_TOOLS } from "../live/backend";
import { useCommand } from "../live/context";
import { navFor } from "../routes";
import { AlertNotice } from "./alert-strip";
import { ScreenBoundary } from "./screen-boundary";
import { AdminStatusBar } from "./status-bar";
import { PhoneNav } from "./phone-nav";
import { SectionsNav } from "./sections";
import { AdminTopBar, LiveStatus } from "./top-bar";

/** Development only: the scenario switcher and frame sampler, floating apart from the product. */
const DevTools = DEV_TOOLS ? lazy(() => import("../dev/dev-tools")) : null;

/** The wide breakpoint (docs/05 §2): 1280. */
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

/**
 * The console's frame (D-37): the top bar across the full width — no side rail — the page, and
 * the status bar. The sections, the alert notice and the status bar are the role's own (D-23): a
 * role with one screen (the desk clerk) has no sections at all, and only a role that watches the
 * floor gets the live chrome.
 */
export function AdminShell() {
  const location = useLocation();
  const { can } = useSession();
  const { event } = useCommand();
  const groups = useMemo(() => navFor(can, event?.id ?? null), [can, event?.id]);
  const navigable = groups.reduce((n, group) => n + group.items.length, 0) > 1;

  return (
    <AppShell
      top={
        <AdminTopBar
          menu={navigable ? <PhoneNav groups={groups} /> : null}
          sections={navigable ? <SectionsNav sections={groups} /> : null}
          alerts={can("alerts.view") ? <AlertNotice /> : null}
        />
      }
      // On a phone the live gate status sits in a strip under the bar.
      strip={can("live.view") ? <LiveStatus strip className="flex lg:hidden" /> : null}
      status={can("live.view") ? <AdminStatusBar /> : null}
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
