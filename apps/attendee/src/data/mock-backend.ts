/**
 * The mock data source: every answer comes from the in-process @synan/mock store (data/mock.ts),
 * in contract shapes, mapped to the screens' view models. This is the behaviour the portal has
 * always had; data/backend.ts selects it when VITE_API_URL is unset.
 */
import { DEMO_DESK_CODES, delay, hint, type PortalCodeBatch, type PortalEvent } from "@synan/mock";
import type { Backend, BindResult, Session } from "./backend";
import type { AgendaSession } from "./agenda";
import type { EventDetail, EventSummary } from "./events";
import type { Pass } from "./pass";
import { dayKey } from "./format";
import { applyDevParams, clock, portal, realtime } from "./mock";
import { displayState, hasBand, notifySession, toField, viewState } from "./shared";

/* ---------------------------------------------------------------- events (A1, A2) */

function summary(event: PortalEvent): EventSummary {
  const { detail, extras } = event;
  const capacity = event.detail.rooms.reduce((sum, room) => sum + room.capacity, 0);
  const admitted = detail.on_site ?? 0;
  return {
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
  const live = new Map(portal.occupancy(detail.id).map((room) => [room.room_id, room]));
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
          room: room?.name ?? "",
          title: session.title,
          startsIso: session.starts_at,
          endsIso: session.ends_at,
          startsAt: time.format(new Date(session.starts_at)),
          endsAt: time.format(new Date(session.ends_at)),
          occupancy: live.get(session.room_id)?.occupancy ?? 0,
          capacity: room?.capacity ?? 0,
        };
      }),
  };
}

/* ---------------------------------------------------------------- session (A9) */

const STORAGE_KEY = "syn.session";
const MAGIC_PREFIX = "syn-magic-";

function readSession(): Session | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  notifySession();
}

/* ---------------------------------------------------------------- pass (A4) */

const CREDENTIAL_STATES = ["READY", "NOT YET BOUND", "UNDER REVIEW", "REVOKED", "REPLACED"] as const;

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
    holder: portal.holderName,
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
  if (outcome.ok) return { ok: true, band: { uid: outcome.uid } };
  return { ok: false, reason: outcome.code === "CONFLICT" ? "already_bound" : "unknown_band" };
}

/* ---------------------------------------------------------------- agenda (A6) */

function mySessions(): AgendaSession[] {
  const event = portal.passEvent();
  const rooms = new Map(event.detail.rooms.map((room) => [room.room_id, room]));
  const live = new Map(portal.occupancy(event.detail.id).map((room) => [room.room_id, room]));
  return portal.sessions().map((session) => ({
    id: session.id,
    eventSlug: event.detail.slug,
    eventTitle: event.detail.title,
    timezone: event.detail.timezone,
    room: rooms.get(session.room_id)?.name ?? "",
    title: session.title,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    day: dayKey(session.starts_at, event.detail.timezone),
    capacity: rooms.get(session.room_id)?.capacity ?? 0,
    admitted: live.get(session.room_id)?.occupancy ?? null,
  }));
}

/* ---------------------------------------------------------------- the source */

export const mockBackend: Backend = {
  mode: "mock",
  applyDevParams,

  now: () => clock.now(),
  subscribeClock: (listener) => clock.subscribe(listener),
  subscribe: (listener) => portal.subscribe(listener),
  version: () => portal.version(),

  getEvents,
  getEventDetail,

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
  async updateName(name) {
    const current = readSession();
    if (!current) throw new Error("signed out");
    await delay(500);
    writeSession({ ...current, name: name.trim() });
  },
  signOut: () => writeSession(null),

  peekPass: (preview) => getPass(preview),
  loadPass: () => ({ pass: getPass(null) }),
  initialCodes: getCodes,
  getCodes,
  async emailPassCopy() {
    // POST /me/credential/resend in the real API.
    await delay(600);
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
  },
  async reportLostBand() {
    portal.reportLostBand();
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
