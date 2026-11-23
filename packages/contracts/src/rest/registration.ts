/** Registration and attendee endpoints (02 §5, 01 §4). */
import { z } from "zod";
import { Email, Id, IsoDateTime, Ok, pageOf, PageQuery, Slug } from "../common.js";
import { AttendeeTier, InvitationState, RegistrationState } from "../enums/index.js";
import { ErrorCode } from "../errors/index.js";
import { Carrier } from "./credentials.js";
import { endpoint, IdParam, OPERATORS, PUBLIC, type Access } from "./endpoint.js";

/** One refused item of a batch request (`index` into the request array). A batch never fails as a whole for one bad item. */
export const BatchItemRejection = z.object({ index: z.number().int().min(0), code: ErrorCode, message: z.string() });
export type BatchItemRejection = z.infer<typeof BatchItemRejection>;

export const ProfileValues = z.record(z.string(), z.union([z.string().max(2000), z.boolean(), z.array(z.string().max(200))]));

export const RegisterUserRequest = z.object({
  email: Email,
  full_name: z.string().min(1).max(200),
  /** Event the self-service registration is for (Ordinary tier only). */
  event_slug: Slug,
  profile: ProfileValues.default({}),
  /** Separate, unticked-by-default consent row (03 §5). */
  zone_presence_consent: z.boolean(),
});
export const RegisterUserAccepted = z.object({ accepted: z.literal(true), verification_sent: z.boolean() });

export const UpdateProfile = z.object({
  full_name: z.string().min(1).max(200).optional(),
  profile: ProfileValues.optional(),
});

export const Registration = z.object({
  id: Id,
  event_id: Id,
  /** Server-assigned. Never accepted from a client except via the audited tier endpoint. */
  tier: AttendeeTier,
  state: RegistrationState,
  zone_presence_consent_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});
export type Registration = z.infer<typeof Registration>;

/** Note: no `tier` field. Tier is decided by the path (self-service → ORDINARY, etc.). */
export const CreateRegistration = z
  .object({
    event_id: Id,
    profile: ProfileValues.default({}),
    zone_presence_consent: z.boolean(),
  })
  .strict();

export const RegistrationRow = Registration.extend({
  attendee: z.object({ id: Id, full_name: z.string().nullable(), email: z.string().nullable() }),
});

export const ChangeTier = z.object({ tier: AttendeeTier, reason: z.string().min(3).max(500) });

export const CreateInvitations = z.object({
  event_id: Id,
  emails: z.array(Email).min(1).max(500),
  expires_at: IsoDateTime.optional(),
});
export const InvitationRow = z.object({
  id: Id,
  event_id: Id,
  state: InvitationState,
  expires_at: IsoDateTime,
  redeemed_at: IsoDateTime.nullable(),
});
export const InvitationTokenParam = z.object({ token: z.string().min(16).max(512) });
export const RsvpRequest = z.object({
  /**
   * The address the invitation was sent to. The link is bound to a hash of it (03 §2): a forwarded
   * link is refused unless its holder also knows the invited address.
   */
  email: Email,
  accept: z.boolean(),
  full_name: z.string().min(1).max(200),
  profile: ProfileValues.default({}),
  zone_presence_consent: z.boolean(),
});

export const AttendeeRow = z.object({
  id: Id,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  registrations: z.number().int(),
});

/** Public tier at an on-site kiosk (01 §4, O-10): no personal data; the attendee is anonymous. */
export const KioskRegistrationRequest = z
  .object({
    event_id: Id,
    zone_presence_consent: z.boolean(),
    /** Optional basic band handed over at the kiosk (a stock band's UID, hex). */
    band_uid: z.string().regex(/^[0-9A-Fa-f]{8,32}$/).optional(),
  })
  .strict();
export const KioskRegistration = z.object({
  registration: Registration,
  /** Single-use signed QR to print or show (the emailed-QR format, 144 characters). */
  pass_code: z.string(),
  /** The band bound at the kiosk, when `band_uid` was given. */
  carrier: Carrier.nullable(),
});
export type KioskRegistration = z.infer<typeof KioskRegistration>;

const SELF_OR_OPS: readonly Access[] = ["attendee", "admin", "organiser"];

export const registrationEndpoints = {
  registerUser: endpoint({ method: "POST", path: "/users/register", access: PUBLIC, rateLimit: "auth", body: RegisterUserRequest, response: RegisterUserAccepted, status: 202 }),
  updateProfile: endpoint({ method: "PATCH", path: "/users/:id/profile", access: SELF_OR_OPS, params: IdParam, body: UpdateProfile, response: Ok }),
  createRegistration: endpoint({ method: "POST", path: "/registrations", access: ["attendee"], body: CreateRegistration, response: Registration, status: 201 }),
  eventRegistrations: endpoint({ method: "GET", path: "/events/:id/registrations", access: OPERATORS, params: IdParam, query: PageQuery.extend({ tier: AttendeeTier.optional() }), response: pageOf(RegistrationRow) }),
  changeTier: endpoint({ method: "PATCH", path: "/registrations/:id/tier", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: ChangeTier, response: Registration }),
  createInvitations: endpoint({ method: "POST", path: "/invitations", access: OPERATORS, audited: true, body: CreateInvitations, response: z.object({ items: z.array(InvitationRow), rejected: z.array(BatchItemRejection) }), status: 201 }),
  rsvp: endpoint({ method: "POST", path: "/invitations/:token/rsvp", access: PUBLIC, rateLimit: "auth", params: InvitationTokenParam, body: RsvpRequest, response: z.object({ registration: Registration.nullable() }) }),
  /** Not in 02 §5: Public-tier kiosk registration (O-10). Proposed addition. */
  kioskRegister: endpoint({ method: "POST", path: "/kiosk/registrations", access: ["admin", "organiser", "security_staff"], audited: true, body: KioskRegistrationRequest, response: KioskRegistration, status: 201 }),
  listAttendees: endpoint({ method: "GET", path: "/attendees", access: OPERATORS, query: PageQuery.extend({ q: z.string().max(100).optional(), event_id: Id.optional() }), response: pageOf(AttendeeRow) }),
} as const;
