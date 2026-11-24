/**
 * A screen's data, with the states every screen must design (docs/05 §1.8): loading, error,
 * offline, ready. Loaded once per key, then served from memory, so returning to a screen is
 * instant and works offline. Stands in for TanStack Query (D-17).
 *
 * Used by both data sources: the mock answers synchronously after a simulated round trip
 * (`knobs.latency`, ?fail=1, ?slow=1); the real API answers with a promise, and its failures are
 * sorted into offline or error by `failureKind` (data/failure.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { failureKind } from "./failure";

export type Resource<T> =
  | { status: "loading"; data?: undefined; retry: () => void }
  | { status: "error"; data?: undefined; retry: () => void }
  | { status: "offline"; data?: undefined; retry: () => void }
  | { status: "ready"; data: T; retry: () => void };

/** Development knobs, set from the URL by the mock (data/mock.ts applyDevParams). */
export const knobs = { failOnce: new Set<string>(), fail: false, latency: 0 };

const cache = new Map<string, unknown>();

/** Forget everything loaded (sign-in or sign-out changes what the server answers). */
export function clearResources(): void {
  cache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useResource<T>(key: string, load: () => T | Promise<T>): Resource<T> {
  const [state, setState] = useState<{ status: Resource<T>["status"]; data?: T }>(() =>
    cache.has(key) ? { status: "ready", data: cache.get(key) as T } : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    if (cache.has(key) && attempt === 0) {
      setState({ status: "ready", data: cache.get(key) as T });
      return;
    }
    setState({ status: "loading" });
    (async () => {
      if (knobs.latency > 0) await sleep(knobs.latency);
      if (!live) return;
      if (!navigator.onLine) {
        setState({ status: "offline" });
        return;
      }
      if (knobs.fail && !knobs.failOnce.has(key)) {
        knobs.failOnce.add(key);
        setState({ status: "error" });
        return;
      }
      try {
        const data = await load();
        if (!live) return;
        cache.set(key, data);
        setState({ status: "ready", data });
      } catch (error) {
        if (live) setState({ status: failureKind(error) });
      }
    })();
    return () => {
      live = false;
    };
    // `load` is read when the key or attempt changes, not on every render.
  }, [key, attempt]);

  return { ...state, retry } as Resource<T>;
}
