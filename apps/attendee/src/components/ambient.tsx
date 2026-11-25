import { useLocation } from "react-router-dom";
import { GatheringBackground, type QuietZone } from "@synan/ui/components";

/** The centre column where a calm screen's statement sits: the field drops to a quarter there. */
const QUIET_CENTRE: QuietZone = { x: 0.22, y: 0.12, w: 0.56, h: 0.5, floor: 0.22 };
/** The event page: below its picture the text runs wide, so the field stays low across the middle. */
const QUIET_WIDE: QuietZone = { x: 0.08, y: 0, w: 0.84, h: 1, floor: 0.4 };

/**
 * The Gathering field behind every attendee page (D-37, packages/ui theme/gathering). It loads
 * after the page has painted and the browser is idle, so no screen waits for it.
 * Development: ?ambient=off renders the page without it, for comparison.
 */
export function Ambient() {
  const { pathname, search } = useLocation();
  if (import.meta.env.DEV && new URLSearchParams(search).get("ambient") === "off") return null;
  if (pathname.startsWith("/dev/directions")) return null;
  return <GatheringBackground quiet={/^\/events\/[^/]+\/?$/.test(pathname) ? QUIET_WIDE : QUIET_CENTRE} />;
}
