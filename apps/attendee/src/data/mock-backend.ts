/**
 * The mock data source: every answer comes from the in-process @synan/mock store (data/mock.ts),
 * in contract shapes, mapped to the screens' view models. This is the behaviour the portal has
 * always had; data/backend.ts selects it when VITE_API_URL is unset.
 */
import { DEMO_DESK_CODES, DEMO_INVITATIONS, DEMO_INVITED_EMAIL, delay, hint, type PortalCodeBatch, type PortalEvent } from "@synan/mock";
import type { Backend, BindResult, Profile, Session } from "./backend";
import type { AgendaSession } from "./agenda";
import type { EventDetail, EventSummary } from "./events";
import type { OccupancyView } from "./occupancy";
import type { Pass } from "./pass";
import { dayKey } from "./format";
import { applyDevParams, clock, invitations, portal, realtime } from "./mock";
import { displayState, hasBand, notifySession, toField, viewState } from "./shared";

/* ---------------------------------------------------------------- events (A1, A2) */

function summary(event: PortalEvent): EventSummary {
  const { detail, extras } = event;
  const capacity = event.detail.rooms.reduce((sum, room) => sum + room.capacity, 0);
  const admitted = detail.on_site ?? 0;
  return {
    id: detail.id,
    slug: detail.slug,
    title: detail.title,
    startsAt: detail.starts_at,
    endsAt: detail.ends_at,
    timezone: detail.timezone,
    venue: detail.venue.name,
    city: detail.venue.city ?? extras.city,
    state: viewState(detail.state),
    admitted,
    admittedShown: detail.on_site !== null,
    capacity,
    nearby: extras.nearby,
    image: extras.image ?? null,
    sessionCount: detail.sessions.length,
  };
}

/** A1: listed, published or live events, soonest first. */
function getEvents(): EventSummary[] {
  return portal
    .listEvents()
    .filter((event) => event.detail.state === "published" || event.detail.state === "live")
    .sort((a, b) => a.detail.starts_at.localeCompare(b.detail.starts_at))
    .map(summary);
}

/** A2: any event by slug, including unlisted ones reached by link. */
function getEventDetail(slug: string | undefined): EventDetail | null {
  const event = slug ? portal.getEvent(slug) : undefined;
  if (!event) return null;
  const { detail } = event;
  const rooms = new Map(detail.rooms.map((room) => [room.room_id, room]));
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: detail.timezone });
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: detail.timezone });
  const registration = portal.registration(detail.id);
  const membership = !registration ? "none" : registration.checked_in ? "checked_in" : "registered";

  return {
    ...summary(event),
    description: detail.description ?? "",
    membership: membership === "checked_in" ? "checked-in" : membership,
    closed: detail.state === "closed" || detail.state === "archived",
    sessions: [...detail.sessions]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((session) => {
        const room = rooms.get(session.room_id);
        return {
          id: session.id,
          day: day.format(new Date(session.starts_at)),
          roomId: session.room_id,
          room: room?.name ?? "",
          title: session.title,
          startsIso: session.starts_at,
          endsIso: session.ends_at,
          startsAt: time.format(new Date(session.starts_at)),
          endsAt: time.format(new Date(session.ends_at)),
          capacity: room?.capacity ?? 0,
        };
      }),
  };
}

/** GET /events/:id/occupancy in the public scope: the fixture's counts, present only while live. */
function getOccupancy(eventId: string): OccupancyView | null {
  const event = portal.world.events.find((item) => item.detail.id === eventId);
  if (!event) return null;
  const live = event.detail.state === "live";
  const rooms: OccupancyView["rooms"] = {};
  if (live) for (const room of portal.occupancy(eventId)) rooms[room.room_id] = { occupancy: room.occupancy, capacity: room.capacity };
  return { live, rooms, onSite: live ? event.detail.on_site : null, maxAgeS: 5 };
}

/* ---------------------------------------------------------------- session (A9) */

const STORAGE_KEY = "syn.session";
const MAGIC_PREFIX = "syn-magic-";

/** The mock keeps the phone with the session; the API holds it in the identity vault. */
type MockSession = Session & { phone?: string };

function readSession(): MockSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as MockSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: MockSession | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  notifySession();
}

/* ---------------------------------------------------------------- pass (A4) */

const CREDENTIAL_STATES = ["READY", "NOT YET BOUND", "UNDER REVIEW", "REVOKED", "REPLACED"] as const;

