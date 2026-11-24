/**
 * Attendee self-service additions (the attendee portal's gaps) and the public occupancy read.
 *
 * - Everything under /me is the caller's own: the attendee id comes from the token (`ctx.sub`, the
 *   attendee's own record id), never from the request.
 * - GET /me and PATCH /me/profile: identity shown masked (email, phone); the profile edit needs no id.
 *   An erased or anonymous (Public-tier) identity answers 404 to the edit, as PATCH /users/:id/profile.
 * - GET /me/registrations: every own registration, unlisted (Private Invitation) events included,
 *   with its event and the state of its current pass.
 * - POST /me/credential/report-lost: the live wristband → `lost` at once (refused online at once by
 *   the scan decision; dropped from the next offline allowlist, the revocation epoch is bumped). No
 *   automatic replacement: the desk sees `band_lost` on the event's registrations and binds a stock
 *   band (01 §5.3). Audited; the attendee is notified.
 * - GET /events/:id/occupancy (public): the k-anonymised public scope (O-08) of a published or live
 *   event the caller may see, via the telemetry hub, cached a few seconds. `/stream/telemetry` stays
 *   closed to anonymous callers (O-19).
 */
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type Me, type MyRegistrationItem, type PublicOccupancy } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { hint } from "../domain/credential-service.js";
import { eventRef } from "../domain/event-ref.js";
import { mount } from "../http/route.js";
import type { AttendeeRow, CarrierRow } from "../repo/types.js";
import { canSeeEvent } from "./events.js";

/** Seconds a public occupancy read may be cached (by the server and by clients). */
export const PUBLIC_OCCUPANCY_MAX_AGE_S = 5;

const LIVE_BAND = new Set<CarrierRow["state"]>(["assigned", "bound", "active"]);

