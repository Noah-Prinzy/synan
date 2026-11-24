/**
 * Slice 4 — credentials and carriers (01 §5.2–§5.3).
 *
 * - Band UIDs are hashed on arrival (nfcIdentifier) and never stored or logged raw.
 * - Bind, rebind and lost-band replacement are each one atomic store step that also writes its audit
 *   entries (SQL: @synan/db carrier_bind / carrier_rebind / carrier_replace_lost; memory: a mirror).
 * - Staff bind only at a perimeter desk of the registration's venue during their shift; anything
 *   outside that scope answers 404, so a registration id from elsewhere reveals nothing.
 * - Desk codes: six characters from a 32-symbol alphabet, single use, 10 minutes, stored hashed;
 *   wrong guesses are limited per attendee.
 */
import { describeError } from "@synan/db";
import type { Express } from "express";
import { BAND_ERROR_COPY, ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import { CREDENTIAL_STATE_VALUES } from "@synan/contracts/enums";
import type { AppContext } from "../app.js";
import { carrierDto, credentialRef, hint } from "../domain/credential-service.js";
import { currentAssignments, currentCheckpoints, deskEventIds, mayWorkDeskFor } from "../domain/scope.js";
import { nfcIdentifier } from "../domain/scan-service.js";
import { mount } from "../http/route.js";
import { NOTE } from "../domain/notifications.js";
import type { BindStatus, CredentialRow } from "../repo/types.js";

const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);
/** Audit actions on a band (written by the store's bind, rebind and replacement steps) → the inventory's `recent` words. */
const RECENT_ACTION: Record<string, "bound" | "replaced" | "lost" | "reported_lost" | "retired"> = {
  "carrier.bind": "bound", "carrier.rebind": "replaced", "carrier.mark_lost": "lost", "carrier.report_lost": "reported_lost", "carrier.mark_retired": "retired",
};

function bindError(status: BindStatus | string, path: string): ContractError {
  switch (status) {
    case "unknown_carrier":
      return invalid(path, BAND_ERROR_COPY.unknown_band.message);
    case "not_in_stock":
      return new ContractError("CONFLICT", "This band is already in use.");
    case "credential_has_carrier":
      return new ContractError("CONFLICT", "This pass already has a band; replace it instead.");
    case "credential_not_usable":
      return new ContractError("CONFLICT", "This pass is revoked or under review.");
    case "no_current_carrier":
      return new ContractError("CONFLICT", "This pass has no band to replace.");
    case "carrier_not_live":
      return new ContractError("CONFLICT", "That band is not bound to a pass.");
    default:
      return new ContractError("CONFLICT", `Binding refused (${status}).`);
  }
}