/** Set when the band is reported lost, cleared when a band is bound (the store keeps no such flag). */
const LOST_KEY = "synan.mock.band-lost";

function bandLostFlag(): boolean {
  try {
    return localStorage.getItem(LOST_KEY) === "1";
  } catch {
    return false;
  }
}

function setBandLost(lost: boolean): void {
  try {
    if (lost) localStorage.setItem(LOST_KEY, "1");
    else localStorage.removeItem(LOST_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * The attendee's pass. `preview` (from ?state=) forces a display state so every state can be
 * reviewed in the mock build.
 */
function getPass(preview: string | null): Pass {
  const credential = portal.credential();
  const event = portal.passEvent().detail;
  const uid = portal.bandUid();
  const forced = CREDENTIAL_STATES.find((item) => item === preview);
  return {
    // The name as edited on the Account screen (GET /me in the API), else the demo holder.
    holder: readSession()?.name || portal.holderName,
    tier: credential.tier,
    eventId: credential.event_id,
    event: {
      slug: event.slug,
      title: event.title,
      startsAt: event.starts_at,
      timezone: event.timezone,
      venue: event.venue.name,
    },
    state: forced ?? displayState(credential.state, hasBand(credential)),
    band: uid ? { uid, hint: hint(uid) } : null,
    bandLost: !uid && bandLostFlag(),
    nearestDesk: portal.nearestDesk,
  };
}

const CODES_KEY = "synan.pass.codes";

/**
 * GET /me/credential/codes: the next 15 minutes of signed codes (D-05, D-12). Each batch fetched
 * online is kept on the device, so a reload with no connection still has codes to rotate through
 * until they run out.
 */
function getCodes(): PortalCodeBatch {
  if (typeof navigator === "undefined" || navigator.onLine) {
    const batch = portal.codes();
    try {
      localStorage.setItem(CODES_KEY, JSON.stringify(batch));
    } catch {
      /* storage blocked: the batch lives for this page only */
    }
    return batch;
  }
  try {
    const saved = localStorage.getItem(CODES_KEY);
    if (saved) return JSON.parse(saved) as PortalCodeBatch;
  } catch {
    /* fall through */
  }
  return portal.codes();
}

function bind(binding: { via: "desk_code"; code: string } | { via: "nfc"; uid: string }): BindResult {
  const outcome = portal.bind(binding.via === "desk_code" ? { via: "desk_code", code: binding.code.trim().toUpperCase() } : binding);
  if (outcome.ok) {
    setBandLost(false);
    return { ok: true, band: { uid: outcome.uid } };
  }
  return { ok: false, reason: outcome.code === "CONFLICT" ? "already_bound" : "unknown_band" };
}

/* ---------------------------------------------------------------- agenda (A6) */

function mySessions(): AgendaSession[] {
  const event = portal.passEvent();
  const rooms = new Map(event.detail.rooms.map((room) => [room.room_id, room]));
  return portal.sessions().map((session) => ({
    id: session.id,
    eventId: event.detail.id,
    eventSlug: event.detail.slug,
    eventTitle: event.detail.title,
    timezone: event.detail.timezone,
    roomId: session.room_id,
    room: rooms.get(session.room_id)?.name ?? "",
    title: session.title,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    day: dayKey(session.starts_at, event.detail.timezone),
    capacity: rooms.get(session.room_id)?.capacity ?? 0,
  }));
}

/* ---------------------------------------------------------------- the source */

function profile(): Profile {
  const current = readSession();
  const digits = current?.phone?.replace(/\D/g, "") ?? "";
  return {
    name: current?.name || portal.holderName,
    email: current?.email ?? "",
    phoneMasked: digits ? `••••• ${digits.slice(-4)}` : null,
  };
}

export const mockBackend: Backend = {
  mode: "mock",
  applyDevParams(search) {
    if (new URLSearchParams(search).get("reset") === "1") setBandLost(false);
    applyDevParams(search);
  },

  now: () => clock.now(),
  subscribeClock: (listener) => clock.subscribe(listener),
  subscribe: (listener) => portal.subscribe(listener),
  version: () => portal.version(),

  getEvents,
  getEventDetail,
  getOccupancy,

  loadRegistration: (slug) => ({
    // Self-service registration is for listed, open events only.
    event: getEvents().find((event) => event.slug === slug),
    fields: portal.profile(slug)?.fields.map(toField) ?? [],
  }),
  isDuplicateEmail: (email) => portal.isRegisteredEmail(email),
  async submitRegistration(_slug, draft) {
    await delay(700);
    // Mock: an address containing "+fail@" simulates a server failure.
    if (!navigator.onLine) return { ok: false, reason: "offline" };
    if (draft.email.includes("+fail@")) return { ok: false, reason: "error" };
    return { ok: true };
  },
  emailedLinkFor: (email, next) => `/verify?token=${MAGIC_PREFIX}${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,

  readInvitation: (token) => {
    // POST /invitations/read: a used, declined, withdrawn or unknown link is refused at once, an
    // expired one says so. The as-API demo token keeps the case of an open link with nothing to show.
    const preview = invitations.preview(token);
    if (!preview) return token === DEMO_INVITATIONS.asApi ? { ok: true, preview: null } : { ok: false, reason: "invalid" };
    if (Date.parse(preview.expires_at) <= clock.now()) return { ok: false, reason: "expired" };
    const { event } = preview;
    return {
      ok: true,
      preview: {
        event: {
          title: event.title,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          timezone: event.timezone,
          venue: event.venue,
          city: event.city ?? "",
        },
        host: preview.host,
        contact: preview.contact,
        expiresAt: preview.expires_at,
        fields: preview.fields.map(toField),
      },
    };
  },
  async rsvp(token, reply) {
    await delay(700);
    if (!navigator.onLine) return { ok: false, reason: "offline" };
    const answer = invitations.rsvp(token, {
      email: reply.email,
      accept: reply.accept,
      full_name: reply.name,
      profile: reply.accept ? reply.answers : {},
      zone_presence_consent: reply.accept && reply.zoneConsent,
    });
    if (answer.ok) return { ok: true, reply: reply.accept ? "accepted" : "declined" };
    const reason = { LINK_INVALID: "invalid", LINK_EXPIRED: "expired", CONFLICT: "registered", INTERNAL: "error" } as const;
    return { ok: false, reason: reason[answer.code] };
  },
  devInvitedEmail: DEMO_INVITED_EMAIL,

  readSession,
  async requestSignInLink() {
    // The session starts only when the link is opened (/verify), never when it is requested.
    await delay(500);
  },
  async verifyLink(token, next) {
    // Mock token format: syn-magic-<email>; syn-expired-… is expired; anything else is invalid.
    if (token.startsWith(MAGIC_PREFIX)) {
      const email = decodeURIComponent(token.slice(MAGIC_PREFIX.length)).trim();
      writeSession({ email, name: portal.holderName });
      return { ok: true, next };
    }
    return { ok: false, problem: token.startsWith("syn-expired-") ? "expired" : "invalid" };
  },
  signOut: () => writeSession(null),

  loadProfile: profile,
  async updateProfile(change) {
    const current = readSession();
    if (!current) throw new Error("signed out");
    await delay(500);
    const name = change.name?.trim();
    const phone = change.phone?.trim();
    writeSession({ ...current, ...(name ? { name } : {}), ...(phone ? { phone } : {}) });
    return profile();
  },

  peekPass: (preview) => getPass(preview),
  loadPass: () => ({ pass: getPass(null) }),
  // The demo attendee holds one pass.
  passChoices() {
    const { detail } = portal.passEvent();
    return [{ eventId: detail.id, title: detail.title, startsAt: detail.starts_at, timezone: detail.timezone }];
  },
  selectPass() {},
  initialCodes: getCodes,
  getCodes,
  async emailPassCopy() {
    // POST /me/credential/resend in the real API.
    await delay(600);
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
  },
  async reportLostBand() {
    await delay(500);
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
    const had = portal.bandUid() !== null;
    if (had) setBandLost(true);
    portal.reportLostBand();
    return { markedLost: had };
  },
  watchPass: (onState) =>
    realtime.subscribe("/stream/me", (message) => {
      if (message.type === "pass.status") onState(message.data.state);
    }),
  boundBand() {
    const uid = portal.bandUid();
    return uid ? { uid, hint: hint(uid) } : null;
  },
  bindBand: bind,
  devCodeHint: DEMO_DESK_CODES.free,

  mySessions,

  loadNotifications: () => portal.notifications(),
  notifications: () => portal.notifications(),
  markAllRead: () => portal.markAllRead(),

  async requestDataExport() {
    await delay(500);
  },
  async requestErasure() {},
};
