/**
 * Load something once per key, with the three states every screen designs for: loading,
 * error (with retry) and ready. `reload(true)` refreshes quietly, keeping what is shown.
 * Stale responses (the key changed while a request was in flight) are dropped.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { surfaceName } from "@synan/ui/brand";

export type Resource<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: unknown }
  | { status: "ready"; data: T; error: null };

export function useResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): Resource<T> & { reload: (quiet?: boolean) => void; set: (update: (current: T) => T) => void } {
  const [state, setState] = useState<Resource<T>>({ status: "loading", data: null, error: null });
  const generation = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const run = useCallback((quiet = false) => {
    const mine = ++generation.current;
    if (!quiet) setState({ status: "loading", data: null, error: null });
    loader.current().then(
      (data) => {
        if (mine === generation.current) setState({ status: "ready", data, error: null });
      },
      (error: unknown) => {
        if (mine !== generation.current) return;
        if (quiet) return; // a background refresh keeps the last good data
        setState({ status: "error", data: null, error });
      },
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(), deps);

  const set = useCallback((update: (current: T) => T) => {
    setState((current) => (current.status === "ready" ? { ...current, data: update(current.data) } : current));
  }, []);

  return { ...state, reload: run, set };
}

/** Sets document.title for the screen: "Venues · Synan Command". */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title) document.title = `${title} · ${surfaceName("admin")}`;
  }, [title]);
}
