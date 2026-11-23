/**
 * The admin's one backend instance. Today: the mock (docs/02 §8). When the API lands,
 * this file is where transport switches — `api` becomes a fetch client and `connect`
 * a WebSocket client; nothing that imports them changes.
 *
 * Development-only URL parameters (ignored in a production build):
 *   ?venue=large        Nexus Hall's 60-room build (the performance test)
 *   ?live=none          no event is live (the D1 empty state)
 *   ?slow=1             REST takes 2.5 s (loading state)
 *   ?fail=1             the first layout load fails (error state)
 *   ?ambient=0          no background traffic
 *   ?scenario=<name>    play a named scenario on load;  &loop=1 to repeat it
 *   ?fps=1              show the frame-time sampler
 */
import { DEMO_NOW, MockClock } from "@synan/mock";
import { createCommandMock } from "@synan/mock/command";
import type { LiveTransport } from "./transport";

/**
 * True in development, and in a performance build (VITE_SYNAN_DEVTOOLS=1) used only to
 * measure production React with the scenario switcher. Never set for a shipped build.
 */
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_SYNAN_DEVTOOLS === "1";

const params = new URLSearchParams(DEV_TOOLS ? window.location.search : "");

export const devParams = {
  venue: params.get("venue") === "large" ? ("large" as const) : ("standard" as const),
  noLive: params.get("live") === "none",
  slow: params.get("slow") === "1",
  fail: params.get("fail") === "1",
  ambient: params.get("ambient") !== "0",
  scenario: params.get("scenario"),
  loop: params.get("loop") === "1",
  fps: params.get("fps") === "1",
};

export const clock = new MockClock(DEMO_NOW);

export const backend = createCommandMock({
  clock,
  venueSize: devParams.venue,
  noLiveEvent: devParams.noLive,
  latencyMs: devParams.slow ? 2500 : 300,
  failFirstLoad: devParams.fail,
});

export const api = backend.api;

export function connect(eventId: string): LiveTransport | null {
  const transport = backend.realtimeFor(eventId);
  if (transport && devParams.ambient) backend.serverFor(eventId)?.startAmbient();
  return transport;
}
