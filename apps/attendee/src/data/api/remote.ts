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
  registrationEndpoints,
  type EventDetail as ContractEventDetail,
  type EventSummary as ContractEventSummary,
  type MyCredential,
  type PortalCodeBatch,
} from "@synan/contracts/rest";
import type { CredentialState as ContractCredentialState } from "@synan/contracts/enums";
import type { AgendaSession } from "../agenda";
import type { BindResult, PassLoad, Session, SubmitOutcome, VerifyOutcome } from "../backend";
import type { EventDetail, EventSummary } from "../events";
import { ApiFailure, failureKind, isFailure } from "../failure";
import { failureCopy } from "../failure-copy";
import { dayKey } from "../format";
import type { Pass } from "../pass";
import type { RegistrationDraft } from "../registration";
import { displayState, hasBand, notifySession, toField, viewState } from "../shared";
import { createApiClient } from "./client";
import type { StoredSession } from "./session";
import { PENDING_KEY, readJson, writeJson, type CoreState, type Pending } from "./store";
import type { MeStream } from "./stream";

/** GAP: no desk location in the API; the FAQ's own wording. */
const NEAREST_DESK = "the nearest registration desk";
/** Public lists and event pages are reused across screens for this long. */
const PUBLIC_TTL_MS = 30_000;

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
      // GAP: EventSummary has no capacity or session count; they come from each event's page.
      capacity: detail ? detail.rooms.reduce((sum, room) => sum + room.capacity, 0) : 0,
      // GAP: no proximity (undecided) and no image URL in the contract.
      nearby: false,
      image: null,
      sessionCount: detail ? detail.sessions.length : 0,
    };
  }

  /* ------------------------------------------------------------ the pass */

  /** GET /me/credential. With several passes the API needs an event id, and no endpoint lists them (GAP). */
  async function myCredential(): Promise<MyCredential | null> {
    try {
      return await client.call(meEndpoints.myCredential, { query: {} });
    } catch (error) {
      if (isFailure(error, "NO_CREDENTIAL")) return null;
      if (!isFailure(error, "VALIDATION_FAILED")) throw error;
    }
    // Several passes: try the events this person could hold one for, live and soonest first.
    const [events, sessions] = await Promise.all([
      publicEvents.get().catch(() => [] as ContractEventSummary[]),
      client.call(meEndpoints.mySessions).then((r) => r.items, () => []),
    ]);
    const now = Date.now();
    const ranked = events
      .filter((event) => Date.parse(event.ends_at) > now)
      .sort((a, b) => (a.state === "live" ? -1 : 0) - (b.state === "live" ? -1 : 0) || a.starts_at.localeCompare(b.starts_at))
      .map((event) => event.id);
    const ids = [...new Set([...sessions.map((s) => s.event_id), ...ranked, ...events.map((event) => event.id)])];
    for (const eventId of ids) {
      try {
        return await client.call(meEndpoints.myCredential, { query: { event_id: eventId } });
      } catch (error) {
        if (!isFailure(error, "NO_CREDENTIAL", "NOT_FOUND")) throw error;
      }
    }
    return null;
  }

  function holderName(current: StoredSession): string {
    // GAP: no GET /me, so the name is what this device knows; else the address before the @.
    return current.name ?? current.email.split("@")[0] ?? current.email;
  }

  async function passFrom(credential: MyCredential): Promise<Pass> {
    const current = session.read();
    const events = await publicEvents.get().catch(() => [] as ContractEventSummary[]);
    const event = events.find((item) => item.id === credential.event_id);
    const previous = state.pass();
    const known = previous && previous.eventId === credential.event_id ? previous.event : null;
    const hint = bandHint(credential);
    return {
      holder: current ? holderName(current) : "",
      tier: credential.tier,
      eventId: credential.event_id,
      // GAP: an unlisted event (Private Invitation) cannot be looked up by id.
      event: event
        ? { slug: event.slug, title: event.title, startsAt: event.starts_at, timezone: event.timezone, venue: event.venue.name }
        : (known ?? { slug: "", title: "Your pass", startsAt: new Date().toISOString(), timezone: "UTC", venue: "" }),
      state: displayState(credential.state, hasBand(credential)),
      band: hint ? { uid: hint, hint } : null,
      nearestDesk: NEAREST_DESK,
    };
  }

  let loadingPass: Promise<PassLoad> | null = null;
  function loadPass(): Promise<PassLoad> {
    loadingPass ??= (async (): Promise<PassLoad> => {
      if (!session.read()) return { pass: null };
      const credential = await myCredential();
      if (!credential) {
        state.setPass(null);
        return { pass: null };
      }
      const next = await passFrom(credential);
      state.setPass(next);
      return { pass: next };
    })().finally(() => {
      loadingPass = null;
    });
    return loadingPass;
  }

  async function passEventId(): Promise<string> {
    const eventId = state.pass()?.eventId ?? (await loadPass()).pass?.eventId;
    if (!eventId) throw new ApiFailure("NO_CREDENTIAL", 404);
    return eventId;
  }

  /* ------------------------------------------------------------ /stream/me */

  let stream: MeStream | null = null;
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
      const next = await passFrom(credential);
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

  async function createRegistration(slug: string, profile: Pending["profile"], zoneConsent: boolean): Promise<void> {
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
    refreshQuietly();
  }

  async function submitRegistration(slug: string, draft: RegistrationDraft, current: Session | null): Promise<SubmitOutcome> {
    const email = draft.email.trim();
    const profile = answered(draft.answers);
    // GAP: RegisterUserRequest has no phone field, so the optional phone is not sent.
    try {
      if (current && current.email.toLowerCase() === email.toLowerCase()) {
        await createRegistration(slug, profile, draft.zoneConsent);
        return { ok: true };
      }
      await client.call(
        registrationEndpoints.registerUser,
        { body: { email, full_name: draft.name.trim(), event_slug: slug, profile, zone_presence_consent: draft.zoneConsent } },
        { auth: "none" },
      );
      // The emailed link only proves the address; the registration itself is created after it is
      // opened (POST /registrations). Keep the answers for that step on this device.
      writeJson(PENDING_KEY, { slug, email, name: draft.name.trim(), profile, zoneConsent: draft.zoneConsent, at: Date.now() } satisfies Pending);
      return { ok: true };
    } catch (error) {
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
    const pending = readJson<Pending>(PENDING_KEY);
    const email = pair.principal.email?.toLowerCase();
    const theirs = pending && email && pending.email.toLowerCase() === email ? pending : null;
    session.save(pair, theirs?.name ?? null);
    notifySession();
    state.bump();

    // The link from POST /users/register returns to /events/:slug/register: finish that registration.
    const slug = /^\/events\/([a-z0-9-]+)\/register(?:[/?#]|$)/.exec(next)?.[1];
    if (slug && theirs && theirs.slug === slug) {
      try {
        await createRegistration(slug, theirs.profile, theirs.zoneConsent);
        writeJson(PENDING_KEY, null);
        return { ok: true, next: "/pass" };
      } catch {
        // Signed in; the form finishes it (it sends POST /registrations when signed in as that address).
        return { ok: true, next };
      }
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

    async getEvents(): Promise<EventSummary[]> {
      const events = (await publicEvents.get()).filter((event) => event.state === "published" || event.state === "live");
      const withDetail = await Promise.all(
        events.map(async (event) => toSummary(event, await eventDetail(event.slug).catch(() => undefined))),
      );
      return withDetail.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
              room: room?.name ?? "",
              title: item.title,
              startsIso: item.starts_at,
              endsIso: item.ends_at,
              startsAt: time.format(new Date(item.starts_at)),
              endsAt: time.format(new Date(item.ends_at)),
              // GAP: live room counts need /stream/telemetry (public scope), not wired here.
              occupancy: 0,
              capacity: room?.capacity ?? 0,
            };
          }),
      };
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

    async updateName(name: string) {
      const current = session.read();
      if (!current) throw new ApiFailure("UNAUTHENTICATED", 401);
      // GAP: relies on Principal.sub being the attendee id (the contract calls it opaque).
      await client.call(registrationEndpoints.updateProfile, { params: { id: current.sub }, body: { full_name: name } });
      session.setName(name);
      const pass = state.pass();
      if (pass) state.setPass({ ...pass, holder: name });
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

    async mySessions(): Promise<AgendaSession[]> {
      const { items } = await client.call(meEndpoints.mySessions);
      const events = await publicEvents.get().catch(() => [] as ContractEventSummary[]);
      const byId = new Map(events.map((event) => [event.id, event]));
      const rooms = new Map<string, Map<string, { name: string; capacity: number }>>();
      await Promise.all(
        [...new Set(items.map((item) => item.event_id))].map(async (eventId) => {
          const event = byId.get(eventId);
          const detail = event ? await eventDetail(event.slug).catch(() => null) : null;
          rooms.set(eventId, new Map((detail?.rooms ?? []).map((room) => [room.room_id, { name: room.name, capacity: room.capacity }])));
        }),
      );
      return items
        .map((item) => {
          // GAP: an unlisted event's sessions cannot be named or linked (no lookup by event id).
          const event = byId.get(item.event_id);
          const timezone = event?.timezone ?? "UTC";
          const room = rooms.get(item.event_id)?.get(item.room_id);
          return {
            id: item.id,
            eventSlug: event?.slug ?? "",
            eventTitle: event?.title ?? "",
            timezone,
            room: room?.name ?? "",
            title: item.title,
            startsAt: item.starts_at,
            endsAt: item.ends_at,
            day: dayKey(item.starts_at, timezone),
            capacity: room?.capacity ?? 0,
            // GAP: live room counts need /stream/telemetry; null reads "Not open yet".
            admitted: null,
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
