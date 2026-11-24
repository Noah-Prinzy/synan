/**
 * The desk on the real API: `DeskApi`, call for call, straight to the contract endpoints. Loaded
 * by desk-api.ts with a dynamic import only when VITE_API_URL is set, so the mock build carries
 * none of it (and the real build none of the desk mock).
 *
 *   registrations  GET  /events/:id/registrations?q=&limit=   rows carry carrier_id, pass_sent_at, band_lost
 *   registration   GET  /registrations/:id
 *   inventory      GET  /credentials/inventory (stock) and ?event_id= (the event's bands, recent, today)
 *   bind           POST /carriers/bind
 *   rebind         POST /carriers/:id/rebind          (second factor: the console's prompt asks)
 *   resend         POST /credentials/:id/resend       (second factor: the console's prompt asks)
 *   deskCode       POST /carriers/desk-code
 *   verifyMfa      POST /auth/mfa/verify               (unused here: the console's prompt steps up)
 *
 * Failures are the API client's `ApiFailure` (code, field issues, `kind: "network"`), which the
 * desk's error helpers read by shape.
 */
import type { DeskApi, DeskInventory, DeskMockControls, DeskRegistration } from "@synan/mock/command";
import type { RegistrationRow } from "@synan/contracts/rest";
import type { AdminAuth, ApiClient } from "../api";

function toDeskRow(row: RegistrationRow): DeskRegistration {
  return { ...row, carrier_id: row.carrier_id ?? null, pass_sent_at: row.pass_sent_at ?? null };
}

/** The development controls do not exist against a real server: nothing to switch, never offline by hand. */
const NO_CONTROLS: DeskMockControls = {
  setOffline: () => undefined,
  isOffline: () => false,
  redeemDeskCode: () => Promise.reject(new Error("Only the attendee's phone can redeem a desk code on the real API.")),
  sampleBand: () => "",
  expireMfa: () => undefined,
  setStock: () => undefined,
  failNext: () => undefined,
};

export function createRealDesk(client: ApiClient, auth: AdminAuth): DeskApi {
  return {
    async registrations(eventId, query) {
      const page = await client.call("eventRegistrations", {
        params: { id: eventId },
        query: { q: query.q?.trim() || undefined, limit: query.limit },
      });
      return { items: page.items.map(toDeskRow), next_cursor: page.next_cursor, total: (page as { total?: number }).total };
    },

    async registration(eventId, registrationId) {
      const row = await client.call("getRegistration", { params: { id: registrationId } });
      if (row.event_id !== eventId) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      return toDeskRow(row);
    },

    async inventory(eventId): Promise<DeskInventory> {
      // Stock is the organisation's box; the event's read carries its bands, recent actions and
      // this clerk's own work this shift (`today`, null without a shift).
      const [all, event] = await Promise.all([client.call("inventory", {}), client.call("inventory", { query: { event_id: eventId } })]);
      const today = event.today ?? null;
      return {
        ...event,
        by_state: { ...event.by_state, stock: all.by_state.stock ?? 0 },
        today: { bound: today?.bound ?? 0, replaced: today?.replaced ?? 0, resent: today?.resent ?? 0 },
      };
    },

    bind: (body) => client.call("bindCarrier", { body: { registration_id: body.registration_id, identifier: body.identifier } }),

    rebind: (carrierId, body) =>
      client.call("rebindCarrier", { params: { id: carrierId }, body: { identifier: body.identifier, reason: body.reason, disposition: body.disposition ?? "lost" } }),

    async resend(credentialId) {
      await client.call("resend", { params: { id: credentialId } });
      return { ok: true as const };
    },

    deskCode: (body) => client.call("deskCode", { body: { identifier: body.identifier } }),

    async verifyMfa(body) {
      await auth.stepUp(body.code);
      return { ok: true as const };
    },

    mock: NO_CONTROLS,
  };
}
