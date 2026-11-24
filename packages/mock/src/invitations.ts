/**
 * Private Invitation (01 §4, 03 §2): the answers `POST /invitations/:token/rsvp` gives, over
 * fixtures the Attendee Portal reaches in development by obvious tokens (`/invite/<token>`).
 *
 * The answers mirror apps/api/src/routes/registration.ts exactly:
 * - unknown, already used, declined, withdrawn and wrong-address links all answer LINK_INVALID,
 *   so nothing about an invitation leaks to someone holding a forwarded link;
 * - past its reply-by date, or once the event is no longer open, LINK_EXPIRED (checked only after
 *   the address matches);
 * - already registered for the event, CONFLICT (the link is not spent);
 * - accepting or declining spends the link; accepting returns the PRIVATE_INVITE registration.
 *
 * `preview` is what `POST /invitations/read` shows before the reply (the event, who invited you,
 * the organiser contact, the event's questions); null for a link that read would refuse. The
 * `asApi` token keeps the old case of an open link with nothing to show.
 */
import type { ProfileField, Registration } from "@synan/contracts/rest";
import type { Clock } from "./clock";
import type { PortalStore } from "./portal";
import { idFor } from "./random";

/** Every demo invitation was sent to this address (the link is bound to it, 03 §2). */
export const DEMO_INVITED_EMAIL = "guest@example.com";

/** Tokens for each state. Any other token of 16+ characters is unknown (LINK_INVALID). */
export const DEMO_INVITATIONS = {
  /** Open, with the event's questions. */
  valid: "invite-demo-roundtable",
  /** Open, no questions: accepting asks only for the consent row. */
  simple: "invite-demo-no-questions",
  /** Open, but nothing to show before the reply: exactly what the real API gives today. */
  asApi: "invite-demo-as-api",
  /** Already accepted once. */
  used: "invite-demo-used",
  /** Withdrawn by the organiser. */
  revoked: "invite-demo-withdrawn",
  /** Past its reply-by date. */
  expired: "invite-demo-expired",
  /** The invited address is already registered for the event. */
  registered: "invite-demo-registered",
  /** The server fails (500). */
  failing: "invite-demo-server-error",
} as const;

type InvitationState = "sent" | "redeemed" | "revoked" | "expired";

interface Fixture {
  token: string;
  state: InvitationState;
  eventSlug: string;
  /** Offset from DEMO clock "now" at creation, in days (negative: already past). */
  expiresInDays: number;
  host: string | null;
  /** The organiser contact (contracts InvitationPreview.contact). */
  contact?: { name: string | null; email: string | null };
  preview: boolean;
  questions: boolean;
  alreadyRegistered?: boolean;
  fails?: boolean;
}

const EVENT = "sponsor-roundtable";
const HOST = "The Nexus Summit partnerships team";
const CONTACT = { name: "Partnerships team", email: "partners@nexus-summit.example" };

const fixtures: Fixture[] = [
  { token: DEMO_INVITATIONS.valid, state: "sent", eventSlug: EVENT, expiresInDays: 1, host: HOST, contact: CONTACT, preview: true, questions: true },
  { token: DEMO_INVITATIONS.simple, state: "sent", eventSlug: EVENT, expiresInDays: 1, host: null, preview: true, questions: false },
  { token: DEMO_INVITATIONS.asApi, state: "sent", eventSlug: EVENT, expiresInDays: 1, host: null, preview: false, questions: false },
  { token: DEMO_INVITATIONS.used, state: "redeemed", eventSlug: EVENT, expiresInDays: 1, host: HOST, contact: CONTACT, preview: true, questions: true },
  { token: DEMO_INVITATIONS.revoked, state: "revoked", eventSlug: EVENT, expiresInDays: 1, host: HOST, contact: CONTACT, preview: true, questions: true },
  { token: DEMO_INVITATIONS.expired, state: "sent", eventSlug: EVENT, expiresInDays: -1, host: HOST, contact: CONTACT, preview: true, questions: true },
  { token: DEMO_INVITATIONS.registered, state: "sent", eventSlug: EVENT, expiresInDays: 1, host: HOST, contact: CONTACT, preview: true, questions: false, alreadyRegistered: true },
  { token: DEMO_INVITATIONS.failing, state: "sent", eventSlug: EVENT, expiresInDays: 1, host: HOST, contact: CONTACT, preview: true, questions: false, fails: true },
];

