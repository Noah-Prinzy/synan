/**
 * The one way a credential's state changes (01 §5.2). Every transition, whoever makes it (an
 * operator's revoke or clear, the scan path's impossible travel or an offline conflict found at
 * sync, the first admission, the desk's lost-band replacement), goes through `move`, or, when the
 * store made the move itself in one SQL step, through `announce`. Both:
 *
 *   1. tell `/stream/me` (`state` on `events`: the holder's open pass flips live, D-06), and
 *   2. store the attendee's notification where the product has one (generic text, 03 §5):
 *        → revoked                    "Your pass was cancelled"
 *        → suspended_review           "Your pass is under review"
 *        suspended_review → active    "Your pass works again"
 *        → replaced                   "Your pass was re-issued"
 *      The first admission (issued → active) has none: it is not news to the person at the door.
 *
 * The repository's `credentials.setState` is called from this file only (a test pins it), so a new
 * caller cannot write a state and forget the holder.
 */
import { EventEmitter } from "node:events";
import type { CredentialState } from "@synan/contracts/enums";
import type { Clock } from "../lib/clock.js";
import type { CredentialRow, Repos } from "../repo/types.js";
import { NOTE, type NotificationService } from "./notifications.js";

/** The `state` event: routing facts for `/stream/me` (never sent as such to clients). */
export interface CredentialStateEvent {
  event_id: string;
  registration_id: string;
  attendee_id: string;
  state: CredentialState;
}

/** The stored notice for a transition, or null when the product has none. */
export function noticeFor(from: CredentialState, to: CredentialState) {
  if (from === to) return null;
  if (to === "revoked") return NOTE.passRevoked;
  if (to === "suspended_review") return NOTE.passReview;
  if (to === "active" && from === "suspended_review") return NOTE.passCleared;
  if (to === "replaced") return NOTE.passReissued;
  return null;
}

export class CredentialStates {
  /** `state` (CredentialStateEvent) after every transition; `entitlements` is emitted by CredentialService. */
  readonly events = new EventEmitter();

  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
    private readonly notes: NotificationService | null,
  ) {}

  /**
   * Move `cred` to `to` (with an optional zone_state written in the same step). A move to the state
   * it is already in writes only the zone and tells nobody. Returns the updated row.
   */
  async move(cred: CredentialRow, to: CredentialState, extra: { zone_state?: string } = {}): Promise<CredentialRow> {
    if (cred.state === to) {
      return extra.zone_state !== undefined && extra.zone_state !== cred.zone_state ? this.repos.credentials.update(cred.id, { zone_state: extra.zone_state }) : cred;
    }
    const updated = await this.repos.credentials.setState(cred.id, {
      state: to,
      ...(to === "revoked" ? { revoked_at: new Date(this.clock.now()) } : {}),
      ...(extra.zone_state !== undefined ? { zone_state: extra.zone_state } : {}),
    });
    await this.announce(cred, to);
    return updated;
  }

  /** A transition the store already made (`cred` is the row as it was before): tell the holder. */
  async announce(cred: CredentialRow, to: CredentialState): Promise<void> {
    if (cred.state === to) return;
    await this.emit(cred, to);
    const notice = noticeFor(cred.state, to);
    if (notice && this.notes) await this.notes.forRegistration(cred.registration_id, notice);
  }

  /** The state did not change but what the pass shows did (a band reported lost): refresh the open pass. */
  async refresh(cred: CredentialRow): Promise<void> {
    await this.emit(cred, cred.state);
  }

  private async emit(cred: CredentialRow, state: CredentialState) {
    try {
      const reg = cred.registration_id ? await this.repos.registrations.byId(cred.registration_id) : null;
      if (!reg) return; // a staff credential has no holder to tell
      const e: CredentialStateEvent = { event_id: reg.event_id, registration_id: reg.id, attendee_id: reg.attendee_id, state };
      this.events.emit("state", e);
    } catch (err) {
      // The state is written; a failed push leaves the pass to catch up on its next read.
      console.error(`[credentials] state push failed: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    }
  }
}
