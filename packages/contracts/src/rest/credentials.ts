/** Credentials and carriers (02 §5, 01 §5). */
import { z } from "zod";
import { Id, IsoDateTime, Ok, pageOf, PageQuery, ZoneState } from "../common.js";
import { AttendeeTier, CarrierKind, CarrierState, ChipProfile, CredentialState } from "../enums/index.js";
import { DESK, endpoint, IdParam, OPERATORS, SUPERVISE } from "./endpoint.js";

export const Carrier = z.object({
  id: Id,
  credential_id: Id.nullable(),
  kind: CarrierKind,
  /** Masked for display; the full NFC UID is never returned. */
  identifier_hint: z.string(),
  chip_profile: ChipProfile.nullable(),
  state: CarrierState,
  bound_at: IsoDateTime.nullable(),
  redeemed_at: IsoDateTime.nullable(),
});
export type Carrier = z.infer<typeof Carrier>;

export const Credential = z.object({
  id: Id,
  registration_id: Id.nullable(),
  staff_user_id: Id.nullable(),
  tier: AttendeeTier.nullable(),
  state: CredentialState,
  zone_state: ZoneState,
  issued_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
  carriers: z.array(Carrier),
});
export type Credential = z.infer<typeof Credential>;

export const CredentialQuery = PageQuery.extend({
  event_id: Id.optional(),
  state: CredentialState.optional(),
});

export const Inventory = z.object({
  by_state: z.record(CarrierState, z.number().int()),
  by_chip_profile: z.record(z.string(), z.number().int()),
  /** Additive, with `event_id` (06 D6.5): the event's credentials by state, every state present. */
  credentials: z.record(CredentialState, z.number().int()).optional(),
  /**
   * Additive, with `event_id`: the event's latest wristband actions, newest first (at most 20), from
   * the audit log — ids and band hints only, never a name. `bound`: a stock band bound to a pass;
   * `replaced`: a band swapped for another; `lost`: marked lost (by the desk, or `reported_lost` by
   * its holder); `retired`: taken out of service when swapped as damaged.
   */
  recent: z
    .array(
      z.object({
        at: IsoDateTime,
        action: z.enum(["bound", "replaced", "lost", "reported_lost", "retired"]),
        carrier_id: Id,
        credential_id: Id.nullable(),
        band_hint: z.string(),
      }),
    )
    .optional(),
  /**
   * Additive, with `event_id`: the caller's own desk work in their current shift for this event
   * (since its start); null when they have no current shift. `replaced` counts band swaps, lost or
   * damaged; `resent` counts passes resent.
   */
  today: z
    .object({ /** Start of the shift counted (always sent by the server). */ since: IsoDateTime.optional(), bound: z.number().int().min(0), replaced: z.number().int().min(0), resent: z.number().int().min(0) })
    .nullable()
    .optional(),
});

export const RevokeRequest = z.object({ reason: z.string().min(3).max(500) });
export const ClearReviewRequest = z.object({
  /** `clear` returns the credential to active; `revoke` revokes it. */
  outcome: z.enum(["clear", "revoke"]),
  note: z.string().min(3).max(500),
});

export const CarrierImport = z.object({
  chip_profile: ChipProfile,
  /** Manufacturing serials / UIDs, hex. */
  identifiers: z.array(z.string().regex(/^[0-9A-Fa-f]{8,32}$/)).min(1).max(10_000),
});
export const CarrierImportResult = z.object({
  imported: z.number().int(),
  duplicates: z.number().int(),
  /** The identifiers (as sent) that were repeated in the list or are already present. Never fatal. */
  duplicate_identifiers: z.array(z.string()),
});

export const BindRequest = z.object({
  identifier: z.string().regex(/^[0-9A-Fa-f]{8,32}$/),
  registration_id: Id,
});
export const RebindRequest = z.object({
  /** New band identifier (a stock band). */
  identifier: z.string().regex(/^[0-9A-Fa-f]{8,32}$/),
  reason: z.string().min(3).max(500),
  /**
   * `lost` (default, 01 §5.3): the old band is marked lost, the credential is replaced by a new one and
   * the new band is bound to it — old emailed and portal codes stop working. `damaged`: the old band is
   * retired and the credential is kept.
   */
  disposition: z.enum(["lost", "damaged"]).default("lost"),
});

/** A one-time six-character code a desk clerk reads out so an attendee can bind a stock band themselves (01 §5.3, A5). */
export const DeskCodeRequest = z.object({ identifier: z.string().regex(/^[0-9A-Fa-f]{8,32}$/) });
export const DeskCode = z.object({ code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/), expires_at: IsoDateTime });
export type DeskCode = z.infer<typeof DeskCode>;

export const credentialEndpoints = {
  listCredentials: endpoint({ method: "GET", path: "/credentials", access: SUPERVISE, query: CredentialQuery, response: pageOf(Credential) }),
  /** Desk clerks (D-23): stock counts, and an event's only for an event of their current desk assignment. */
  inventory: endpoint({ method: "GET", path: "/credentials/inventory", access: DESK, query: z.object({ event_id: Id.optional() }), response: Inventory }),
  resend: endpoint({ method: "POST", path: "/credentials/:id/resend", access: DESK, mfa: true, audited: true, rateLimit: "resend", params: IdParam, response: Ok }),
  /** Supervisors (D-23) need a fresh second factor for revoke and clear-review; admins and organisers as before. */
  revoke: endpoint({ method: "POST", path: "/credentials/:id/revoke", access: SUPERVISE, audited: true, params: IdParam, body: RevokeRequest, response: Credential }),
  clearReview: endpoint({ method: "POST", path: "/credentials/:id/clear-review", access: SUPERVISE, audited: true, params: IdParam, body: ClearReviewRequest, response: Credential }),
  importCarriers: endpoint({ method: "POST", path: "/carriers/import", access: OPERATORS, audited: true, body: CarrierImport, response: CarrierImportResult }),
  bindCarrier: endpoint({ method: "POST", path: "/carriers/bind", access: ["admin", "organiser", "security_staff", "desk_clerk"], audited: true, body: BindRequest, response: Carrier }),
  rebindCarrier: endpoint({ method: "POST", path: "/carriers/:id/rebind", access: DESK, mfa: true, audited: true, params: IdParam, body: RebindRequest, response: Carrier }),
  /** Not in 02 §5: issues the desk code used by POST /me/credential/bind `via: desk_code`. Proposed addition. */
  deskCode: endpoint({ method: "POST", path: "/carriers/desk-code", access: ["admin", "organiser", "security_staff", "desk_clerk"], audited: true, body: DeskCodeRequest, response: DeskCode, status: 201 }),
} as const;
