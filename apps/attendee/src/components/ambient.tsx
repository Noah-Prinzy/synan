import { useLocation } from "react-router-dom";
import { GatheringBackground } from "@synan/ui/components";

/**
 * The Gathering field behind every attendee page (D-37, packages/ui theme/gathering). It loads
 * after the page has painted and the browser is idle, so no screen waits for it.
 * Development: ?ambient=off renders the page without it, for comparison.
 */
export function Ambient() {
  const { pathname, search } = useLocation();
  if (import.meta.env.DEV && new URLSearchParams(search).get("ambient") === "off") return null;
  if (pathname.startsWith("/dev/directions")) return null;
  return <GatheringBackground />;
}