/** NOT IN CONTRACTS: what a read of an invitation would show before the reply. */
export interface InvitationPreview {
  event: {
    slug: string;
    title: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    venue: string;
    city: string | null;
  };
  /** Who sent it, when the organiser named themselves. */
  host: string | null;
  /** Who to ask for a new invitation; null when the organiser set no contact. */
  contact: { name: string | null; email: string | null } | null;
  /** The reply-by time. */
  expires_at: string;
  /** The event's own questions (the profile schema of an unlisted event). */
  fields: ProfileField[];
}

/** The body of `POST /invitations/:token/rsvp` (contracts RsvpRequest). */
export interface RsvpBody {
  email: string;
  accept: boolean;
  full_name: string;
  profile: Record<string, string | boolean | string[]>;
  zone_presence_consent: boolean;
}

/** Codes are contracts' ErrorCode values. */
export type RsvpAnswer =
  | { ok: true; registration: Registration | null }
  | { ok: false; code: "LINK_INVALID" | "LINK_EXPIRED" | "CONFLICT" | "INTERNAL" };

export interface InvitationDesk {
  preview(token: string): InvitationPreview | null;
  rsvp(token: string, body: RsvpBody): RsvpAnswer;
  /** Every demo invitation back to its starting state. */
  reset(): void;
}

const DAY = 86_400_000;

/** In memory only: a reload starts every demo invitation afresh. */
export function createInvitationDesk({ clock, portal }: { clock: Clock; portal: PortalStore }): InvitationDesk {
  const createdAt = clock.now();
  let states = new Map<string, InvitationState>();

  const find = (token: string) => fixtures.find((fixture) => fixture.token === token);
  const stateOf = (fixture: Fixture) => states.get(fixture.token) ?? fixture.state;
  const expiresAt = (fixture: Fixture) => createdAt + fixture.expiresInDays * DAY;

  return {
    preview(token) {
      const fixture = find(token);
      if (!fixture || !fixture.preview || stateOf(fixture) !== "sent") return null;
      const event = portal.getEvent(fixture.eventSlug);
      if (!event) return null;
      const { detail } = event;
      return {
        event: {
          slug: detail.slug,
          title: detail.title,
          starts_at: detail.starts_at,
          ends_at: detail.ends_at,
          timezone: detail.timezone,
          venue: detail.venue.name,
          city: detail.venue.city ?? null,
        },
        host: fixture.host,
        contact: fixture.contact ?? null,
        expires_at: new Date(expiresAt(fixture)).toISOString(),
        fields: fixture.questions ? (portal.profile(fixture.eventSlug)?.fields ?? []) : [],
      };
    },

    rsvp(token, body) {
      const fixture = find(token);
      if (fixture?.fails) return { ok: false, code: "INTERNAL" };
      const state = fixture ? stateOf(fixture) : undefined;
      if (!fixture || state === "redeemed" || state === "revoked") return { ok: false, code: "LINK_INVALID" };
      if (body.email.trim().toLowerCase() !== DEMO_INVITED_EMAIL) return { ok: false, code: "LINK_INVALID" };
      const event = portal.getEvent(fixture.eventSlug);
      const open = event && (event.detail.state === "published" || event.detail.state === "live");
      if (state === "expired" || expiresAt(fixture) <= clock.now() || !event || !open) return { ok: false, code: "LINK_EXPIRED" };
      if (!body.accept) {
        states = new Map(states).set(fixture.token, "revoked");
        return { ok: true, registration: null };
      }
      if (fixture.alreadyRegistered) return { ok: false, code: "CONFLICT" };
      states = new Map(states).set(fixture.token, "redeemed");
      const now = new Date(clock.now()).toISOString();
      return {
        ok: true,
        registration: {
          id: idFor(`registration:invite:${fixture.token}`),
          event_id: event.detail.id,
          tier: "PRIVATE_INVITE",
          state: "confirmed",
          zone_presence_consent_at: body.zone_presence_consent ? now : null,
          created_at: now,
        },
      };
    },

    reset() {
      states = new Map();
    },
  };
}
