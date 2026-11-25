/** Shared by the "lines" and "gradient" backgrounds: pause their CSS animations while the tab is hidden. */
import { useEffect } from "react";

export function usePauseWhenHidden(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (document.hidden) root.dataset.bgPaused = "";
      else delete root.dataset.bgPaused;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete root.dataset.bgPaused;
    };
  }, []);
}
