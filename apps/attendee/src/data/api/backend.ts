/**
 * The real data source: the Synan API. data/backend.ts selects it when VITE_API_URL is set;
 * nothing here is in a default (mock) build.
 *
 * Two halves. This one is loaded with the app and holds only what is on the device: the session,
 * the last pass and the codes fetched ahead (so the pass opens at once, and offline). Everything
 * that talks to the server is in ./remote, with Zod and the contract schemas, and is loaded on
 * first use — after the pass is on screen.
 */
import type { Notification, PortalCodeBatch } from "@synan/contracts/rest";
import type { Backend, PassChoice } from "../backend";
import { ApiFailure } from "../failure";
import type { Pass } from "../pass";
import { clearResources } from "../resource";
import type { Remote } from "./remote";
import { createSessionStore } from "./session";
import { CHOICES_KEY, CHOSEN_KEY, CODES_KEY, LEGACY_PENDING_KEY, PASS_KEY, readJson, writeJson, type CoreState, type Kept } from "./store";

export function createApiBackend(baseUrl: string): Backend {
  const origin = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const session = createSessionStore();
  const listeners = new Set<() => void>();
  let revision = 0;

  /** Kept on this device for the signed-in person only. */
  function mine<T>(key: string): Kept<T> | null {
    const kept = readJson<Kept<T>>(key);
    const current = session.read();
    return kept && current && kept.sub === current.sub ? kept : null;
  }

  // Answers kept by an earlier build until its emailed link was opened: the API holds them now.
  writeJson(LEGACY_PENDING_KEY, null);

  let pass: Pass | null = mine<Pass>(PASS_KEY)?.value ?? null;
  /** Passes loaded during this page's life, by event: switching back to one is instant (and works offline). */
  const passes = new Map<string, Pass>(pass ? [[pass.eventId, pass]] : []);
  let choices: PassChoice[] = mine<PassChoice[]>(CHOICES_KEY)?.value ?? [];
  let chosen: string | null = mine<string>(CHOSEN_KEY)?.value ?? null;
  let notifications: Notification[] | null = null;
  /** Server time minus device time, from the last code batch (D-14): codes rotate on the server's clock. */
  let offsetMs = mine<PortalCodeBatch>(CODES_KEY)?.offset ?? 0;

  const state: CoreState = {
    origin,
    session,
    pass: () => pass,
    setPass(next) {
      pass = next;
      if (next) passes.set(next.eventId, next);
      const current = session.read();
      writeJson(PASS_KEY, next && current ? ({ sub: current.sub, value: next } satisfies Kept<Pass>) : null);
      state.bump();
    },
    knownPass: (eventId) => passes.get(eventId) ?? null,
    choices: () => choices,
    setChoices(next) {
      if (JSON.stringify(next) === JSON.stringify(choices)) return;
      choices = next;
      const current = session.read();
      writeJson(CHOICES_KEY, current && next.length > 0 ? ({ sub: current.sub, value: next } satisfies Kept<PassChoice[]>) : null);
      state.bump();
    },
    chosen: () => chosen,
    choose(eventId) {
      chosen = eventId;
      const current = session.read();
      writeJson(CHOSEN_KEY, current && eventId ? ({ sub: current.sub, value: eventId } satisfies Kept<string>) : null);
    },
    notifications: () => notifications,
    setNotifications(items) {
      notifications = items;
      state.bump();
    },
    keepCodes(batch, offset, eventId) {
      offsetMs = offset;
      const current = session.read();
      if (current) writeJson(CODES_KEY, { sub: current.sub, value: batch, offset, eventId } satisfies Kept<PortalCodeBatch>);
    },
    keptCodes() {
      const kept = mine<PortalCodeBatch>(CODES_KEY);
      return kept && pass && kept.eventId === pass.eventId ? kept.value : null;
    },
    forgetPerson() {
      pass = null;
      passes.clear();
      choices = [];
      chosen = null;
      notifications = null;
      writeJson(PASS_KEY, null);
      writeJson(CODES_KEY, null);
      writeJson(CHOICES_KEY, null);
      writeJson(CHOSEN_KEY, null);
      remoteNow?.closeStream();
      clearResources();
      state.bump();
    },
    bump() {
      revision++;
      for (const listener of listeners) listener();
    },
  };

  let remoteNow: Remote | null = null;
  let loading: Promise<Remote> | null = null;
  /** The network half, loaded once on first use (a failed load is retried on the next call). */
  function remote(): Promise<Remote> {
    loading ??= import("./remote").then(
      ({ createRemote }) => (remoteNow = createRemote(state)),
      (error: unknown) => {
        loading = null;
        throw navigator.onLine ? error : new ApiFailure("OFFLINE", 0);
      },
    );
    return loading;
  }

  return {
    mode: "api",
    applyDevParams() {},

    now: () => Date.now() + offsetMs,
    subscribeClock: () => () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => revision,

    getEvents: async () => (await remote()).getEvents(),
    getEventDetail: async (slug) => (slug ? (await remote()).getEventDetail(slug) : null),
    getOccupancy: async (eventId) => (await remote()).getOccupancy(eventId),

    loadRegistration: async (slug) => (await remote()).loadRegistration(slug),
    // The API answers the same for a known and an unknown address (no enumeration), by design.
    isDuplicateEmail: () => false,
    submitRegistration: async (slug, draft, current) => {
      try {
        return await (await remote()).submitRegistration(slug, draft, current);
      } catch {
        return { ok: false, reason: navigator.onLine ? "error" : "offline" };
      }
    },
    emailedLinkFor: () => null,

    readInvitation: async (token) => (await remote()).readInvitation(token),
    async rsvp(token, reply) {
      try {
        const outcome = await (await remote()).rsvp(token, reply);
        // A new pass may now exist for whoever is signed in: what was loaded is stale.
        if (outcome.ok && outcome.reply === "accepted") clearResources();
        return outcome;
      } catch {
        return { ok: false, reason: navigator.onLine ? "error" : "offline" };
      }
    },
    devInvitedEmail: null,

    readSession() {
      const current = session.read();
      return current ? { email: current.email, name: current.name ?? current.email } : null;
    },
    requestSignInLink: async (email, next) => (await remote()).requestSignInLink(email, next),
    verifyLink: async (token, next) => {
      try {
        return await (await remote()).verifyLink(token, next);
      } catch {
        return { ok: false, problem: "unreachable" };
      }
    },
    signOut() {
      // The device forgets at once; the session family is ended on the server with the tokens
      // captured here (best effort: offline, the refresh token simply expires unused).
      const ending = session.read();
      session.clear();
      state.forgetPerson();
      if (ending) void remote().then((r) => r.logout(ending)).catch(() => undefined);
    },

    loadProfile: async () => (await remote()).loadProfile(),
    updateProfile: async (change) => (await remote()).updateProfile(change),

    peekPass: () => pass,
    loadPass: async () => (await remote()).loadPass(),
    passChoices: () => choices,
    selectPass(eventId) {
      if (eventId === pass?.eventId && chosen === eventId) return;
      state.choose(eventId);
      // The pass shows at once when it was loaded earlier; otherwise the screen waits for loadPass().
      const known = passes.get(eventId) ?? null;
      pass = known;
      state.bump();
    },
    initialCodes() {
      const kept = state.keptCodes();
      return kept && kept.codes.some((code) => Date.parse(code.expires_at) > Date.now() + offsetMs) ? kept : null;
    },
    async getCodes() {
      if (!navigator.onLine) {
        const kept = state.keptCodes();
        if (kept) return kept;
        throw new ApiFailure("OFFLINE", 0);
      }
      return (await remote()).getCodes();
    },
    emailPassCopy: async () => (await remote()).emailPassCopy(),
    reportLostBand: async () => (await remote()).reportLostBand(),
    watchPass(onState) {
      let stop: (() => void) | null = null;
      let cancelled = false;
      void remote().then(
        (r) => {
          if (!cancelled) stop = r.watchPass(onState);
        },
        () => undefined,
      );
      return () => {
        cancelled = true;
        stop?.();
      };
    },
    boundBand: () => pass?.band ?? null,
    bindBand: async (binding) => (await remote()).bindBand(binding),
    devCodeHint: null,

    mySessions: async () => (await remote()).mySessions(),

    loadNotifications: async () => (await remote()).loadNotifications(),
    notifications: () => notifications ?? [],
    async markAllRead() {
      const before = notifications ?? [];
      const unread = before.filter((item) => !item.read).map((item) => item.id);
      if (unread.length === 0) return;
      state.setNotifications(before.map((item) => ({ ...item, read: true })));
      try {
        await (await remote()).markRead(unread);
      } catch {
        // Not saved: show them unread again, as the server still has them.
        state.setNotifications(before);
      }
    },

    requestDataExport: async () => (await remote()).requestDataExport(),
    requestErasure: async () => (await remote()).requestErasure(),
  };
}
