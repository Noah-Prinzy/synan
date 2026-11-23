/** Attendee self-service (02 §5 "Attendee self-service"). */
import { z } from "zod";
import { Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { AttendeeTier, CarrierKind, CarrierState, CredentialState, NotificationKind, RegistrationState } from "../enums/index.js";
import { QR_PREFIX_PORTAL, QR_TEXT_LENGTH } from "../qr/index.js";
import { ATTENDEE, endpoint, type Access } from "./endpoint.js";
import { EventSession } from "./events.js";
import { StaffAssignment } from "./staff.js";

export const MeCredentialQuery = z.object({ event_id: Id.optional() });

export const MyCredential = z.object({
  event_id: Id,
  registration_id: Id,
  tier: AttendeeTier,
  state: CredentialState,
  carriers: z.array(z.object({ kind: CarrierKind, state: CarrierState, identifier_hint: z.string() })),
  /** Room ids this pass is permitted to enter now (resolved server-side). */
  permitted_room_ids: z.array(Id),
});
export type MyCredential = z.infer<typeof MyCredential>;

/**
 * One signed portal QR (D-12). `code` is the QR text: a compact Ed25519-signed code
 * (see `@synan/contracts/qr`), 125 characters.
 */
export const PortalCode = z.object({
  code: z.string().length(QR_TEXT_LENGTH.portal).startsWith(QR_PREFIX_PORTAL),
  not_before: IsoDateTime,
  expires_at: IsoDateTime,
});
export type PortalCode = z.infer<typeof PortalCode>;

export const PortalCodeBatch = z.object({
  /** `qr_kid` of the signing key (matches `SigningKey.qr_kid`). */
  kid: z.string().regex(/^[0-9a-f]{8}$/),
  /** Show codes[i] while not_before ≤ now < expires_at. */
  codes: z.array(PortalCode).min(1),
  /** Seconds each code is shown before the next takes over. */
  rotate_every_s: z.number().int().positive(),
  server_time: IsoDateTime,
});
export type PortalCodeBatch = z.infer<typeof PortalCodeBatch>;

/** The signed-in attendee's own registration for one event: the event page's "Your status" panel. */
export const MyRegistrationQuery = z.object({ event_id: Id });
export const MyRegistration = z.object({
  registration_id: Id,
  event_id: Id,
  tier: AttendeeTier,
  state: RegistrationState,
  /** First admission at this event; null until then. */
  checked_in_at: IsoDateTime.nullable(),
  checked_in: z.boolean(),
  zone_presence_consent: z.boolean(),
  /** State of the pass, or null if none is issued yet. */
  credential_state: CredentialState.nullable(),
});
export type MyRegistration = z.infer<typeof MyRegistration>;
/** `registration` is null when the attendee is not registered for this event (not an error). */
export const MyRegistrationResponse = z.object({ registration: MyRegistration.nullable() });
export type MyRegistrationResponse = z.infer<typeof MyRegistrationResponse>;

export const SelfBindRequest = z.object({
  event_id: Id,
  binding: z.discriminatedUnion("via", [
    z.object({ via: z.literal("nfc"), uid: z.string().regex(/^[0-9A-Fa-f]{8,32}$/) }),
    /** Six-character code read out by the desk clerk (01 §5.3). */
    z.object({ via: z.literal("desk_code"), code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/) }),
  ]),
});

export const Notification = z.object({
  id: Id,
  kind: NotificationKind,
  at: IsoDateTime,
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof Notification>;

export const DataRequestAccepted = z.object({ request_id: Id, state: z.enum(["queued"]) });

const STAFF_SELF: readonly Access[] = ["security_staff", "speaker", "crew"];

export const meEndpoints = {
  myCredential: endpoint({ method: "GET", path: "/me/credential", access: ATTENDEE, query: MeCredentialQuery, response: MyCredential }),
  bindMyCredential: endpoint({ method: "POST", path: "/me/credential/bind", access: ATTENDEE, rateLimit: "auth", body: SelfBindRequest, response: MyCredential }),
  myCodes: endpoint({ method: "GET", path: "/me/credential/codes", access: ATTENDEE, query: MeCredentialQuery, response: PortalCodeBatch }),
  /** Not in 02 §5: the attendee's own registration for one event. Proposed addition. */
  myRegistration: endpoint({ method: "GET", path: "/me/registration", access: ATTENDEE, query: MyRegistrationQuery, response: MyRegistrationResponse }),
  mySessions: endpoint({ method: "GET", path: "/me/sessions", access: ATTENDEE, response: z.object({ items: z.array(EventSession) }) }),
  myNotifications: endpoint({ method: "GET", path: "/me/notifications", access: ATTENDEE, response: z.object({ items: z.array(Notification) }) }),
  myAssignments: endpoint({ method: "GET", path: "/me/assignments", access: STAFF_SELF, response: z.object({ items: z.array(StaffAssignment) }) }),
  dataExport: endpoint({ method: "POST", path: "/me/data-export", access: ATTENDEE, rateLimit: "resend", response: DataRequestAccepted, status: 202 }),
  dataErasure: endpoint({ method: "POST", path: "/me/data-erasure", access: ATTENDEE, rateLimit: "resend", body: z.object({ confirm: z.literal(true) }), response: DataRequestAccepted, status: 202 }),
} as const;

/* ---- data-subject requests (03 §5): additions, not in 02 §5 (proposed) ---- */

export const DataRequestKind = z.enum(["export", "erasure"]);
export const DataRequestState = z.enum(["requested", "in_progress", "completed", "rejected"]);
export const DataRequestRow = z.object({
  id: Id,
  /** Operators see the attendee id only; never the identity in the queue. */
  attendee_id: Id,
  kind: DataRequestKind,
  state: DataRequestState,
  requested_at: IsoDateTime,
  completed_at: IsoDateTime.nullable(),
  note: z.string().nullable(),
});
export type DataRequestRow = z.infer<typeof DataRequestRow>;
/** The attendee's own export: identity, registrations, credential states. Movement data is never held under their identity. */
export const DataExport = z.object({ request_id: Id, generated_at: IsoDateTime, data: z.record(z.string(), z.unknown()) });

export const dataRequestEndpoints = {
  myDataRequests: endpoint({ method: "GET", path: "/me/data-requests", access: ATTENDEE, response: z.object({ items: z.array(DataRequestRow) }) }),
  myDataExport: endpoint({ method: "GET", path: "/me/data-export/:id", access: ATTENDEE, params: z.object({ id: Id }), response: DataExport }),
  listDataRequests: endpoint({
    method: "GET", path: "/data-requests", access: ["admin", "organiser"],
    query: PageQuery.extend({ state: DataRequestState.optional(), kind: DataRequestKind.optional() }), response: pageOf(DataRequestRow),
  }),
  /** Erasure: scrubs the identity (registrations and aggregates stay) and ends the attendee's sessions. Export: builds it now. */
  processDataRequest: endpoint({ method: "POST", path: "/data-requests/:id/process", access: ["admin"], mfa: true, audited: true, params: z.object({ id: Id }), response: DataRequestRow }),
  rejectDataRequest: endpoint({
    method: "POST", path: "/data-requests/:id/reject", access: ["admin"], mfa: true, audited: true,
    params: z.object({ id: Id }), body: z.object({ note: z.string().min(3).max(500) }), response: DataRequestRow,
  }),
} as const;
