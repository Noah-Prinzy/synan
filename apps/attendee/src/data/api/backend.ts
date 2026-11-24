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
import type { Backend } from "../backend";
import { ApiFailure } from "../failure";
import type { Pass } from "../pass";
import { clearResources } from "../resource";
import type { Remote } from "./remote";
import { createSessionStore } from "./session";
import { CODES_KEY, PASS_KEY, PENDING_KEY, readJson, writeJson, type CoreState, type Kept } from "./store";

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

  let pass: Pass | null = mine<Pass>(PASS_KEY)?.value ?? null;
  let notifications: Notification[] | null = null;
  /** Server time minus device time, from the last code batch (D-14): codes rotate on the server's clock. */
  let offsetMs = mine<PortalCodeBatch>(CODES_KEY)?.offset ?? 0;

  const state: CoreState = {
    origin,
    session,
    pass: () => pass,
    setPass(next) {
      pass = next;
      const current = session.read();
      writeJson(PASS_KEY, next && current ? ({ sub: current.sub, value: next } satisfies Kept<Pass>) : null);
      state.bump();
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
      notifications = null;
      writeJson(PASS_KEY, null);
      writeJson(CODES_KEY, null);
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
    updateName: async (name) => (await remote()).updateName(name.trim()),
    signOut() {
      // The device forgets at once; the session family is ended on the server with the tokens
      // captured here (best effort: offline, the refresh token simply expires unused).
      const ending = session.read();
      session.clear();
      writeJson(PENDING_KEY, null);
      state.forgetPerson();
      if (ending) void remote().then((r) => r.logout(ending)).catch(() => undefined);
    },

    peekPass: () => pass,
    loadPass: async () => (await remote()).loadPass(),
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
    async reportLostBand() {
      // GAP: no attendee endpoint reports a lost band (operators use POST /carriers/:id/rebind).
      throw new ApiFailure("NOT_IMPLEMENTED", 501);
    },
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
