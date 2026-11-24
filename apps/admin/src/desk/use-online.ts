/**
 * Is the desk connected? Three signals, any one of which means "offline": the browser says so,
 * the last request could not reach the server (a venue Wi-Fi that is up but goes nowhere), or the
 * development switch is on. The next request that gets through clears the second.
 */
import { useSyncExternalStore } from "react";
import { desk, isOffline } from "./desk-api";

const listeners = new Set<() => void>();
let unreachable = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function snapshot(): boolean {
  return !navigator.onLine || unreachable || desk.mock.isOffline();
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Wrap a desk request: a failure to reach the server marks the desk offline, a success clears it. */
export async function track<T>(request: Promise<T>): Promise<T> {
  try {
    const result = await request;
    if (unreachable) {
      unreachable = false;
      notify();
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError && !unreachable) {
      unreachable = true;
      notify();
    }
    throw error;
  }
}

/** Development: switch the mock's connection off and on. */
export function setMockOffline(offline: boolean): void {
  desk.mock.setOffline(offline);
  if (!offline) unreachable = false;
  notify();
}

export { isOffline };
