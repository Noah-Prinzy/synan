/**
 * The attendee's token pair (03 §3), kept on the device so the pass opens after a reload and
 * offline. Access tokens live ten minutes; the refresh token rotates on every use (a reused one
 * ends the whole session family), so it is only ever exchanged by the API client, one tab at a time.
 *
 * Sign-in, sign-out and a name change fire SESSION_EVENT; a token refresh does not (nothing the
 * screens show changes). Other tabs see every write through the `storage` event.
 */
import type { TokenPair } from "@synan/contracts/rest";
import { notifySession } from "../shared";

const KEY = "syn.api.session";

export type StoredSession = {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  /** Principal.sub: the attendee's own id; keys what is kept on the device to this person. */
  sub: string;
  email: string;
  /** The name on file (GET /me), kept so the pass shows it offline; null until first read. */
  name: string | null;
};

export interface SessionStore {
  read(): StoredSession | null;
  /** Store a pair from /auth/verify or /auth/refresh. A refresh keeps the known name. */
  save(pair: TokenPair, name?: string | null): StoredSession;
  setName(name: string): void;
  clear(): void;
}

export function createSessionStore(now: () => number = Date.now): SessionStore {
  function raw(): StoredSession | null {
    try {
      const text = localStorage.getItem(KEY);
      return text ? (JSON.parse(text) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  function write(session: StoredSession | null): void {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {
      // Storage blocked (private browsing): the session lasts for this page only.
      memory = session;
    }
  }

  let memory: StoredSession | null = null;

  return {
    read() {
      const session = raw() ?? memory;
      if (!session) return null;
      // The refresh token has expired: the session is over, whatever the access token says.
      if (Date.parse(session.refresh_expires_at) <= now()) {
        write(null);
        memory = null;
        return null;
      }
      return session;
    },
    save(pair, name) {
      const previous = raw() ?? memory;
      const samePerson = previous?.sub === pair.principal.sub;
      const session: StoredSession = {
        access_token: pair.access_token,
        access_expires_at: pair.access_expires_at,
        refresh_token: pair.refresh_token,
        refresh_expires_at: pair.refresh_expires_at,
        sub: pair.principal.sub,
        email: pair.principal.email ?? previous?.email ?? "",
        name: name ?? (samePerson ? (previous?.name ?? null) : null),
      };
      memory = session;
      write(session);
      if (!samePerson || (name && name !== previous?.name)) notifySession();
      return session;
    },
    setName(name) {
      const current = raw() ?? memory;
      if (!current) return;
      const next = { ...current, name };
      memory = next;
      write(next);
      notifySession();
    },
    clear() {
      const had = (raw() ?? memory) !== null;
      memory = null;
      write(null);
      if (had) notifySession();
    },
  };
}
