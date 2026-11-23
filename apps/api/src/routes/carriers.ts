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
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { carrierDto, credentialRef } from "../domain/credential-service.js";
import { currentCheckpoints, mayRunDesk } from "../domain/scope.js";
import { nfcIdentifier } from "../domain/scan-service.js";
import { mount } from "../http/route.js";
import type { BindStatus, CredentialRow } from "../repo/types.js";

const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);

function bindError(status: BindStatus | string, path: string): ContractError {
  switch (status) {
    case "unknown_carrier":
      return invalid(path, "this band is not known: import it first");
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

  mount(x, app, endpoints.inventory, async ({ query }) => {
    if (!query.event_id) return app.repos.carriers.inventory();
    const e = await app.repos.events.byId(query.event_id);
    if (!e) throw new ContractError("NOT_FOUND");
    const regs = (await app.repos.registrations.forEvent(e.id)).map((r) => r.id);
    return app.repos.carriers.inventory((await app.repos.credentials.forRegistrations(regs)).map((c) => c.id));
  });

  mount(x, app, endpoints.importCarriers, async ({ body, ctx }) => {
    const byHash = new Map<string, string>();
    for (const uid of body.identifiers) {
      const h = nfcIdentifier(uid);
      if (!byHash.has(h)) byHash.set(h, uid);
    }
    const hashes = body.identifiers.map(nfcIdentifier);
    const r = await app.repos.carriers.importStock(hashes, body.chip_profile);
    const dupHashes = new Set(r.duplicates);
    const duplicates = hashes.length - r.inserted;
    await audit(ctx!.sub, "carrier.import", "carriers", { chip_profile: body.chip_profile, imported: r.inserted, duplicates });
    return { imported: r.inserted, duplicates, duplicate_identifiers: [...dupHashes].map((h) => byHash.get(h)!).filter(Boolean) };
  });

  mount(x, app, endpoints.bindCarrier, async ({ body, ctx }) => {
    const reg = await app.repos.registrations.byId(body.registration_id);
    const e = reg ? await app.repos.events.byId(reg.event_id) : null;
    if (!reg || !e || !(await mayRunDesk(app, ctx!, e.venue_id))) throw new ContractError("NOT_FOUND");
    if (reg.state !== "confirmed") throw new ContractError("CONFLICT", "The registration is not confirmed.");
    const cred = await app.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    const r = await app.repos.carriers.bind({ identifier: nfcIdentifier(body.identifier), credentialId: cred.id, actorId: ctx!.sub, now: now() });
    if (r.status !== "bound") throw bindError(r.status, "body.identifier");
    return carrierDto((await app.repos.carriers.forCredential(cred.id)).find((c) => c.id === r.carrier_id)!);
  });

  mount(x, app, endpoints.rebindCarrier, async ({ params, body, ctx }) => {
    const old = (await app.repos.carriers.byId(params.id)) ?? null;
    if (!old || old.kind !== "nfc" || !old.credential_id || !old.identifier) throw new ContractError("NOT_FOUND");
    const cred = (await app.repos.credentials.byId(old.credential_id))!;
    const newIdentifier = nfcIdentifier(body.identifier);
    if (body.disposition === "damaged") {
      const r = await app.repos.carriers.rebind({ credentialId: cred.id, newIdentifier, disposition: "retired", actorId: ctx!.sub, now: now() });
      if (r.status !== "rebound") throw bindError(r.status, "body.identifier");
      await audit(ctx!.sub, "carrier.replace_damaged", `credential:${cred.id}`, { reason: body.reason, old_carrier_id: r.old_carrier_id, new_carrier_id: r.new_carrier_id });
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
      await app.credentials.sendEmailedQr(fresh.id).catch((e: unknown) => console.error("[mail] pass delivery failed:", e instanceof Error ? e.message : String(e)));
    }
    app.scans.forgetProjections();
    return carrierDto((await app.repos.carriers.forCredential(fresh.id)).find((c) => c.id === r.new_carrier_id)!);
  });

  mount(x, app, endpoints.deskCode, async ({ body, ctx }) => {
    const band = await app.repos.carriers.byIdentifier("nfc", nfcIdentifier(body.identifier));
    if (!band || band.state !== "stock") throw invalid("body.identifier", "this band is not in stock");
    // Staff hand out codes only while staffing a perimeter desk.
    if (ctx!.kind !== "operator" && !(await currentCheckpoints(app, ctx!.sub)).some((c) => c.perimeter_bool)) {
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
    return app.credentials.myCredential(attendeeId, body.event_id);
  });
}
