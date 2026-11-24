/**
 * The mock backend (docs/02 §8): what live/backend.ts used to build inline. Loaded by a dynamic
 * import only when VITE_API_URL is unset, so a build pointed at the real API carries none of it.
 */
import { DEMO_NOW, MockClock } from "@synan/mock";
import { createCommandMock, SESSION_ROLES, type SessionRole } from "@synan/mock/command";
import type { LiveTransport } from "./transport";

export interface MockBackendOptions {
  venue: "standard" | "large";
  noLive: boolean;
  slow: boolean;
  fail: boolean;
  ambient: boolean;
  freshSetup: boolean;
  /** Development only: `?as=<role>` or the last role picked in the dev tools; undefined otherwise. */
  wantedRole: string | null;
}

export function createMockBackend(options: MockBackendOptions) {
  const clock = new MockClock(DEMO_NOW);
  const role: SessionRole | undefined = SESSION_ROLES.find((r) => r === options.wantedRole);
  const backend = createCommandMock({
    clock,
    venueSize: options.venue,
    noLiveEvent: options.noLive,
    latencyMs: options.slow ? 2500 : 300,
    failFirstLoad: options.fail,
    freshOrganization: options.freshSetup,
    role,
  });
  return {
    mode: "mock" as const,
    api: backend.api,
    configure: backend.configure,
    clock,
    connect(eventId: string): LiveTransport | null {
      const transport = backend.realtimeFor(eventId);
      if (transport && options.ambient) backend.serverFor(eventId)?.startAmbient();
      return transport;
    },
    mock: backend,
  };
}
