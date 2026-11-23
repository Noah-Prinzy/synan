import { useEffect } from "react";

/**
 * The ambient field behind every attendee page (see index.css). Pauses with the tab.
 * Development: ?ambient=off renders the page without it, for comparison.
 */
export function Ambient() {
  useEffect(() => {
    const root = document.documentElement;
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("ambient") === "off") {
      root.dataset.ambient = "off";
    }
    const sync = () => {
      if (document.hidden) root.dataset.hidden = "";
      else delete root.dataset.hidden;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return <div aria-hidden="true" className="ambient-field" />;
}