/** `o•••@example.com`: the first character of the local part and the whole domain. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** `••••• 4567`: the last four digits only. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `••••• ${digits.slice(-4)}`;
}

const meDto = (a: AttendeeRow): Me => ({ id: a.id, full_name: a.full_name, email_masked: maskEmail(a.email), phone_masked: maskPhone(a.phone) });

export function attendeeSelfRoutes(x: Express, app: AppContext) {
  const now = () => new Date(app.clock.now());
  const own = async (attendeeId: string) => {
    const a = await app.repos.attendees.byId(attendeeId);
    if (!a) throw new ContractError("NOT_FOUND");
    return a;
  };

  mount(x, app, endpoints.me, async ({ ctx }) => meDto(await own(ctx!.sub)));

  // Merges profile answers (keys not sent are kept); `phone: null` removes the phone. Not audited:
  // an attendee editing their own identity (operator edits are, on PATCH /users/:id/profile).
  mount(x, app, endpoints.updateMyProfile, async ({ body, ctx }) => {
    const a = await own(ctx!.sub);
    if (a.email === null && a.full_name === null) throw new ContractError("NOT_FOUND"); // erased or anonymous
    const ok = await app.repos.attendees.update(a.id, {
      ...(body.full_name !== undefined ? { full_name: body.full_name } : {}),
      ...(body.profile !== undefined ? { profile_jsonb: { ...a.profile_jsonb, ...body.profile } } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    });
    if (!ok) throw new ContractError("NOT_FOUND");
    return meDto(await own(a.id));
  });

  mount(x, app, endpoints.myRegistrations, async ({ ctx }) => {
    const regs = await app.repos.registrations.forAttendee(ctx!.sub);
    const items: (MyRegistrationItem & { starts: number })[] = [];
    for (const r of regs) {
      const e = await app.repos.events.byId(r.event_id);
      if (!e) continue;
      const cred = await app.repos.credentials.forRegistration(r.id);
      const carriers = cred ? await app.repos.carriers.forCredential(cred.id) : [];
      items.push({
        registration_id: r.id,
        event: await eventRef(app.repos, e),
        tier: r.tier,
        state: r.state,
        created_at: r.created_at.toISOString(),
        checked_in_at: r.checked_in_at?.toISOString() ?? null,
        zone_presence_consent: r.zone_presence_consent_at !== null,
        credential_state: cred?.state ?? null,
        band_bound: carriers.some((c) => c.kind === "nfc" && (c.state === "bound" || c.state === "active")),
        starts: e.starts_at?.getTime() ?? 0,
      });
    }
    // Newest event first.
    items.sort((a, b) => b.starts - a.starts || a.registration_id.localeCompare(b.registration_id));
    return { items: items.map(({ starts: _s, ...i }) => i) };
  });

  mount(x, app, endpoints.reportLostBand, async ({ body, ctx }) => {
    const reg = (await app.repos.registrations.forAttendee(ctx!.sub)).find((r) => r.event_id === body.event_id && r.state === "confirmed");
    if (!reg) throw new ContractError("NOT_FOUND");
    const cred = await app.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    const band = (await app.repos.carriers.forCredential(cred.id)).find((c) => c.kind === "nfc" && LIVE_BAND.has(c.state));
    if (band) {
      // One state change; the store bumps the event's revocation epoch (carriers_bump_epoch) so
      // offline gates drop the band with their next allowlist. Online gates refuse it at once.
      await app.repos.carriers.update(band.id, { state: "lost" });
      await app.audit.append({
        actorId: ctx!.sub, action: "carrier.report_lost", target: `carrier:${band.id}`,
        meta: { credential_id: cred.id, event_id: reg.event_id, from: band.state, by: "attendee" },
      });
      await app.notifications.forRegistration(reg.id, (event) => ({
        kind: "pass" as const, title: "Wristband reported lost",
        body: `Your wristband for ${event} no longer opens doors. Collect a new one at the desk; your pass in the app still works.`,
      }));
      app.credentials.notifyState(cred, cred.state);
      // Supervisors and operators see it live on /stream/alerts (no gate: gate staff do not). Like
      // every alert it names the credential, never the person; desk clerks, who have no live
      // channel, find it as `band_lost` on the event's registrations.
      await app.alerts.raise(
        { kind: "band_reported_lost", severity: "low", detail: `Wristband ${hint(band)} reported lost by its holder; gates now refuse it` },
        { eventId: reg.event_id, checkpointId: null, credentialId: cred.id },
      );
    }
    return { marked_lost: band !== undefined, credential: await app.credentials.myCredential(ctx!.sub, reg.event_id) };
  });

  /* ---- public occupancy ---- */
  const cache = new Map<string, { at: number; value: PublicOccupancy }>();
  mount(x, app, endpoints.publicOccupancy, async ({ params, ctx, req }) => {
    const e = await app.repos.events.byId(params.id);
    // Published or live only; an unlisted event only for its registered attendees (and operators).
    if (!e || (e.state !== "published" && e.state !== "live") || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    req.res?.setHeader("Cache-Control", `${e.listed_bool ? "public" : "private"}, max-age=${PUBLIC_OCCUPANCY_MAX_AGE_S}`);
    const t = app.clock.now();
    const hit = cache.get(e.id);
    if (hit && t - hit.at < PUBLIC_OCCUPANCY_MAX_AGE_S * 1000 && hit.value.live === (e.state === "live")) return hit.value;
    await app.scans.projection(e.id); // loads (and primes the hub with) the live counts
    const v = app.telemetry.publicView(e.id);
    const value: PublicOccupancy = { event_id: e.id, as_of: now().toISOString(), live: e.state === "live", ...v, max_age_s: PUBLIC_OCCUPANCY_MAX_AGE_S };
    cache.set(e.id, { at: t, value });
    if (cache.size > 1000) for (const [k, c] of cache) if (t - c.at >= PUBLIC_OCCUPANCY_MAX_AGE_S * 1000) cache.delete(k);
    return value;
  });
}
