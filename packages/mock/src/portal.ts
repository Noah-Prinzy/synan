/**
 * The Attendee Portal's mock backend: the answers the REST endpoints in docs/02 §5
 * will give, in contract shapes, over an in-memory store that persists the
 * attendee's own changes (band binding, read state) to the given storage.
 *
 * Synchronous on purpose for now; `delay()` gives screens a realistic latency to
 * design loading states against. MSW handlers built from `@synan/contracts/rest`
 * replace this transport later without changing what screens receive.
 */
import type { Clock } from "./clock";
import { codeBatch } from "./codes";
import {
  DEMO_DESK,
  DEMO_EVENT_SLUG,
  DEMO_HOLDER,
  demoCredential,
  demoNotifications,
  deskBands,
  registeredEmails,
} from "./fixtures/attendee";
import { buildPortalWorld } from "./fixtures/portal";
import type {
  CredentialState,
  EventSession,
  Membership,
  MyCredential,
  MyRegistration,
  Notification,
  PortalCodeBatch,
  PortalEvent,
  PortalWorld,
  RoomOccupancy,
} from "./types";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Binding = { via: "desk_code"; code: string } | { via: "nfc"; uid: string };

/** Error codes are contracts' ErrorCode values. */
export type BindOutcome =
  | { ok: true; credential: MyCredential; uid: string }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_FAILED" };

interface Persisted {
  bandUid: string | null;
  checkedInAt: string | null;
  lostUids: string[];
  credentialState: CredentialState;
  read: string[];
}

const STORAGE_KEY = "syn.mock.portal.v1";
const DESK_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const NFC_UID = /^[0-9A-F]{8,32}$/;

export interface PortalStore {
  readonly world: PortalWorld;
  readonly holderName: string;
  readonly nearestDesk: string;
  /** Discovery: listed events only (Private Invitation events never appear). */
  listEvents(): PortalEvent[];
  /** Any event by slug, listed or not (an invitation link resolves). */
  getEvent(slug: string): PortalEvent | undefined;
  occupancy(eventId: string): RoomOccupancy[];
  profile(slug: string): PortalWorld["profiles"][string] | undefined;
  isRegisteredEmail(email: string): boolean;
  membership(slug: string): Membership;
  /** GET /me/registration?event_id= — null when not registered for that event. */
  registration(eventId: string): MyRegistration | null;
  /** The event the demo credential belongs to. */
  passEvent(): PortalEvent;
  credential(): MyCredential;
  /** The bound band's UID, or null. */
  bandUid(): string | null;
  codes(): PortalCodeBatch;
  bind(binding: Binding): BindOutcome;
  reportLostBand(): void;
  setCredentialState(state: CredentialState): void;
  sessions(): EventSession[];
  notifications(): Notification[];
  markAllRead(): void;
  /** Called on every change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Revision number; changes on every mutation (for useSyncExternalStore). */
  version(): number;
  reset(): void;
}

export interface PortalStoreOptions {
  clock: Clock;
  storage?: StorageLike;
}

export function createPortalStore({ clock, storage }: PortalStoreOptions): PortalStore {
  const world = buildPortalWorld();
  const passEvent = world.events.find((event) => event.detail.slug === DEMO_EVENT_SLUG) as PortalEvent;
  const permitted = passEvent.detail.rooms.map((room) => room.room_id);
  const listeners = new Set<() => void>();
  let revision = 0;

  const initial: Persisted = { bandUid: null, checkedInAt: null, lostUids: [], credentialState: "active", read: [] };
  let state: Persisted = load();

  function load(): Persisted {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? { ...initial, ...(JSON.parse(raw) as Partial<Persisted>) } : { ...initial };
    } catch {
      return { ...initial };
    }
  }

  function commit(next: Persisted): void {
    state = next;
    revision++;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable in private browsing; the mock still works in memory.
    }
    for (const listener of listeners) listener();
  }

  function credential(): MyCredential {
    const base = demoCredential(passEvent.detail.id, permitted);
    const carriers = [...base.carriers];
    if (state.bandUid) {
      carriers.push({ kind: "nfc", state: "bound", identifier_hint: hint(state.bandUid) });
    }
    return { ...base, state: state.credentialState, carriers };
  }

  return {
    world,
    holderName: DEMO_HOLDER,
    nearestDesk: DEMO_DESK,

    listEvents: () => world.events.filter((event) => event.listed),
    getEvent: (slug) => world.events.find((event) => event.detail.slug === slug),
    occupancy: (eventId) => world.occupancy[eventId] ?? [],
    profile: (slug) => world.profiles[slug],
    isRegisteredEmail: (email) => registeredEmails.includes(email.trim().toLowerCase()),

    membership(slug) {
      if (slug !== DEMO_EVENT_SLUG) return "none";
      return state.bandUid ? "checked_in" : "registered";
    },

    registration(eventId) {
      if (eventId !== passEvent.detail.id) return null;
      const current = credential();
      return {
        registration_id: current.registration_id,
        event_id: eventId,
        tier: current.tier,
        state: "confirmed",
        checked_in_at: state.checkedInAt,
        checked_in: state.checkedInAt !== null,
        zone_presence_consent: false,
        credential_state: current.state,
      };
    },

    passEvent: () => passEvent,
    credential,
    bandUid: () => state.bandUid,
    codes: () => codeBatch(credential().registration_id, clock.now()),

    bind(binding) {
      const band =
        binding.via === "desk_code"
          ? DESK_CODE.test(binding.code.toUpperCase())
            ? deskBands.find((entry) => entry.code === binding.code.toUpperCase())
            : null
          : NFC_UID.test(binding.uid.toUpperCase())
            ? deskBands.find((entry) => entry.uid === binding.uid.toUpperCase())
            : null;

      if (band === null) return { ok: false, code: "VALIDATION_FAILED" };
      if (!band || state.lostUids.includes(band.uid)) return { ok: false, code: "NOT_FOUND" };
      if (band.boundTo === "other") return { ok: false, code: "CONFLICT" };

      commit({ ...state, bandUid: band.uid, checkedInAt: state.checkedInAt ?? new Date(clock.now()).toISOString() });
      return { ok: true, credential: credential(), uid: band.uid };
    },

    reportLostBand() {
      if (!state.bandUid) return;
      commit({ ...state, lostUids: [...state.lostUids, state.bandUid], bandUid: null });
    },

    setCredentialState(credentialState) {
      commit({ ...state, credentialState });
    },

    sessions() {
      return [...passEvent.detail.sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },

    notifications() {
      return demoNotifications
        .map((item) => ({ ...item, read: item.read || state.read.includes(item.id) }))
        .sort((a, b) => b.at.localeCompare(a.at));
    },

    markAllRead() {
      commit({ ...state, read: demoNotifications.map((item) => item.id) });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    version: () => revision,

    reset() {
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      commit({ ...initial });
    },
  };
}

/** `04A2…E2`: the band UID as the portal shows it. */
export function hint(uid: string): string {
  return `${uid.slice(0, 4)}…${uid.slice(-2)}`;
}

/** A simulated network round trip, so screens show their loading state. */
export function delay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
