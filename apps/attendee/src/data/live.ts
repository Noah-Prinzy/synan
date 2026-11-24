/** The source's clock and change feed, for screens that read data live. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { backend } from "./backend";

/** "Now" for time comparisons: the mock clock, or the device clock corrected by server time. */
export function now(): number {
  return backend.now();
}

/** A number that changes whenever data the screens read live changes (band, read state, pass state). */
export function dataVersion(): number {
  return backend.version();
}

/** Re-render on every such change. */
export function useDataVersion(): number {
  return useSyncExternalStore(backend.subscribe, backend.version, backend.version);
}

/** `now()`, ticking once a second while the tab is visible (docs/05 §5). */
export function useNow(): number {
  const [current, setCurrent] = useState(() => backend.now());
  useEffect(() => {
    let id: number | null = null;
    const start = () => {
      if (id === null) id = window.setInterval(() => setCurrent(backend.now()), 1000);
      setCurrent(backend.now());
    };
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    const unsubscribe = backend.subscribeClock(() => setCurrent(backend.now()));
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return current;
}
