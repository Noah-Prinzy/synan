/**
 * The desk search as state: searches a moment after typing stops, keeps the last results while
 * the next ones load or after a failure, and runs again when the connection comes back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskRegistration } from "@synan/mock/command";
import { desk } from "./desk-api";
import { track } from "./use-online";

const LIMIT = 20;
const MIN_CHARS = 2;

export interface SearchState {
  /** The query the shown results belong to. */
  forQuery: string;
  items: DeskRegistration[] | null;
  more: boolean;
  loading: boolean;
  error: unknown;
}

const EMPTY: SearchState = { forQuery: "", items: null, more: false, loading: false, error: null };

/** Searches a moment after typing stops; keeps the last results while the next ones load. */
export function useDeskSearch(eventId: string, query: string) {
  const [state, setState] = useState<SearchState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const q = query.trim();

  useEffect(() => {
    const mine = ++generation.current;
    if (q.length < MIN_CHARS) {
      setState(EMPTY);
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      track(desk.registrations(eventId, { q, limit: LIMIT })).then(
        (page) => mine === generation.current && setState({ forQuery: q, items: page.items, more: page.next_cursor !== null, loading: false, error: null }),
        (error: unknown) => mine === generation.current && setState((current) => ({ ...current, loading: false, error })),
      );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [eventId, q, attempt]);

  // Back online: run the search that failed.
  useEffect(() => {
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** Put a fresher copy of one registration in the results (after a bind). */
  const patch = useCallback((row: DeskRegistration) => {
    setState((current) => (current.items ? { ...current, items: current.items.map((item) => (item.id === row.id ? row : item)) } : current));
  }, []);

  return { state, retry, patch, tooShort: q.length > 0 && q.length < MIN_CHARS };
}
