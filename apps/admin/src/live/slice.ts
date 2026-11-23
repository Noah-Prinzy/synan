import { useSyncExternalStore } from "react";

/**
 * A value with listeners. The store keeps one slice per concern, so a component
 * re-renders only for the data it reads, and only when that data changes (≤ 4 Hz for
 * anything fed by telemetry). Per-frame motion never goes through a slice.
 */
export class Slice<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  update(fn: (previous: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useSlice<T>(slice: Slice<T>): T {
  return useSyncExternalStore(slice.subscribe, slice.get, slice.get);
}

/** One primitive out of a slice: re-renders only when that value changes. */
export function useSliceValue<T, V extends string | number | boolean | null>(slice: Slice<T>, select: (value: T) => V): V {
  const read = () => select(slice.get());
  return useSyncExternalStore(slice.subscribe, read, read);
}
