/** Registration and attendee endpoints (02 §5, 01 §4). */
import { z } from "zod";
import { Email, Id, IsoDateTime, Ok, pageOf, PageQuery, Slug } from "../common.js";
import { AttendeeTier, InvitationState, RegistrationState } from "../enums/index.js";
import { endpoint, IdParam, OPERATORS, PUBLIC, type Access } from "./endpoint.js";

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

const SELF_OR_OPS: readonly Access[] = ["attendee", "admin", "organiser"];

export const registrationEndpoints = {
  registerUser: endpoint({ method: "POST", path: "/users/register", access: PUBLIC, rateLimit: "auth", body: RegisterUserRequest, response: RegisterUserAccepted, status: 202 }),
  updateProfile: endpoint({ method: "PATCH", path: "/users/:id/profile", access: SELF_OR_OPS, params: IdParam, body: UpdateProfile, response: Ok }),
  createRegistration: endpoint({ method: "POST", path: "/registrations", access: ["attendee"], body: CreateRegistration, response: Registration, status: 201 }),
  eventRegistrations: endpoint({ method: "GET", path: "/events/:id/registrations", access: OPERATORS, params: IdParam, query: PageQuery.extend({ tier: AttendeeTier.optional() }), response: pageOf(RegistrationRow) }),
  changeTier: endpoint({ method: "PATCH", path: "/registrations/:id/tier", access: OPERATORS, mfa: true, audited: true, params: IdParam, body: ChangeTier, response: Registration }),
  createInvitations: endpoint({ method: "POST", path: "/invitations", access: OPERATORS, audited: true, body: CreateInvitations, response: z.object({ items: z.array(InvitationRow) }), status: 201 }),
  rsvp: endpoint({ method: "POST", path: "/invitations/:token/rsvp", access: PUBLIC, rateLimit: "auth", params: InvitationTokenParam, body: RsvpRequest, response: z.object({ registration: Registration.nullable() }) }),
  listAttendees: endpoint({ method: "GET", path: "/attendees", access: OPERATORS, query: PageQuery.extend({ q: z.string().max(100).optional(), event_id: Id.optional() }), response: pageOf(AttendeeRow) }),
} as const;
