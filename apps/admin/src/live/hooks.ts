import { useEffect, useState } from "react";
import { useCommand } from "./context";

/** Server time, re-read every `intervalMs` (for clocks and ages; 1 Hz is plenty). */
export function useNow(intervalMs = 1000): number {
  const { store } = useCommand();
  const [now, setNow] = useState(() => store.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(store.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [store, intervalMs]);
  return now;
}
