/**
 * The network half of the API source: every call to the Synan API (docs/02 §5), through the
 * typed client in ./client, each answer validated against @synan/contracts. It carries Zod and
 * the contract schemas, so it is loaded on first use rather than with the pass (./backend).
 *
 * Where the screens need something the API does not serve, the gap is filled as narrowly as
 * possible and marked GAP (each one is listed for the backend in the hand-over report).
 */
import {
  authEndpoints,
  eventEndpoints,
  meEndpoints,
  occupancyEndpoints,
  registrationEndpoints,
  type EventDetail as ContractEventDetail,
  type EventSummary as ContractEventSummary,
  type Me,
  type MyCredential,
  type MyRegistrationItem,
  type PortalCodeBatch,
} from "@synan/contracts/rest";
import type { CredentialState as ContractCredentialState } from "@synan/contracts/enums";
import type { AgendaSession } from "../agenda";
import type { BindResult, LostOutcome, PassChoice, PassLoad, Profile, Session, SubmitOutcome, VerifyOutcome } from "../backend";
import type { EventDetail, EventSummary } from "../events";
import { ApiFailure, failureKind, isFailure } from "../failure";
import { failureCopy } from "../failure-copy";
import { dayKey } from "../format";
import type { OccupancyView } from "../occupancy";
import type { Pass } from "../pass";
import type { InvitationRead, RsvpOutcome, RsvpReply } from "../invitation";
import type { RegistrationDraft } from "../registration";
import { displayState, hasBand, notifySession, toField, viewState } from "../shared";
import { createApiClient } from "./client";
import type { StoredSession } from "./session";
import type { CoreState } from "./store";
import type { MeStream } from "./stream";

/** GAP: no desk location in the API; the FAQ's own wording. */
const NEAREST_DESK = "the nearest registration desk";
/** Public lists and event pages are reused across screens for this long. */
const PUBLIC_TTL_MS = 30_000;
/** GET /me and GET /me/registrations read moments ago (sign-in, then the pass) are not read again. */
const RECENT_MS = 15_000;

/** The answers worth sending: empty strings and empty selections are "not answered". */
function answered(answers: RegistrationDraft["answers"]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value) ? value.length > 0 : value.trim() !== "") out[key] = Array.isArray(value) ? value : value.trim();
  }
  return out;
}

/** "band ••1234" (MyCredential.carriers[].identifier_hint) → "••1234", as the pass shows a band. */
function bandHint(credential: MyCredential): string | null {
  const band = credential.carriers.find((carrier) => carrier.kind === "nfc" && (carrier.state === "bound" || carrier.state === "active"));
  return band ? band.identifier_hint.replace(/^band\s+/i, "") : null;
}

/** The passes worth offering: a registration that stands, with a pass issued. Soonest event first. */
function toChoices(items: MyRegistrationItem[]): PassChoice[] {
  return items
    .filter((item) => item.state !== "cancelled" && item.credential_state !== null)
    .map((item) => ({ eventId: item.event.id, title: item.event.title, startsAt: item.event.starts_at, timezone: item.event.timezone }))
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
}

function memo<T>(load: () => Promise<T>, ttl: number) {
  let entry: { at: number; value: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      if (!entry || Date.now() - entry.at > ttl) {
        const value = load();
        entry = { at: Date.now(), value };
        value.catch(() => {
          if (entry?.value === value) entry = null;
        });
      }
      return entry.value;
    },
    /** The next get() reads afresh (something changed it). */
    clear() {
      entry = null;
    },
  };
}

export type Remote = ReturnType<typeof createRemote>;

