/**
 * A10: a Private Invitation link (01 §4, 03 §2). The link carries a high-entropy, single-use token
 * bound to a hash of the invited address. `POST /invitations/read` shows the invitation before the
 * reply (the event, who invites, the reply-by time, the event's questions; never the address);
 * the reply is `POST /invitations/rsvp`, both with the token in the body. Replying needs that
 * address; accepting also a name (it becomes the name on the pass), the answers and the separate
 * zone-presence consent. Declining needs no name.
 *
 * What the API answers, and so what the screen can know:
 * - LINK_INVALID for an unknown, already used, declined, withdrawn or wrong-address link alike,
 *   so the screen cannot tell those apart (by design: nothing leaks to a forwarded link);
 * - LINK_EXPIRED past the reply-by date or once the event is no longer open;
 * - CONFLICT when the address is already registered for the event (the link is not spent).
 *
 * The one thing this device can know is that it already replied: that is kept here (by a
 * fingerprint of the token, never the token itself), so reopening a spent link says so plainly.
 */
import { backend } from "./backend";
import { emptyDraft, validateIdentity, type ProfileField } from "./registration";
import { INVITATION_REPLIES_KEY as REPLIES_KEY } from "./shared";

export type InvitationPreview = {
  /** Dates are null only for an event that has none yet. */
  event: { title: string; startsAt: string | null; endsAt: string | null; timezone: string; venue: string; city: string };
  /** Who sent it, when the organiser named themselves. */
  host: string | null;
  /** The organiser contact for the event, when one was set: who to ask for a new invitation. */
  contact: { name: string | null; email: string | null } | null;
  /** The reply-by time. */
  expiresAt: string;
  /** The event's own questions. */
  fields: ProfileField[];
};

export type RsvpReply = {
  accept: boolean;
  email: string;
  /** Sent only when accepting. */
  name: string;
  answers: Record<string, string | string[]>;
  zoneConsent: boolean;
};

export type RsvpOutcome =
  | { ok: true; reply: "accepted" | "declined" }
  | {
      ok: false;
      /**
       * `invalid` unknown, used, declined, withdrawn or another address (LINK_INVALID);
       * `expired` LINK_EXPIRED; `registered` already registered (CONFLICT); `limited` RATE_LIMITED.
       */
      reason: "invalid" | "expired" | "registered" | "limited" | "offline" | "error";
    };

/** The token's shape (contracts InvitationTokenParam: 16–512 characters; the API mints base64url). */
export function isWellFormedToken(token: string | null): token is string {
  return token !== null && /^[A-Za-z0-9_-]{16,512}$/.test(token);
}

/**
 * POST /invitations/read. `preview` null: an open link whose details the source cannot show (a mock
 * demo token kept for that case); the screen then stands on the reply alone.
 */
export type InvitationRead = { ok: true; preview: InvitationPreview | null } | { ok: false; reason: "invalid" | "expired" };

export function readInvitation(token: string): InvitationRead | Promise<InvitationRead> {
  return backend.readInvitation(token);
}

/** POST /invitations/rsvp. A success is remembered on this device. */
export async function sendReply(token: string, reply: RsvpReply, eventTitle: string | null): Promise<RsvpOutcome> {
  const outcome = await backend.rsvp(token, { ...reply, email: reply.email.trim(), name: reply.name.trim() });
  if (outcome.ok) remember(token, { reply: outcome.reply, email: reply.email.trim(), title: eventTitle, at: Date.now() });
  return outcome;
}

/** Mock build only: the address the demo invitations were sent to. */
export function devInvitedEmail(): string | null {
  return backend.devInvitedEmail;
}

/** The invited address (every reply), and a name (accepting only: it goes on the pass). */
export function validateReply(email: string, name: string, accept = true): Partial<Record<"email" | "name", string>> {
  const found = validateIdentity({ ...emptyDraft(), email, name });
  const errors: Partial<Record<"email" | "name", string>> = {};
  if (email.trim() === "") errors.email = "Enter the address your invitation was sent to.";
  else if (found.email) errors.email = found.email;
  if (accept && found.name) errors.name = found.name;
  return errors;
}

/* ---------------------------------------------------------------- this device's replies */

export type Replied = { reply: "accepted" | "declined"; email: string; title: string | null; at: number };

/** A short, stable fingerprint: enough to recognise a link on this device, useless as the link. */
export function fingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + token.length.toString(36);
}

function readReplies(): Record<string, Replied> {
  try {
    const raw = localStorage.getItem(REPLIES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Replied>) : {};
  } catch {
    return {};
  }
}

function remember(token: string, replied: Replied): void {
  try {
    localStorage.setItem(REPLIES_KEY, JSON.stringify({ ...readReplies(), [fingerprint(token)]: replied }));
  } catch {
    // Storage blocked: the server still refuses a second reply; the screen just can't say why.
  }
}

/** This device's reply to this link, if it sent one. */
export function repliedBefore(token: string): Replied | null {
  return readReplies()[fingerprint(token)] ?? null;
}
