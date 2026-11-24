/**
 * `gate.health` on `/stream/alerts` (02 §6 "Breach alerts and system health"). Gate health is
 * computed, not pushed: a gate goes offline by staying silent, so no heartbeat marks the change.
 * While anyone follows the alerts channel, the live events' gate health is read every few seconds
 * (GateService.health, the same as GET /gates/health) and a frame is published for each gate whose
 * state changed — link state, unsynced scans, clock fault, stale allowlist — and for each gate the
 * first time it is seen. Counts that move with every scan (scans in the last minute) do not count as
 * a change. Routing: the event and the checkpoint, so gate staff receive only their own gates.
 */
import type { GateHealth } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import type { ChannelHub } from "./channel-hub.js";

export const GATE_HEALTH_POLL_MS = 5_000;

const stateOf = (g: GateHealth) => `${g.link_state}|${g.queue_depth > 0}|${g.clock_fault}|${g.allowlist_stale ?? false}`;

export function startGateHealthFeed(app: AppContext, hub: ChannelHub<{ event_id: string; checkpoint_id?: string | null }>, everyMs = GATE_HEALTH_POLL_MS) {
  /** `${event}|${checkpoint}` → last published state. */
  const last = new Map<string, string>();
  let running = false;
  const tick = async () => {
    if (hub.subscribers === 0) return void last.clear(); // the next follower gets every gate afresh
    if (running) return;
    running = true;
    try {
      const live = await app.repos.events.listAll({ state: "live", limit: 200 });
      const seen = new Set<string>();
      for (const e of live) {
        for (const g of await app.gates.health(e)) {
          const key = `${e.id}|${g.checkpoint_id}`;
          seen.add(key);
          const s = stateOf(g);
          if (last.get(key) === s) continue;
          last.set(key, s);
          hub.publish("gate.health", g, { event_id: e.id, checkpoint_id: g.checkpoint_id });
        }
      }
      for (const k of last.keys()) if (!seen.has(k)) last.delete(k); // the event is no longer live
    } catch (e) {
      console.error(`[ws] gate health feed failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
