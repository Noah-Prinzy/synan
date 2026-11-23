/**
 * The app's single mock backend instance (docs/02 §8). Every module in src/data reads
 * through this; screens never import fixtures directly. When the real API lands, this
 * file is where transport switches, endpoint by endpoint.
 *
 * Dev affordances, via the URL:
 *   ?scenario=credential_revoked_mid_pass   replay a named scenario (any in SCENARIO_NAMES)
 *   ?at=2026-11-22T09:30:00Z                set the mock clock
 *   ?reset=1                                clear the mock's persisted state
 *   ?fail=1                                 the next load on each screen fails (error state)
 *   ?slow=1                                 loads take 2.5 s (loading state)
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  DEMO_NOW,
  MockClock,
  MockRealtime,
  SCENARIO_NAMES,
  createPortalStore,
  delay,
  type PortalStore,
  type ScenarioName,
  type StorageLike,
} from "@synan/mock";

function storage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const clock = new MockClock(DEMO_NOW);
export const portal: PortalStore = createPortalStore({ clock, storage: storage() });
export const realtime = new MockRealtime({ clock, portal });

const dev = { failOnce: new Set<string>(), fail: false, latency: 350 };

/** Re-render when the mock store changes (binding, read state, credential state). */
export function usePortalVersion(): number {
  return useSyncExternalStore(portal.subscribe, portal.version, portal.version);
}

/** Apply the dev URL parameters once per page load. */
export function applyDevParams(search: string): void {
  const params = new URLSearchParams(search);
  if (params.get("reset") === "1") portal.reset();
  const at = params.get("at");
  if (at && !Number.isNaN(Date.parse(at))) clock.set(at);
  const scenario = params.get("scenario");
  if (scenario && (SCENARIO_NAMES as readonly string[]).includes(scenario)) {
    realtime.play(scenario as ScenarioName);
  }
  dev.fail = params.get("fail") === "1";
  if (params.get("slow") === "1") dev.latency = 2500;
}

export type Resource<T> =
  | { status: "loading"; data?: undefined; retry: () => void }
  | { status: "error"; data?: undefined; retry: () => void }
  | { status: "offline"; data?: undefined; retry: () => void }
  | { status: "ready"; data: T; retry: () => void };

const cache = new Map<string, unknown>();

/**
 * A screen's data, with the states every screen must design (docs/05 §1.8): loading,
 * error, offline, ready. Loaded once per key, then served from memory — so returning
 * to a screen is instant and works offline. Stands in for TanStack Query (D-17).
 */
export function useResource<T>(key: string, load: () => T): Resource<T> {
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
    delay(dev.latency).then(() => {
      if (!live) return;
      if (!navigator.onLine) {
        setState({ status: "offline" });
        return;
      }
      if (dev.fail && !dev.failOnce.has(key)) {
        dev.failOnce.add(key);
        setState({ status: "error" });
        return;
      }
      const data = load();
      cache.set(key, data);
      setState({ status: "ready", data });
    });
    return () => {
      live = false;
    };
    // `load` is read when the key or attempt changes, not on every render.
  }, [key, attempt]);

  return { ...state, retry } as Resource<T>;
}
