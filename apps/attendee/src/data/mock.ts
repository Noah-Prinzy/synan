/**
 * The app's single mock backend instance (docs/02 §8). Only data/mock-backend.ts reads this;
 * screens never import it, and a build with VITE_API_URL set does not contain it.
 *
 * Dev affordances, via the URL:
 *   ?scenario=credential_revoked_mid_pass   replay a named scenario (any in SCENARIO_NAMES)
 *   ?at=2026-11-22T09:30:00Z                set the mock clock
 *   ?reset=1                                clear the mock's persisted state (and replied invitations)
 *   ?fail=1                                 the next load on each screen fails (error state)
 *   ?slow=1                                 loads take 2.5 s (loading state)
 */
import {
  DEMO_NOW,
  MockClock,
  MockRealtime,
  SCENARIO_NAMES,
  createInvitationDesk,
  createPortalStore,
  type InvitationDesk,
  type PortalStore,
  type ScenarioName,
  type StorageLike,
} from "@synan/mock";
import { knobs } from "./resource";
import { INVITATION_REPLIES_KEY } from "./shared";

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
/** A10's demo invitations (in memory: a reload starts each one afresh). */
export const invitations: InvitationDesk = createInvitationDesk({ clock, portal });

/** A simulated round trip on every screen load, so loading states can be designed against. */
knobs.latency = 350;

/** Apply the dev URL parameters once per page load. */
export function applyDevParams(search: string): void {
  const params = new URLSearchParams(search);
  if (params.get("reset") === "1") {
    portal.reset();
    invitations.reset();
    // This device's memory of invitation replies (data/invitation.ts), so the demo links answer afresh.
    try {
      window.localStorage.removeItem(INVITATION_REPLIES_KEY);
    } catch {
      /* storage blocked: nothing kept */
    }
  }
  const at = params.get("at");
  if (at && !Number.isNaN(Date.parse(at))) clock.set(at);
  const scenario = params.get("scenario");
  if (scenario && (SCENARIO_NAMES as readonly string[]).includes(scenario)) {
    realtime.play(scenario as ScenarioName);
  }
  knobs.fail = params.get("fail") === "1";
  if (params.get("slow") === "1") knobs.latency = 2500;
}
