/**
 * The selected event is the global context of every admin screen (docs/06 §2.2).
 * One store, opened for that event; the chrome (live pill, alert strip, status bar)
 * and D1 read from it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, connect } from "./backend";
import { CommandStore } from "./store";
import type { CommandEvent, OperatorContext } from "./transport";

export const store = new CommandStore(api, connect);

const EVENT_KEY = "synan.admin.event";

function readStoredEvent(): string | null {
  try {
    return window.localStorage.getItem(EVENT_KEY);
  } catch {
    return null;
  }
}

function writeStoredEvent(id: string): void {
  try {
    window.localStorage.setItem(EVENT_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

interface CommandContextValue {
  store: CommandStore;
  events: CommandEvent[] | null;
  event: CommandEvent | null;
  selectEvent: (id: string) => void;
  /** Fetch the event list again (after an event is published, closed or renamed). */
  refreshEvents: () => Promise<void>;
  operator: OperatorContext | null;
}

const CommandContext = createContext<CommandContextValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<CommandEvent[] | null>(null);
  const [operator, setOperator] = useState<OperatorContext | null>(null);
  const [selected, setSelected] = useState<string | null>(readStoredEvent);

  useEffect(() => {
    let cancelled = false;
    api.events().then((list) => !cancelled && setEvents(list));
    api.operator().then((op) => !cancelled && setOperator(op));
    return () => {
      cancelled = true;
    };
  }, []);

  const event = useMemo(() => {
    if (!events) return null;
    return (
      events.find((e) => e.id === selected) ??
      events.find((e) => e.state === "live") ??
      events[0] ??
      null
    );
  }, [events, selected]);

  useEffect(() => {
    if (event) void store.open(event);
  }, [event]);

  const refreshEvents = useCallback(async () => {
    const list = await api.events();
    setEvents(list);
  }, []);

  const selectEvent = useCallback((id: string) => {
    writeStoredEvent(id);
    setSelected(id);
  }, []);

  const value = useMemo(
    () => ({ store, events, event, selectEvent, refreshEvents, operator }),
    [events, event, selectEvent, refreshEvents, operator],
  );
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommand(): CommandContextValue {
  const value = useContext(CommandContext);
  if (!value) throw new Error("useCommand outside CommandProvider");
  return value;
}

/** The venue's time zone: every clock and timestamp on the surface is venue-local. */
export function useTimeZone(): string {
  const { event } = useCommand();
  return event?.timezone ?? "Africa/Kampala";
}
