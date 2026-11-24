/**
 * Slice 5 — the signed offline allowlist (01 §8, 03 §4, D-12).
 *
 * - Staff: only for a checkpoint they are staffing now (server time), at the event's venue, for the
 *   window now → shift end. Operators: any checkpoint or the whole event, for the event's window.
 * - Payload: credential references, band hashes, tier, permitted rooms, state, revocation epoch.
 *   No identities, no secrets. Signed (EdDSA compact JWS) with the active `allowlist` key; scanners
 *   verify with the public key from GET /auth/signing-keys.
 * - Unlisted events: a staff caller with no current assignment at the venue gets 404, like a missing event.
 */
import { CompactSign } from "jose";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { ALLOWLIST_JWS_TYP, endpoints, type AllowlistPayload } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { currentAssignments } from "../domain/scope.js";
import { mount } from "../http/route.js";
import { isScheduled } from "../repo/types.js";

export async function signAllowlist(app: AppContext, payload: AllowlistPayload) {
  const { kid, privateKey } = app.keys.active("allowlist");
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "EdDSA", kid, typ: ALLOWLIST_JWS_TYP })
    .sign(privateKey);
  return { kid, jws, issued_at: payload.issued_at };
}

export function allowlistRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.allowlist, async ({ params, query, ctx, ip }) => {
    const found = await app.repos.events.byId(params.id);
    // A draft without venue or dates has nothing to admit anyone to: answered like a missing event.
    if (!found || !isScheduled(found)) throw new ContractError("NOT_FOUND");
    const e = found;
    const now = app.clock.now();
    let checkpointId = query.checkpoint_id ?? null;
    let from: number;
    let to: number;
    let shiftEnd: Date | null = null;
    if (ctx!.kind === "device") {
      // A fixed reader: its own checkpoint only, for the event's window (it has no shift).
      if (!ctx!.checkpointId || (checkpointId && checkpointId !== ctx!.checkpointId)) {
        // A gate device asking for another gate's list (03 §8.2, assignment check).
        await app.scannerTrust.refused({ reason: "not_assigned", channel: "GET /events/:id/allowlist", ip, deviceId: ctx!.sub, checkpointId, eventId: e.id });
        throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
      }
      const cp = await app.repos.venues.checkpoint(ctx!.checkpointId);
      if (!cp || cp.venue_id !== e.venue_id) throw new ContractError("NOT_FOUND");
      checkpointId = cp.id;
      from = Math.max(now, e.starts_at.getTime());
      to = e.ends_at.getTime();
    } else if (ctx!.kind === "operator") {
      if (checkpointId) {
        const cp = await app.repos.venues.checkpoint(checkpointId);
        if (!cp || cp.venue_id !== e.venue_id) throw new ContractError("NOT_FOUND");
      }
      from = e.starts_at.getTime();
      to = e.ends_at.getTime();
    } else {
      // Current shifts at this venue (and for this event, when the shift names one).
      const mine = [];
      for (const a of await currentAssignments(app, ctx!.sub)) {
        const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
        if (cp && cp.venue_id === e.venue_id && (a.event_id == null || a.event_id === e.id)) mine.push(a);
      }
      if (mine.length === 0) throw new ContractError("NOT_FOUND");
      const shift = checkpointId ? mine.find((a) => a.checkpoint_id === checkpointId) : mine.length === 1 ? mine[0] : undefined;
      if (!shift) {
        if (!checkpointId) throw new ContractError("VALIDATION_FAILED", "checkpoint_id is required", [{ path: "query.checkpoint_id", message: "required" }]);
        throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
      }
      checkpointId = shift.checkpoint_id;
      from = now;
      to = shift.shift_end.getTime();
      shiftEnd = shift.shift_end;
    }
    if (e.state !== "published" && e.state !== "live") throw new ContractError("EVENT_NOT_LIVE");
    if (to <= from) to = from + 1; // an event already past its end still yields a (state-only) list
    const data = await app.repos.events.allowlist(e.id, { from: new Date(from), to: new Date(to), checkpointId });
    const payload: AllowlistPayload = {
      event_id: e.id,
      checkpoint_id: checkpointId,
      shift_end: shiftEnd?.toISOString() ?? null,
      revocation_epoch: data.revocation_epoch,
      access_rules_version: data.access_rules_version,
      window_start: new Date(from).toISOString(),
      window_end: new Date(to).toISOString(),
      issued_at: new Date(now).toISOString(),
      entries: data.entries,
    };
    return signAllowlist(app, payload);
  });
}
