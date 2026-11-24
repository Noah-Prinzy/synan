import type { Express } from "express";
import { endpoints } from "@synan/contracts/rest";
import { ContractError } from "@synan/contracts/errors";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { NOTE } from "../domain/notifications.js";
import type { AuthContext } from "../domain/principal.js";
import { mayWorkDeskFor } from "../domain/scope.js";

export function credentialRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.myCredential, async ({ query, ctx }) => app.credentials.myCredential(ctx!.sub, query.event_id));

  mount(x, app, endpoints.myCodes, async ({ query, ctx }) => app.credentials.portalCodes(ctx!.sub, query.event_id));

  // "Email me a copy": the attendee's own pass for one event, to the address on file. Same answer
  // whatever happens; the work runs off the request path so timing does not tell either. Strict
  // per-attendee limit (RATE_SELF_RESEND_PER_HOUR, every request counts). Through the outbox like the
  // operator resend; audited (credential id, carrier id, event id — never the address).
  mount(x, app, endpoints.resendMyCredential, async ({ body, ctx }) => {
    const attendeeId = ctx!.sub;
    const limited = app.rateLimiter.hit(`self-resend:${attendeeId}`, app.config.selfResendPerHour, 3_600_000) !== null;
    if (!limited) {
      app.mail.background("pass.self_resend", async () => {
        const reg = (await app.repos.registrations.forAttendee(attendeeId)).find((r) => r.event_id === body.event_id && r.state !== "cancelled");
        if (!reg) return;
        const event = await app.repos.events.byId(reg.event_id);
        if (!event || (event.state !== "published" && event.state !== "live")) return;
        const cred = await app.repos.credentials.forRegistration(reg.id);
        if (!cred || (cred.state !== "issued" && cred.state !== "active")) return;
        if (!(await app.repos.attendees.byId(attendeeId))?.email) return;
        const { carrierId } = await app.credentials.sendEmailedQr(cred.id);
        await app.audit.append({ actorId: attendeeId, action: "credential.resend_self", target: `credential:${cred.id}`, meta: { carrier_id: carrierId, event_id: event.id } });
      });
    }
    return { accepted: true as const };
  });

  // The signed-in attendee's own registration for one event ("Your status"). Only ever their own:
  // the attendee id comes from the token, never from the request.
  mount(x, app, endpoints.myRegistration, async ({ query, ctx }) => {
    const reg = (await app.repos.registrations.forAttendee(ctx!.sub)).find((r) => r.event_id === query.event_id);
    if (!reg) return { registration: null };
    const cred = await app.repos.credentials.forRegistration(reg.id);
    return {
      registration: {
        registration_id: reg.id,
        event_id: reg.event_id,
        tier: reg.tier,
        state: reg.state,
        checked_in_at: reg.checked_in_at?.toISOString() ?? null,
        checked_in: reg.checked_in_at !== null,
        zone_presence_consent: reg.zone_presence_consent_at !== null,
        credential_state: cred?.state ?? null,
      },
    };
  });

  // A supervisor clears or revokes a pass under review only with a fresh second factor (D-23).
  const supervisorStepUp = (ctx: AuthContext) => {
    if (ctx.role === "supervisor" && !app.auth.isMfaFresh(ctx)) throw new ContractError("MFA_REQUIRED");
  };
  mount(x, app, endpoints.revoke, async ({ params, body, ctx }) => {
    supervisorStepUp(ctx!);
    return app.credentials.revoke(ctx!, params.id, body.reason);
  });

  mount(x, app, endpoints.clearReview, async ({ params, body, ctx }) => {
    supervisorStepUp(ctx!);
    return app.credentials.clearReview(ctx!, params.id, body.outcome, body.note);
  });

  // Re-issue of the emailed copy: MFA + audited (03 §3 "credential re-issue").
  mount(x, app, endpoints.resend, async ({ params, ctx }) => {
    const cred = await app.repos.credentials.byId(params.id);
    if (!cred) throw new ContractError("NOT_FOUND");
    if (ctx!.role === "desk_clerk") {
      // A desk clerk resends only passes of the events at their desk (D-23).
      const reg = cred.registration_id ? await app.repos.registrations.byId(cred.registration_id) : null;
      const e = reg ? await app.repos.events.byId(reg.event_id) : null;
      if (!e || !(await mayWorkDeskFor(app, ctx!, e))) throw new ContractError("NOT_FOUND");
    }
    const { carrierId } = await app.credentials.sendEmailedQr(cred.id);
    await app.audit.append({ actorId: ctx!.sub, action: "credential.resend", target: `credential:${cred.id}`, meta: { carrier_id: carrierId } });
    await app.notifications.forCredential(cred.id, NOTE.passReissued);
    return { ok: true as const };
  });
}
