import type { Express } from "express";
import { endpoints } from "@synan/contracts/rest";
import { ContractError } from "@synan/contracts/errors";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";

export function credentialRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.myCredential, async ({ query, ctx }) => app.credentials.myCredential(ctx!.sub, query.event_id));

  mount(x, app, endpoints.myCodes, async ({ query, ctx }) => app.credentials.portalCodes(ctx!.sub, query.event_id));

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

  mount(x, app, endpoints.revoke, async ({ params, body, ctx }) => app.credentials.revoke(ctx!, params.id, body.reason));

  mount(x, app, endpoints.clearReview, async ({ params, body, ctx }) =>
    app.credentials.clearReview(ctx!, params.id, body.outcome, body.note),
  );

  // Re-issue of the emailed copy: MFA + audited (03 §3 "credential re-issue").
  mount(x, app, endpoints.resend, async ({ params, ctx }) => {
    const cred = await app.repos.credentials.byId(params.id);
    if (!cred) throw new ContractError("NOT_FOUND");
    const { carrierId } = await app.credentials.sendEmailedQr(cred.id);
    await app.audit.append({ actorId: ctx!.sub, action: "credential.resend", target: `credential:${cred.id}`, meta: { carrier_id: carrierId } });
    return { ok: true as const };
  });
}
