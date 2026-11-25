import { useLocation } from "react-router-dom";
import { LivingBackground } from "@synan/ui/components";

/**
 * The living background behind every attendee page (D-37): the slot in packages/ui theme
 * (LivingBackground). It loads after the page has painted and the browser is idle, so no screen
 * waits for it. Development: ?ambient=off renders the page without it, for comparison.
 */
export function Ambient() {
  const { search } = useLocation();
  if (import.meta.env.DEV && new URLSearchParams(search).get("ambient") === "off") return null;
  return <LivingBackground />;
}
