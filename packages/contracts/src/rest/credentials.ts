/** Credentials and carriers (02 §5, 01 §5). */
import { z } from "zod";
import { Id, IsoDateTime, Ok, pageOf, PageQuery, ZoneState } from "../common.js";
import { AttendeeTier, CarrierKind, CarrierState, ChipProfile, CredentialState } from "../enums/index.js";
import { endpoint, IdParam, OPERATORS } from "./endpoint.js";

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
export const CarrierImportResult = z.object({ imported: z.number().int(), duplicates: z.number().int() });

export const BindRequest = z.object({
  identifier: z.string().regex(/^[0-9A-Fa-f]{8,32}$/),
  registration_id: Id,
});
export const RebindRequest = z.object({
  /** New band identifier. The old carrier is marked lost. */
  identifier: z.string().regex(/^[0-9A-Fa-f]{8,32}$/),
  reason: z.string().min(3).max(500),
});

export const credentialEndpoints = {
  listCredentials: endpoint({ method: "GET", path: "/credentials", access: OPERATORS, query: CredentialQuery, response: pageOf(Credential) }),
  inventory: endpoint({ method: "GET", path: "/credentials/inventory", access: OPERATORS, query: z.object({ event_id: Id.optional() }), response: Inventory }),
  resend: endpoint({ method: "POST", path: "/credentials/:id/resend", access: OPERATORS, mfa: true, audited: true, rateLimit: "resend", params: IdParam, response: Ok }),
  revoke: endpoint({ method: "POST", path: "/credentials/:id/revoke", access: OPERATORS, audited: true, params: IdParam, body: RevokeRequest, response: Credential }),
  clearReview: endpoint({ method: "POST", path: "/credentials/:id/clear-review", access: OPERATORS, audited: true, params: IdParam, body: ClearReviewRequest, response: Credential }),
  importCarriers: endpoint({ method: "POST", path: "/carriers/import", access: OPERATORS, audited: true, body: CarrierImport, response: CarrierImportResult }),
  bindCarrier: endpoint({ method: "POST", path: "/carriers/bind", access: ["admin", "organiser", "security_staff"], audited: true, body: BindRequest, response: Carrier }),
  rebindCarrier: endpoint({ method: "POST", path: "/carriers/:id/rebind", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: RebindRequest, response: Carrier }),
} as const;