export function carrierRoutes(x: Express, app: AppContext) {
  const now = () => new Date(app.clock.now());
  const audit = (actor: string, action: string, target: string, meta: Record<string, unknown>) => app.audit.append({ actorId: actor, action, target, meta });

  mount(x, app, endpoints.listCredentials, async ({ query }) => {
    let registrationIds: string[] | undefined;
    if (query.event_id) {
      const e = await app.repos.events.byId(query.event_id);
      if (!e) throw new ContractError("NOT_FOUND");
      registrationIds = (await app.repos.registrations.forEvent(e.id)).map((r) => r.id);
    }
    const rows = await app.repos.credentials.page({ registrationIds, state: query.state, after: query.cursor, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: await Promise.all(page.map((c) => app.credentials.toDto(c))), next_cursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });

  mount(x, app, endpoints.inventory, async ({ query, ctx }) => {
    if (!query.event_id) return app.repos.carriers.inventory();
    const e = await app.repos.events.byId(query.event_id);
    if (!e || !(await mayWorkDeskFor(app, ctx!, e))) throw new ContractError("NOT_FOUND");
    const regs = (await app.repos.registrations.forEvent(e.id)).map((r) => r.id);
    const creds = await app.repos.credentials.forRegistrations(regs);
    const credentials = Object.fromEntries(CREDENTIAL_STATE_VALUES.map((s) => [s, creds.filter((c) => c.state === s).length])) as Record<(typeof CREDENTIAL_STATE_VALUES)[number], number>;
    // Every band this event's passes ever had (lost and retired ones too): the audit targets to read.
    const bands = new Map((await app.repos.carriers.forCredentials(creds.map((c) => c.id))).filter((c) => c.kind === "nfc").map((c) => [`carrier:${c.id}`, c]));
    // A band bound as the replacement of a lost one (its `carrier.bind` is part of the replacement) reads
    // `replaced`, as `today.replaced` counts it — never `bound`.
    const swaps = creds.length
      ? await app.repos.audit.find({ actions: ["carrier.replace_lost", "carrier.replace_damaged"], targets: creds.map((c) => `credential:${c.id}`), limit: 10_000 })
      : [];
    const replacedInto = new Set(swaps.map((a) => `carrier:${String(a.meta_jsonb.new_carrier_id)}`));
    const recent = (await app.repos.audit.find({ actions: Object.keys(RECENT_ACTION), targets: [...bands.keys()], limit: 20 })).map((a) => {
      const band = bands.get(a.target)!;
      const credentialId = typeof a.meta_jsonb.credential_id === "string" ? a.meta_jsonb.credential_id : band.credential_id;
      const action = a.action === "carrier.bind" && replacedInto.has(a.target) ? "replaced" : RECENT_ACTION[a.action]!;
      return { at: a.at.toISOString(), action, carrier_id: band.id, credential_id: credentialId, band_hint: hint(band) };
    });
    return { ...(await app.repos.carriers.inventory(creds.map((c) => c.id))), credentials, recent, today: await deskShift(ctx!.sub, e, [...bands.keys(), ...creds.map((c) => `credential:${c.id}`)]) };
  });

  /** The caller's own desk work on this event since their current shift began (null without one). */
  const deskShift = async (userId: string, e: { id: string; venue_id: string | null }, targets: string[]) => {
    let shift = null;
    for (const a of await currentAssignments(app, userId)) {
      if (a.handed_over_at) continue;
      const cp = await app.repos.venues.checkpoint(a.checkpoint_id);
      if (!cp?.perimeter_bool || (a.event_id ? a.event_id !== e.id : cp.venue_id !== e.venue_id)) continue;
      if (!shift || a.shift_start < shift.shift_start) shift = a;
    }
    if (!shift) return null;
    const work = await app.repos.audit.find({
      actions: ["carrier.bind", "carrier.replace_lost", "carrier.replace_damaged", "credential.resend"],
      targets, actorId: userId, since: shift.shift_start, limit: 10_000,
    });
    // A lost-band replacement also binds its new band: count it once, as a replacement.
    const replacedInto = new Set(work.filter((a) => a.action === "carrier.replace_lost").map((a) => `carrier:${String(a.meta_jsonb.new_carrier_id)}`));
    return {
      since: shift.shift_start.toISOString(),
      bound: work.filter((a) => a.action === "carrier.bind" && !replacedInto.has(a.target)).length,
      replaced: work.filter((a) => a.action === "carrier.replace_lost" || a.action === "carrier.replace_damaged").length,
      resent: work.filter((a) => a.action === "credential.resend").length,
    };
  };

  mount(x, app, endpoints.importCarriers, async ({ body, ctx }) => {
    const byHash = new Map<string, string>();
    for (const uid of body.identifiers) {
      const h = nfcIdentifier(uid);
      if (!byHash.has(h)) byHash.set(h, uid);
    }
    const hashes = body.identifiers.map(nfcIdentifier);
    const r = await app.repos.carriers.importStock(hashes, body.chip_profile);
    await app.repos.carriers.noteHints(body.identifiers); // the readable last four (0035)
    const dupHashes = new Set(r.duplicates);
    const duplicates = hashes.length - r.inserted;
    await audit(ctx!.sub, "carrier.import", "carriers", { chip_profile: body.chip_profile, imported: r.inserted, duplicates });
    return { imported: r.inserted, duplicates, duplicate_identifiers: [...dupHashes].map((h) => byHash.get(h)!).filter(Boolean) };
  });

  mount(x, app, endpoints.bindCarrier, async ({ body, ctx }) => {
    const reg = await app.repos.registrations.byId(body.registration_id);
    const e = reg ? await app.repos.events.byId(reg.event_id) : null;
    if (!reg || !e || !e.venue_id || !(await mayWorkDeskFor(app, ctx!, e))) throw new ContractError("NOT_FOUND");
    if (reg.state !== "confirmed") throw new ContractError("CONFLICT", "The registration is not confirmed.");
    const cred = await app.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    await app.repos.carriers.noteHints([body.identifier]);
    const r = await app.repos.carriers.bind({ identifier: nfcIdentifier(body.identifier), credentialId: cred.id, actorId: ctx!.sub, now: now() });
    if (r.status !== "bound") throw bindError(r.status, "body.identifier");
    await app.notifications.forCredential(cred.id, NOTE.bandBound);
    return carrierDto((await app.repos.carriers.forCredential(cred.id)).find((c) => c.id === r.carrier_id)!);
  });

  mount(x, app, endpoints.rebindCarrier, async ({ params, body, ctx }) => {
    const old = (await app.repos.carriers.byId(params.id)) ?? null;
    if (!old || old.kind !== "nfc" || !old.credential_id || !old.identifier) throw new ContractError("NOT_FOUND");
    const cred = (await app.repos.credentials.byId(old.credential_id))!;
    if (ctx!.role === "desk_clerk") {
      // A desk clerk replaces bands only for the events at their desk (D-23).
      const reg = cred.registration_id ? await app.repos.registrations.byId(cred.registration_id) : null;
      const e = reg ? await app.repos.events.byId(reg.event_id) : null;
      if (!e || !(await mayWorkDeskFor(app, ctx!, e))) throw new ContractError("NOT_FOUND");
    }
    const newIdentifier = nfcIdentifier(body.identifier);
    await app.repos.carriers.noteHints([body.identifier]);
    if (body.disposition === "lost" && old.state === "lost") {
      // Already lost — reported by its holder (the pass is kept, 01 §5.3), or this replacement already
      // ran. Idempotent: bind the new band to the holder's current pass, or answer the band already
      // bound there by an earlier identical request.
      const current = cred.registration_id ? await app.repos.credentials.forRegistration(cred.registration_id) : cred;
      if (!current) throw new ContractError("NOT_FOUND");
      const live = (await app.repos.carriers.forCredential(current.id)).find((c) => c.kind === "nfc" && (c.state === "assigned" || c.state === "bound" || c.state === "active"));
      if (live) {
        if (live.identifier === newIdentifier) return carrierDto(live);
        throw bindError("credential_has_carrier", "body.identifier");
      }
      const r = await app.repos.carriers.bind({ identifier: newIdentifier, credentialId: current.id, actorId: ctx!.sub, now: now() });
      if (r.status !== "bound") throw bindError(r.status, "body.identifier");
      await audit(ctx!.sub, "carrier.replace_lost", `credential:${current.id}`, { reason: body.reason, old_carrier_id: old.id, new_carrier_id: r.carrier_id, already_lost: true });
      await app.notifications.forCredential(current.id, NOTE.bandBound);
      return carrierDto((await app.repos.carriers.forCredential(current.id)).find((c) => c.id === r.carrier_id)!);
    }
    if (body.disposition === "damaged") {
      const r = await app.repos.carriers.rebind({ credentialId: cred.id, newIdentifier, disposition: "retired", actorId: ctx!.sub, now: now() });
      if (r.status !== "rebound") throw bindError(r.status, "body.identifier");
      await audit(ctx!.sub, "carrier.replace_damaged", `credential:${cred.id}`, { reason: body.reason, old_carrier_id: r.old_carrier_id, new_carrier_id: r.new_carrier_id });
      await app.notifications.forCredential(cred.id, NOTE.bandBound);
      return carrierDto((await app.repos.carriers.forCredential(cred.id)).find((c) => c.id === r.new_carrier_id)!);
    }
    // Lost band (01 §5.3): band lost, credential replaced, a new credential issued, the new band bound — one step.
    const r = await app.repos.carriers.replaceLost({ lostIdentifier: old.identifier, newIdentifier, newCredentialRef: credentialRef(), actorId: ctx!.sub, now: now() });
    if (r.status !== "replaced") throw bindError(r.status, "body.identifier");
    await audit(ctx!.sub, "carrier.replace_lost", `credential:${r.old_credential_id}`, {
      reason: body.reason, old_carrier_id: r.old_carrier_id, new_carrier_id: r.new_carrier_id, new_credential_id: r.new_credential_id,
    });
    const fresh = (await app.repos.credentials.byId(r.new_credential_id!)) as CredentialRow;
    app.credentials.notifyState(cred, "replaced");
    // The old emailed code died with the old credential: send a new pass.
    if (fresh.registration_id) {
      await app.credentials.sendEmailedQr(fresh.id).catch((e: unknown) => console.error("[mail] pass delivery failed:", describeError(e)));
    }
    await app.notifications.forCredential(fresh.id, NOTE.passReissued);
    app.scans.forgetProjections();
    return carrierDto((await app.repos.carriers.forCredential(fresh.id)).find((c) => c.id === r.new_carrier_id)!);
  });

  mount(x, app, endpoints.deskCode, async ({ body, ctx }) => {
    await app.repos.carriers.noteHints([body.identifier]);
    const band = await app.repos.carriers.byIdentifier("nfc", nfcIdentifier(body.identifier));
    if (!band || band.state !== "stock") throw invalid("body.identifier", "this band is not in stock");
    // Staff hand out codes only while staffing a perimeter desk.
    if (ctx!.role === "desk_clerk" ? (await deskEventIds(app, ctx!.sub)).length === 0
      : ctx!.kind !== "operator" && !(await currentCheckpoints(app, ctx!.sub)).some((c) => c.perimeter_bool)) {
      throw new ContractError("CHECKPOINT_NOT_ASSIGNED");
    }
    const r = await app.repos.deskCodes.create({ bandIdentifier: band.identifier!, createdBy: ctx!.sub, now: now() });
    if (r.status !== "created" || !r.code || !r.expires_at) throw invalid("body.identifier", "this band is not in stock");
    await audit(ctx!.sub, "carrier.desk_code", `carrier:${band.id}`, {});
    return { code: r.code, expires_at: r.expires_at.toISOString() };
  });

  mount(x, app, endpoints.bindMyCredential, async ({ body, ctx }) => {
    const attendeeId = ctx!.sub;
    const reg = (await app.repos.registrations.forAttendee(attendeeId)).find((r) => r.event_id === body.event_id && r.state === "confirmed");
    if (!reg) throw new ContractError("NO_CREDENTIAL");
    const cred = await app.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    let identifier: string;
    if (body.binding.via === "nfc") {
      identifier = nfcIdentifier(body.binding.uid);
      await app.repos.carriers.noteHints([body.binding.uid]);
    } else {
      // Do not spend a code on a pass that cannot take a band.
      if ((await app.repos.carriers.forCredential(cred.id)).some((c) => c.kind === "nfc" && ["assigned", "bound", "active"].includes(c.state))) {
        throw bindError("credential_has_carrier", "body.binding.code");
      }
      // Wrong codes are counted per attendee in the store (5 per 10 minutes).
      const c = await app.repos.deskCodes.consume({ code: body.binding.code, attendeeId, now: now() });
      if (c.status === "too_many_attempts") throw new ContractError("RATE_LIMITED");
      if (c.status !== "consumed" || !c.carrier_identifier) throw invalid("body.binding.code", "this code is not valid");
      identifier = c.carrier_identifier;
    }
    // The attendee is the actor of the binding; the audit entry names the attendee id.
    const r = await app.repos.carriers.bind({ identifier, credentialId: cred.id, actorId: attendeeId, now: now() });
    if (r.status !== "bound") throw bindError(r.status, body.binding.via === "nfc" ? "body.binding.uid" : "body.binding.code");
    await app.notifications.forCredential(cred.id, NOTE.bandBound);
    return app.credentials.myCredential(attendeeId, body.event_id);
  });
}
