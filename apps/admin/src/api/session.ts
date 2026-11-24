/**
 * The operator's token pair (03 §3), kept in the browser so a reload stays signed in.
 *
 * - Access tokens live 10 minutes; the client refreshes them ahead of expiry.
 * - Refresh tokens rotate and are single-use: a reused one ends the whole session family, so they
 *   are only ever exchanged by the client, one tab at a time (client.ts).
 * - An MFA step-up starts a new family with a fresh second factor (`mfa_until`, an estimate from
 *   this side: the server decides).
 *
 * Other tabs see every write through the `storage` event, so a sign-out or a step-up in one tab
 * reaches the others. Storage is injectable so the client also runs in Node (verification script).
 */
import type { Role } from "@synan/contracts/enums";
import type { TokenPair } from "@synan/contracts/rest";

export const SESSION_KEY = "synan.admin.session.v1";

/** A step-up lasts this long on the server (MFA_FRESH_S, 15 minutes). Used only for the estimate below. */
export const MFA_FRESH_MS = 15 * 60_000;

export interface OperatorSession {
  access_token: string;
  /** Epoch ms. */
  access_expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  /** Principal.sub: the operator's user id. */
  sub: string;
  email: string | null;
  role: Role | null;
  mfa_enrolled: boolean;
  /** Estimated end of the current step-up (epoch ms); null when the token carries none. */
  mfa_until: number | null;
  /** When this sign-in began (epoch ms): the console's "session" when there is no shift. */
  signed_in_at: number;
}

/** The subset of the Web Storage API the store needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStore {
  read(): OperatorSession | null;
  /**
   * Store a pair from /auth/login, /auth/refresh or /auth/mfa/verify. `stepUp`: the pair comes from
   * a step-up, so the second factor is fresh from now.
   */
  save(pair: TokenPair, how: "login" | "refresh" | "step-up"): OperatorSession;
  clear(): void;
  /** Sign-in, sign-out, refresh and step-up, in this tab or another. Returns an unsubscribe. */
  subscribe(listener: (session: OperatorSession | null) => void): () => void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    // Touch it once: a blocked store (private mode, sandboxed frame) throws here.
    storage?.getItem(SESSION_KEY);
    return storage ?? null;
  } catch {
    return null;
  }
}

export function createSessionStore(options: { storage?: KeyValueStorage | null; now?: () => number } = {}): SessionStore {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? Date.now;
  const listeners = new Set<(session: OperatorSession | null) => void>();
  /** Used when storage is blocked or absent: the session lasts for this page only. */
  let memory: OperatorSession | null = null;

  const raw = (): OperatorSession | null => {
    if (!storage) return memory;
    try {
      const text = storage.getItem(SESSION_KEY);
      return text ? (JSON.parse(text) as OperatorSession) : null;
    } catch {
      return memory;
    }
  };

  const write = (session: OperatorSession | null) => {
    memory = session;
    if (storage) {
      try {
        if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
        else storage.removeItem(SESSION_KEY);
      } catch {
        /* blocked: memory holds it */
      }
    }
    for (const listener of listeners) listener(session);
  };

  // Another tab signed in, refreshed, stepped up or signed out.
  const win = (globalThis as { window?: Window }).window;
  win?.addEventListener?.("storage", (event: StorageEvent) => {
    if (event.key !== SESSION_KEY) return;
    const next = raw();
    for (const listener of listeners) listener(next);
  });

  return {
    read() {
      const session = raw();
      if (!session) return null;
      // The refresh token has expired: the session is over, whatever the access token says.
      if (session.refresh_expires_at <= now()) {
        write(null);
        return null;
      }
      return session;
    },
    save(pair, how) {
      const previous = raw();
      const at = now();
      const samePerson = previous?.sub === pair.principal.sub;
      const session: OperatorSession = {
        access_token: pair.access_token,
        access_expires_at: Date.parse(pair.access_expires_at),
        refresh_token: pair.refresh_token,
        refresh_expires_at: Date.parse(pair.refresh_expires_at),
        sub: pair.principal.sub,
        email: pair.principal.email,
        role: pair.principal.role,
        mfa_enrolled: pair.principal.mfa_enrolled,
        mfa_until: !pair.principal.mfa
          ? null
          : how === "step-up"
            ? at + MFA_FRESH_MS
            : samePerson
              ? (previous?.mfa_until ?? null)
              : null,
        signed_in_at: how === "login" || !samePerson ? at : (previous?.signed_in_at ?? at),
      };
      write(session);
      return session;
    },
    clear() {
      write(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
