/**
 * The registration desk (D8) as the desk clerk's screen calls it: find a registration, bind a
 * band, replace one (rebind, or lost and replaced), resend the pass, hand out a desk code, and
 * confirm a second factor. Every function is named and shaped after its contract endpoint, so
 * wiring the real API is a change of transport only:
 *
 *   registrations  GET  /events/:id/registrations?q=&limit=      eventRegistrations
 *   registration   (re-query of the above; a single-row read is proposed, NOT IN CONTRACTS)
 *   inventory      GET  /credentials/inventory?event_id=          inventory
 *   bind           POST /carriers/bind                            bindCarrier
 *   rebind         POST /carriers/:id/rebind          (mfa)       rebindCarrier
 *   resend         POST /credentials/:id/resend       (mfa)       resend
 *   deskCode       POST /carriers/desk-code                       deskCode
 *   verifyMfa      POST /auth/mfa/verify                          mfaVerify
 *
 * The state underneath is the configure mock's (the same attendees, bands and desk log the event
 * workspace shows), so a band bound here appears on D6.4 and D6.5 at once. This layer adds what
 * the desk needs on top: the contract shapes, the second factor, desk codes, and named demo
 * bands for each refusal. Errors are `MockApiError` with the contract code; a lost connection is
 * a `TypeError`, as `fetch` throws it.
 *
 * Demo bands (any hex, 8–32 characters):
 *   FF…   unknown: never imported                 → VALIDATION_FAILED (identifier)
 *   EE…   not in stock: retired or set aside      → CONFLICT (identifier)
 *   0B…   already bound to another attendee       → CONFLICT (identifier)
 *   anything else is a stock band.
 * Second factor: any six digits except 000000; a confirmation lasts 15 minutes, as on the API.
 */
import type { z } from "zod";
import type { CarrierState, CredentialState } from "@synan/contracts/enums";
import type { ErrorCode } from "@synan/contracts/errors";
import type {
  BindRequest,
  Carrier,
  DeskCode,
  DeskCodeRequest,
  EventRegistrationsQuery,
  Inventory,
  MfaVerifyRequest,
  RebindRequest,
  RegistrationRow,
} from "@synan/contracts/rest";
import type { MockClock } from "../clock";
import { delay } from "../portal";
import { hashString, idFor } from "../random";
import { MockApiError, type ConfigureApi, type DeskAttendee } from "./configure";

/* --------------------------------------------------------------------- types */

/**
 * One registration as the desk reads it: the contract `RegistrationRow`, plus two fields the
 * desk needs that contracts does not carry yet (both NOT IN CONTRACTS, proposed as additive):
 *   carrier_id    the bound band's carrier id, which POST /carriers/:id/rebind takes;
 *   pass_sent_at  when the pass email last went out.
 */
export type DeskRegistration = z.infer<typeof RegistrationRow> & {
  carrier_id: string | null;
  pass_sent_at: string | null;
};

export type DeskRegistrationQuery = Pick<z.input<typeof EventRegistrationsQuery>, "q" | "limit">;

export interface DeskRegistrationPage {
  items: DeskRegistration[];
  next_cursor: string | null;
  /** The event's registrations before the search (contract: additive `total`). */
  total?: number;
}

export type DeskInventory = z.infer<typeof Inventory> & {
  /** This desk's work since the shift began (mock: since the page opened). NOT IN CONTRACTS. */
  today: { bound: number; replaced: number; resent: number };
};

export type DeskBindBody = z.input<typeof BindRequest>;
export type DeskRebindBody = z.input<typeof RebindRequest>;
export type DeskCodeBody = z.input<typeof DeskCodeRequest>;
export type DeskCodeResult = z.infer<typeof DeskCode>;
export type DeskCarrier = z.infer<typeof Carrier>;
export type MfaVerifyBody = z.input<typeof MfaVerifyRequest>;

export interface DeskApi {
  registrations(eventId: string, query: DeskRegistrationQuery): Promise<DeskRegistrationPage>;
  registration(eventId: string, registrationId: string): Promise<DeskRegistration>;
  inventory(eventId: string): Promise<DeskInventory>;
  bind(body: DeskBindBody): Promise<DeskCarrier>;
  /** Requires a recent second factor (MFA_REQUIRED otherwise). */
  rebind(carrierId: string, body: DeskRebindBody): Promise<DeskCarrier>;
  /** Requires a recent second factor (MFA_REQUIRED otherwise). Rate-limited per attendee. */
  resend(credentialId: string): Promise<{ ok: true }>;
  deskCode(body: DeskCodeBody): Promise<DeskCodeResult>;
  /** The real answer is a stepped-up TokenPair; the desk needs only that it worked. */
  verifyMfa(body: MfaVerifyBody): Promise<{ ok: true }>;
  /** Development controls. Absent from the real client. */
  mock: DeskMockControls;
}