export function createRemote(state: CoreState) {
  const { session } = state;
  const client = createApiClient({
    baseUrl: state.origin,
    session,
    refresh: authEndpoints.refresh,
    onSignedOut: () => state.forgetPerson(),
  });

  /* ------------------------------------------------------------ public events */

  const publicEvents = memo(async () => {
    const items: ContractEventSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.call(eventEndpoints.listEvents, { query: { limit: 100, cursor } });
      items.push(...page.items);
      cursor = page.next_cursor ?? undefined;
    } while (cursor && items.length < 500);
    return items;
  }, PUBLIC_TTL_MS);

  const details = new Map<string, { get(): Promise<ContractEventDetail> }>();
  function eventDetail(slug: string): Promise<ContractEventDetail> {
    let entry = details.get(slug);
    if (!entry) {
      entry = memo(() => client.call(eventEndpoints.getEvent, { params: { slug } }), PUBLIC_TTL_MS);
      details.set(slug, entry);
    }
    return entry.get();
  }

  function toSummary(event: ContractEventSummary, detail?: ContractEventDetail): EventSummary {
    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      venue: event.venue.name,
      city: event.venue.city ?? "",
      state: viewState(event.state),
      admitted: event.on_site ?? 0,
      admittedShown: event.on_site !== null,
      capacity: event.capacity ?? (detail ? detail.rooms.reduce((sum, room) => sum + room.capacity, 0) : 0),
      // GAP: no proximity in the contract (undecided).
      nearby: false,
      image: event.image_url ?? null,
      sessionCount: event.session_count ?? detail?.sessions.length ?? 0,
    };
  }

  /* ------------------------------------------------------------ the person */

  /** GET /me. The name it gives is kept with the session, so the pass shows it offline too. */
  const meRead = memo(async (): Promise<Me> => {
    const me = await client.call(meEndpoints.me);
    const name = me.full_name?.trim();
    if (name && session.read()?.name !== name) session.setName(name);
    return me;
  }, RECENT_MS);
  const refreshMe = () => meRead.get();

  /** The name on the pass: GET /me's, else the last one this device knew; the address's local part only if neither exists. */
  function holderName(current: StoredSession): string {
    return current.name ?? current.email.split("@")[0] ?? current.email;
  }

  /** GET /me/registrations: every pass this person holds, unlisted events included. */
  const registrationsRead = memo(async (): Promise<MyRegistrationItem[]> => {
    const { items } = await client.call(meEndpoints.myRegistrations);
    state.setChoices(toChoices(items));
    return items;
  }, RECENT_MS);
  const refreshChoices = () => registrationsRead.get();

  /* ------------------------------------------------------------ the pass */

  /**
   * GET /me/credential: the event this person chose to show, else the API's current pass (live,
   * else next, else most recent). A choice that no longer holds (cancelled) is dropped.
   */
  async function myCredential(): Promise<MyCredential | null> {
    const wanted = state.chosen();
    if (wanted) {
      try {
        return await client.call(meEndpoints.myCredential, { query: { event_id: wanted } });
      } catch (error) {
        if (!isFailure(error, "NO_CREDENTIAL", "NOT_FOUND", "VALIDATION_FAILED")) throw error;
        state.choose(null);
      }
    }
    try {
      return await client.call(meEndpoints.myCredential, { query: {} });
    } catch (error) {
      if (isFailure(error, "NO_CREDENTIAL", "NOT_FOUND")) return null;
      throw error;
    }
  }

  function passFrom(credential: MyCredential): Pass {
    const current = session.read();
    const ref = credential.event;
    const known = state.knownPass(credential.event_id)?.event ?? null;
    const hint = bandHint(credential);
    return {
      holder: current ? holderName(current) : "",
      tier: credential.tier,
      eventId: credential.event_id,
      event: ref
        ? {
            slug: ref.slug,
            title: ref.title,
            startsAt: ref.starts_at ?? known?.startsAt ?? null,
            timezone: ref.timezone,
            venue: ref.venue_name ?? "",
          }
        : (known ?? { slug: "", title: "Your pass", startsAt: null, timezone: "UTC", venue: "" }),
      state: displayState(credential.state, hasBand(credential)),
      band: hint ? { uid: hint, hint } : null,
      bandLost: !hint && credential.carriers.some((carrier) => carrier.kind === "nfc" && carrier.state === "lost"),
      nearestDesk: NEAREST_DESK,
    };
  }

  /** The chosen pass still the one wanted when an answer arrives (a switch may have happened meanwhile). */
  const stillWanted = (eventId: string | null) => {
    const chosen = state.chosen();
    return chosen === null || chosen === eventId;
  };

  let loading: { wanted: string | null; promise: Promise<PassLoad> } | null = null;
  /** GET /me/credential, GET /me and GET /me/registrations together: the pass, its holder's name, and the switch. */
  function loadPass(): Promise<PassLoad> {
    const wanted = state.chosen();
    if (loading && loading.wanted === wanted) return loading.promise;
    const promise = (async (): Promise<PassLoad> => {
      if (!session.read()) return { pass: null };
      const [credential] = await Promise.all([
        myCredential(),
        refreshMe().catch(() => null),
        refreshChoices().catch(() => null),
      ]);
      if (!credential) {
        if (state.chosen() === null) state.setPass(null);
        return { pass: null };
      }
      const next = passFrom(credential);
      if (stillWanted(next.eventId)) {
        state.setPass(next);
        // Another pass is shown now: its ticket names its event, so the live feed follows it.
        if (stream && streamFor !== next.eventId) {
          closeStream();
          void openStream().catch(() => undefined);
        }
      }
      return { pass: next };
    })().finally(() => {
      if (loading?.promise === promise) loading = null;
    });
    loading = { wanted, promise };
    return promise;
  }

  async function passEventId(): Promise<string> {
    const eventId = state.pass()?.eventId ?? (await loadPass()).pass?.eventId;
    if (!eventId) throw new ApiFailure("NO_CREDENTIAL", 404);
    return eventId;
  }

  /* ------------------------------------------------------------ /stream/me */

  let stream: MeStream | null = null;
  /** The event the open stream's ticket was asked for. */
  let streamFor: string | undefined;
  let opening = false;
  const passWatchers = new Set<(credentialState: ContractCredentialState) => void>();
  const refreshQuietly = () => void loadPass().catch(() => undefined);

  async function openStream() {
    if (stream || opening) return;
    opening = true;
    const { openMeStream } = await import("./stream").finally(() => {
      opening = false;
    });
    if (stream || passWatchers.size === 0) return;
    streamFor = state.pass()?.eventId;
    stream = openMeStream({
      wsBase: state.origin.replace(/^http/, "ws"),
      ticket: () => client.call(authEndpoints.wsTicket, { body: { channel: "/stream/me", event_id: state.pass()?.eventId } }),
      onEvent: (event) => {
        if (event.type === "pass.status") {
          const current = state.pass();
          if (current && event.data.event_id === current.eventId) {
            state.setPass({ ...current, state: displayState(event.data.state, current.band !== null) });
          }
          for (const watcher of passWatchers) watcher(event.data.state);
        }
        // The band or the entitlements may have changed too (bound at the desk): re-read the pass.
        refreshQuietly();
      },
      onResync: refreshQuietly,
      onSignedOut: () => state.forgetPerson(),
    });
  }

  function watchPass(onState: (credentialState: ContractCredentialState) => void): () => void {
    passWatchers.add(onState);
    void openStream().catch(() => undefined);
    return () => {
      passWatchers.delete(onState);
      if (passWatchers.size === 0) closeStream();
    };
  }

  function closeStream() {
    stream?.close();
    stream = null;
  }

  async function bind(binding: { via: "desk_code"; code: string } | { via: "nfc"; uid: string }): Promise<BindResult> {
    try {
      const credential = await client.call(meEndpoints.bindMyCredential, { body: { event_id: await passEventId(), binding } });
      const next = passFrom(credential);
      state.setPass(next);
      // GAP: the API returns only a hint of the band (never its full UID).
      return { ok: true, band: { uid: next.band?.hint ?? "" } };
    } catch (error) {
      if (isFailure(error, "CONFLICT")) return { ok: false, reason: "already_bound" };
      if (isFailure(error, "VALIDATION_FAILED", "NOT_FOUND")) return { ok: false, reason: "unknown_band" };
      return { ok: false, reason: "failed", message: failureCopy(error).message };
    }
  }

  /* ------------------------------------------------------------ registration and sign-in */

  /** POST /registrations, signed in as the address registering. Answers with the event's id. */
  async function createRegistration(slug: string, profile: Record<string, string | string[]>, zoneConsent: boolean): Promise<string> {
    const event = (await publicEvents.get()).find((item) => item.slug === slug);
    if (!event) throw new ApiFailure("NOT_FOUND", 404);
    try {
      await client.call(registrationEndpoints.createRegistration, {
        body: { event_id: event.id, profile, zone_presence_consent: zoneConsent },
      });
    } catch (error) {
      // Already registered for this event: the pass exists, which is what was wanted.
      if (!isFailure(error, "CONFLICT")) throw error;
    }
    return event.id;
  }

  async function submitRegistration(slug: string, draft: RegistrationDraft, current: Session | null): Promise<SubmitOutcome> {
    const email = draft.email.trim();
    const profile = answered(draft.answers);
    const phone = draft.phone.trim();
    try {
      if (current && current.email.toLowerCase() === email.toLowerCase()) {
        const eventId = await createRegistration(slug, profile, draft.zoneConsent);
        registrationsRead.clear();
        // The phone the form collected goes on file too (best effort: the registration stands without it).
        if (phone) {
          await client.call(meEndpoints.updateMyProfile, { body: { phone } }).catch(() => undefined);
          meRead.clear();
        }
        // The pass just issued is the one to open.
        state.choose(eventId);
        refreshQuietly();
        return { ok: true };
      }
      // Everything in one call: the API keeps the answers with the emailed link, and opening that
      // link on any device completes the registration.
      await client.call(
        registrationEndpoints.registerUser,
        {
          body: {
            email,
            full_name: draft.name.trim(),
            event_slug: slug,
            profile,
            zone_presence_consent: draft.zoneConsent,
            ...(phone ? { phone } : {}),
          },
        },
        { auth: "none" },
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: failureKind(error) };
    }
  }

  /**
   * POST /invitations/read (public; the link's token in the body, no session sent). Unknown, used,
   * declined and withdrawn links answer LINK_INVALID alike; past the reply-by time, LINK_EXPIRED.
   */
  async function readInvitation(token: string): Promise<InvitationRead> {
    try {
      const read = await client.call(registrationEndpoints.readInvitation, { body: { token } }, { auth: "none" });
      return {
        ok: true,
        preview: {
          event: {
            title: read.event.title,
            startsAt: read.event.starts_at,
            endsAt: read.event.ends_at,
            timezone: read.event.timezone,
            venue: read.event.venue_name ?? "",
            city: read.event.city ?? "",
          },
          host: read.host,
          contact: read.contact,
          expiresAt: read.expires_at,
          fields: read.fields.map(toField),
        },
      };
    } catch (error) {
      if (isFailure(error, "LINK_INVALID", "VALIDATION_FAILED", "NOT_FOUND")) return { ok: false, reason: "invalid" };
      if (isFailure(error, "LINK_EXPIRED")) return { ok: false, reason: "expired" };
      throw error;
    }
  }

  /**
   * POST /invitations/rsvp (public; the token in the body, no session sent). The API answers
   * LINK_INVALID alike for an unknown, used, declined, withdrawn or wrong-address link, so those are
   * one outcome here.
   */
  async function rsvp(token: string, reply: RsvpReply): Promise<RsvpOutcome> {
    try {
      await client.call(
        registrationEndpoints.rsvpWithToken,
        {
          body: {
            token,
            email: reply.email,
            accept: reply.accept,
            // Declining sends nothing beyond what the API requires: no name, no answers.
            ...(reply.accept ? { full_name: reply.name } : {}),
            profile: reply.accept ? answered(reply.answers) : {},
            zone_presence_consent: reply.accept && reply.zoneConsent,
          },
        },
        { auth: "none" },
      );
      // A pass, and the name on file, may now be new for whoever is signed in.
      if (reply.accept) {
        registrationsRead.clear();
        meRead.clear();
      }
      return { ok: true, reply: reply.accept ? "accepted" : "declined" };
    } catch (error) {
      if (isFailure(error, "LINK_INVALID", "VALIDATION_FAILED", "NOT_FOUND")) return { ok: false, reason: "invalid" };
      if (isFailure(error, "LINK_EXPIRED")) return { ok: false, reason: "expired" };
      if (isFailure(error, "CONFLICT")) return { ok: false, reason: "registered" };
      if (isFailure(error, "RATE_LIMITED")) return { ok: false, reason: "limited" };
      return { ok: false, reason: failureKind(error) };
    }
  }

  async function verifyLink(token: string, next: string): Promise<VerifyOutcome> {
    let pair;
    try {
      pair = await client.call(authEndpoints.verify, { body: { token } }, { auth: "none" });
    } catch (error) {
      if (isFailure(error, "LINK_EXPIRED")) return { ok: false, problem: "expired" };
      if (isFailure(error, "LINK_INVALID", "VALIDATION_FAILED")) return { ok: false, problem: "invalid" };
      return { ok: false, problem: "unreachable" };
    }
    state.forgetPerson();
    meRead.clear();
    registrationsRead.clear();
    session.save(pair, null);
    notifySession();
    state.bump();

    // The link from POST /users/register returns to /events/:slug/register. Opening it completed
    // that registration on the server (on whichever device): land on its pass.
    const slug = /^\/events\/([a-z0-9-]+)\/register(?:[/?#]|$)/.exec(next)?.[1];
    const [items] = await Promise.all([
      refreshChoices().catch(() => null),
      // The name on file, so the screens greet the person by it from the start.
      refreshMe().catch(() => null),
    ]);
    if (slug) {
      const registration = items?.find((item) => item.event.slug === slug && item.state !== "cancelled");
      if (registration) {
        state.choose(registration.event.id);
        return { ok: true, next: "/pass" };
      }
      // Not completed (the event closed meanwhile, or the server could not be read): the form,
      // signed in now, finishes it with POST /registrations.
    }
    return { ok: true, next };
  }

  /* ------------------------------------------------------------ the calls the core forwards */

  return {
    loadPass,
    watchPass,
    closeStream,
    bindBand: bind,
    submitRegistration,
    verifyLink,
    readInvitation,
    rsvp,

    async getEvents(): Promise<EventSummary[]> {
      const events = (await publicEvents.get()).filter((event) => event.state === "published" || event.state === "live");
      return events.map((event) => toSummary(event)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },

    async getEventDetail(slug: string): Promise<EventDetail | null> {
      let detail: ContractEventDetail;
      try {
        detail = await eventDetail(slug);
      } catch (error) {
        if (isFailure(error, "NOT_FOUND", "VALIDATION_FAILED")) return null;
        throw error;
      }
      let membership: EventDetail["membership"] = "none";
      if (session.read()) {
        const mine = await client.call(meEndpoints.myRegistration, { query: { event_id: detail.id } }).catch(() => null);
        const registration = mine?.registration;
        if (registration && registration.state !== "cancelled") membership = registration.checked_in ? "checked-in" : "registered";
      }
      const rooms = new Map(detail.rooms.map((room) => [room.room_id, room]));
      const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: detail.timezone });
      const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: detail.timezone });
      return {
        ...toSummary(detail, detail),
        description: detail.description ?? "",
        membership,
        closed: detail.state === "closed" || detail.state === "archived",
        sessions: [...detail.sessions]
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          .map((item) => {
            const room = rooms.get(item.room_id);
            return {
              id: item.id,
              day: day.format(new Date(item.starts_at)),
              roomId: item.room_id,
              room: room?.name ?? "",
              title: item.title,
              startsIso: item.starts_at,
              endsIso: item.ends_at,
              startsAt: time.format(new Date(item.starts_at)),
              endsAt: time.format(new Date(item.ends_at)),
              capacity: room?.capacity ?? 0,
            };
          }),
      };
    },

    /** GET /events/:id/occupancy: public, k-anonymised; sent with the session when there is one (an unlisted event needs it). */
    async getOccupancy(eventId: string): Promise<OccupancyView | null> {
      try {
        const answer = await client.call(occupancyEndpoints.publicOccupancy, { params: { id: eventId } });
        return {
          live: answer.live,
          rooms: Object.fromEntries(answer.rooms.map((room) => [room.room_id, { occupancy: room.occupancy, capacity: room.capacity }])),
          onSite: answer.totals.on_site,
          maxAgeS: answer.max_age_s,
        };
      } catch (error) {
        if (isFailure(error, "NOT_FOUND", "VALIDATION_FAILED")) return null;
        throw error;
      }
    },

    async loadRegistration(slug: string) {
      const listed = (await publicEvents.get()).find((event) => event.slug === slug && (event.state === "published" || event.state === "live"));
      if (!listed) return { event: undefined, fields: [] };
      const schema = await client.call(eventEndpoints.profileSchema, { params: { slug } });
      return { event: toSummary(listed), fields: schema.fields.map(toField) };
    },

    async requestSignInLink(email: string, next: string) {
      await client.call(authEndpoints.emailLink, { body: { email, return_to: next } }, { auth: "none" });
    },

    async loadProfile(): Promise<Profile> {
      const current = session.read();
      if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
      const me = await refreshMe();
      return { name: me.full_name?.trim() || holderName(current), email: current.email, phoneMasked: me.phone_masked };
    },

    /** PATCH /me/profile: the name on every pass this device shows changes with it. */
    async updateProfile(change: { name?: string; phone?: string }): Promise<Profile> {
      const current = session.read();
      if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
      const name = change.name?.trim();
      const phone = change.phone?.trim();
      if (!name && !phone) return this.loadProfile();
      const me = await client.call(meEndpoints.updateMyProfile, {
        body: { ...(name ? { full_name: name } : {}), ...(phone ? { phone } : {}) },
      });
      meRead.clear();
      const saved = me.full_name?.trim();
      if (saved) {
        session.setName(saved);
        const pass = state.pass();
        if (pass) state.setPass({ ...pass, holder: saved });
      }
      return { name: saved || holderName(current), email: current.email, phoneMasked: me.phone_masked };
    },

    /** POST /me/credential/report-lost for the pass shown now. */
    async reportLostBand(): Promise<LostOutcome> {
      const result = await client.call(meEndpoints.reportLostBand, { body: { event_id: await passEventId() } });
      state.setPass(passFrom(result.credential));
      return { markedLost: result.marked_lost };
    },

    /**
     * POST /auth/logout for a session already removed from the device: ends its family on the
     * server, so its refresh token and any WebSocket ticket stop working.
     */
    async logout(ending: StoredSession) {
      let token = ending.access_token;
      if (Date.parse(ending.access_expires_at) - 30_000 <= Date.now()) {
        const pair = await client.call(authEndpoints.refresh, { body: { refresh_token: ending.refresh_token } }, { auth: "none" });
        token = pair.access_token;
      }
      await client.call(authEndpoints.logout, {}, { token });
    },

    async getCodes(): Promise<PortalCodeBatch> {
      const eventId = await passEventId();
      const batch = await client.call(meEndpoints.myCodes, { query: { event_id: eventId } });
      state.keepCodes(batch, Date.parse(batch.server_time) - Date.now(), eventId);
      return batch;
    },

    async emailPassCopy() {
      await client.call(meEndpoints.resendMyCredential, { body: { event_id: await passEventId() } });
    },

    /** GET /me/sessions: each item names its event and room, so nothing else is fetched. */
    async mySessions(): Promise<AgendaSession[]> {
      const { items } = await client.call(meEndpoints.mySessions);
      return items
        .map((item) => {
          const timezone = item.event_timezone ?? "UTC";
          return {
            id: item.id,
            eventId: item.event_id,
            eventSlug: item.event_slug ?? "",
            eventTitle: item.event_title ?? "",
            timezone,
            roomId: item.room_id,
            room: item.room_name ?? "",
            title: item.title,
            startsAt: item.starts_at,
            endsAt: item.ends_at,
            day: dayKey(item.starts_at, timezone),
            capacity: item.room_capacity ?? 0,
          };
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },

    async loadNotifications() {
      const { items } = await client.call(meEndpoints.myNotifications);
      state.setNotifications(items);
      return items;
    },

    async markRead(ids: string[]) {
      for (let i = 0; i < ids.length; i += 200) {
        await client.call(meEndpoints.markNotificationsRead, { body: { ids: ids.slice(i, i + 200) } });
      }
    },

    async requestDataExport() {
      await client.call(meEndpoints.dataExport);
    },

    async requestErasure() {
      await client.call(meEndpoints.dataErasure, { body: { confirm: true } });
    },
  };
}
