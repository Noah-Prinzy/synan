/**
 * What the screens know about the event and this person's gates, from the mock or (API mode)
 * from GET /me/assignments and friends. Screens import from here, never from a source directly.
 */
import { useSyncExternalStore } from "react";
import { API_MODE } from "./api/config";
import { getApi, runtime, subscribeApi, type ApiState } from "./api/runtime";
import * as mock from "./mock";

export type { Gate } from "./mock";

export function gateById(id: string | null): mock.Gate | null {
  return API_MODE ? runtime.gateById(id) : mock.gateById(id);
}

const mockApi = null as ApiState | null;

/** API-mode state (session, gates loading, stream); null on the mock. */
export function useApi(): ApiState | null {
  return useSyncExternalStore(API_MODE ? subscribeApi : noop, API_MODE ? getApi : () => mockApi);
}
const noop = () => () => {};

export function useWorld(): { event: { id: string; title: string } | null; gates: mock.Gate[] } {
  const a = useApi();
  if (!a) return { event: mock.EVENT, gates: mock.GATES };
  return { event: a.event, gates: a.gates };
}

/** Room names for the ADMITTED chips; null = every room of the event (mock only). */
export function roomNames(ids: string[] | null): string[] {
  if (!API_MODE) return mock.roomNames(ids);
  const names = getApi().roomNames;
  return (ids ?? []).map((id) => names[id]).filter((n): n is string => Boolean(n));
}