export interface DeskMockControls {
  /** Every call fails as a lost connection would, until switched back. */
  setOffline(offline: boolean): void;
  isOffline(): boolean;
  /** Stand in for the attendee entering a desk code on their phone (A5). */
  redeemDeskCode(code: string, registrationId: string): Promise<void>;
  /** A band UID for each demo case. */
  sampleBand(kind: "stock" | "unknown" | "not_in_stock" | "bound_elsewhere"): string;
  /** Forget the second factor, so the next privileged action asks again. */
  expireMfa(): void;
  /** Start the desk's box at this many bands (null: the default box). */
  setStock(count: number | null): void;
  /** The next desk call fails with this code (the server's error state). */
  failNext(code: ErrorCode): void;
}

export interface DeskMockOptions {
  configure: ConfigureApi;
  clock: MockClock;
  latencyMs: number;
  /**
   * The demo rules: named demo bands, the mock second factor, the desk's own box, mock desk codes
   * and the offline switch. Default true. False when `configure` is the real API client: the server
   * refuses bands, the API client asks for the second factor itself, and calls pass straight through.
   */
  demo?: boolean;
}

/* --------------------------------------------------------------- the mock */

const MFA_WINDOW_MS = 15 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
/** Bands in the desk's box when the page opens. */
const DESK_BOX = 412;
/** The desk-code alphabet: 32 symbols, no 0/O, 1/I (contracts `DeskCode`). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createDeskMock({ configure, clock, latencyMs, demo = true }: DeskMockOptions): DeskApi {
  let offline = false;
  let mfaUntil = 0;
  let sampleCounter = 0;
  let stockOverride: number | null = null;
  let failing: ErrorCode | null = null;
  /** Where each registration, credential and carrier lives, learned as rows are read. */
  const eventOf = new Map<string, string>();
  const byCredential = new Map<string, string>();
  const byCarrier = new Map<string, string>();
  const codes = new Map<string, { identifier: string; eventId: string | null; expires: number; used: boolean }>();

  const now = () => new Date(clock.now()).toISOString();

  const online = async (ms = Math.min(latencyMs, 250)) => {
    if (!demo) return;
    await delay(ms);
    if (offline) throw new TypeError("Failed to fetch");
    if (failing) {
      const code = failing;
      failing = null;
      throw new MockApiError(code);
    }
  };

  const remember = (eventId: string, row: DeskAttendee) => {
    eventOf.set(row.registration_id, eventId);
    if (row.credential_id) byCredential.set(row.credential_id, row.registration_id);
    if (row.carrier_id) byCarrier.set(row.carrier_id, row.registration_id);
  };

  const toRow = (eventId: string, row: DeskAttendee): DeskRegistration => {
    remember(eventId, row);
    const seed = hashString(row.registration_id);
    return {
      id: row.registration_id,
      event_id: eventId,
      tier: row.tier,
      state: row.state,
      zone_presence_consent_at: null,
      created_at: new Date(clock.now() - (5 + (seed % 40)) * 86_400_000).toISOString(),
      attendee: { id: row.attendee_id, full_name: row.full_name, email: row.email },
      credential_id: row.credential_id,
      credential_state: row.credential_state,
      band_hint: row.band_hint,
      checked_in_at: row.checked_in ? row.last_scan_at : null,
      band_lost: false,
      carrier_id: row.carrier_id,
      pass_sent_at: row.pass_sent_at,
    };
  };

  const carrierOf = (row: DeskAttendee, identifier: string): DeskCarrier => ({
    id: row.carrier_id ?? idFor(`carrier:${identifier}`),
    credential_id: row.credential_id,
    kind: "nfc",
    identifier_hint: row.band_hint ?? "",
    chip_profile: row.tier === "VIP" || row.tier === "PRIVATE_INVITE" ? "ntag424_dna" : "ntag_uid",
    state: "bound",
    bound_at: now(),
    redeemed_at: null,
  });

  /** The demo refusals the configure mock does not model, checked the way the server would. */
  const demoBand = (raw: string) => {
    const identifier = raw.replace(/[\s:-]/g, "").toUpperCase();
    // The configure mock (or the server) words the format errors.
    if (!demo || !/^[0-9A-F]{8,32}$/.test(identifier)) return identifier;
    if (identifier.startsWith("FF")) {
      throw new MockApiError("VALIDATION_FAILED", {
        identifier: "We don't know this band: it was never imported. Take a band from this event's box.",
      });
    }
    if (identifier.startsWith("EE")) {
      throw new MockApiError("CONFLICT", {
        identifier: "This band is not in stock: it is retired or set aside for someone else. Take another band from the box.",
      });
    }
    if (identifier.startsWith("0B")) {
      throw new MockApiError("CONFLICT", {
        identifier: "This band is already bound to another attendee. Keep it aside and take a fresh band from the box.",
      });
    }
    return identifier;
  };

  const locate = (registrationId: string | undefined) => {
    const eventId = registrationId ? eventOf.get(registrationId) : undefined;
    if (!registrationId || !eventId) throw new MockApiError("NOT_FOUND");
    return { eventId, registrationId };
  };

  const needMfa = () => {
    if (demo && clock.now() > mfaUntil) throw new MockApiError("MFA_REQUIRED");
  };

  const api: DeskApi = {
    async registrations(eventId, query) {
      await online(0);
      const q = query.q?.trim() ?? "";
      const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 500);
      const page = await configure.attendees(eventId, q ? { q } : {});
      if (offline) throw new TypeError("Failed to fetch");
      const shown = page.items.slice(0, limit);
      // On the real API one desk row costs two list reads: the results carry the table row, and
      // the card reads the full registration (credential and band ids) when it opens.
      const rows: DeskAttendee[] = demo
        ? await Promise.all(shown.map((row) => configure.deskAttendee(eventId, row.registration_id)))
        : shown.map((row) => ({ ...row, credential_id: null, carrier_id: null, pass_sent_at: null, band_changed_at: null }));
      return {
        items: rows.map((row) => toRow(eventId, row)),
        next_cursor: page.items.length > limit ? (page.items[limit - 1]?.registration_id ?? null) : null,
        total: page.total,
      };
    },

    async registration(eventId, registrationId) {
      await online(0);
      return toRow(eventId, await configure.deskAttendee(eventId, registrationId));
    },

    async inventory(eventId) {
      await online(0);
      const [stock, overview] = await Promise.all([configure.deskStock(eventId), configure.credentialOverview(eventId)]);
      // The desk's own box: the configure mock counts stock across the organisation, which a
      // busy demo event can run to zero; the desk starts from a box of its own.
      const inBox = demo ? Math.max(0, (stockOverride ?? DESK_BOX) - stock.today.bound - stock.today.replaced) : stock.stock;
      const by_state: Record<CarrierState, number> = { ...overview.by_state, stock: inBox, bound: stock.bound, lost: stock.lost };
      const credentials: Record<CredentialState, number> = overview.credentials;
      return { by_state, by_chip_profile: overview.by_chip_profile, credentials, today: stock.today };
    },

    async bind(body) {
      await online(0);
      const { eventId, registrationId } = locate(body.registration_id);
      const identifier = demoBand(body.identifier);
      const row = await configure.bindBand(eventId, { registration_id: registrationId, identifier });
      remember(eventId, row);
      return carrierOf(row, identifier);
    },

    async rebind(carrierId, body) {
      await online(0);
      const registrationId = byCarrier.get(carrierId);
      const { eventId } = locate(registrationId);
      needMfa();
      const identifier = demoBand(body.identifier);
      const row = await configure.replaceBand(eventId, {
        registration_id: registrationId as string,
        identifier,
        reason: body.reason,
        disposition: body.disposition ?? "lost",
      });
      byCarrier.delete(carrierId);
      remember(eventId, row);
      return carrierOf(row, identifier);
    },

    async resend(credentialId) {
      await online(0);
      const { eventId, registrationId } = locate(byCredential.get(credentialId));
      needMfa();
      await configure.resendPass(eventId, registrationId);
      return { ok: true };
    },

    async deskCode(body) {
      // On the real API the call (POST /carriers/desk-code) belongs in the API client: not wired yet.
      if (!demo) throw new MockApiError("NOT_IMPLEMENTED");
      await online(Math.min(latencyMs * 2, 500));
      const identifier = demoBand(body.identifier);
      if (!/^[0-9A-F]{8,32}$/.test(identifier)) {
        throw new MockApiError("VALIDATION_FAILED", { identifier: "A band number is 8 to 32 characters, digits 0–9 and letters A–F. Scan it again." });
      }
      let code = "";
      const seed = hashString(`${identifier}:${clock.now()}`);
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[(seed >>> (i * 5)) % CODE_ALPHABET.length] ?? "A";
      const expires = clock.now() + CODE_TTL_MS;
      codes.set(code, { identifier, eventId: null, expires, used: false });
      return { code, expires_at: new Date(expires).toISOString() };
    },

    async verifyMfa(body) {
      await online(Math.min(latencyMs * 2, 500));
      if (!/^\d{6}$/.test(body.code)) {
        throw new MockApiError("VALIDATION_FAILED", { code: "The code is six digits, from your authenticator app." });
      }
      if (body.code === "000000") throw new MockApiError("INVALID_MFA_CODE");
      mfaUntil = clock.now() + MFA_WINDOW_MS;
      return { ok: true };
    },

    mock: {
      setOffline(value) {
        offline = value;
      },
      isOffline: () => offline,
      async redeemDeskCode(code, registrationId) {
        const entry = codes.get(code);
        if (!entry || entry.used || clock.now() > entry.expires) throw new MockApiError("VALIDATION_FAILED", { code: "That code has expired or was used." });
        const { eventId } = locate(registrationId);
        entry.used = true;
        const row = await configure.bindBand(eventId, { registration_id: registrationId, identifier: entry.identifier });
        remember(eventId, row);
      },
      sampleBand(kind) {
        sampleCounter += 1;
        const tail = (clock.now() + sampleCounter * 7919).toString(16).toUpperCase().slice(-10).padStart(10, "0");
        const prefix = { stock: "04", unknown: "FF", not_in_stock: "EE", bound_elsewhere: "0B" }[kind];
        return `${prefix}${tail}`;
      },
      expireMfa() {
        mfaUntil = 0;
      },
      setStock(count) {
        stockOverride = count;
      },
      failNext(code) {
        failing = code;
      },
    },
  };
  return api;
}
