/**
 * The signed-in user ("who am I", GET /me/operator) and what they may do. Everything that
 * depends on the role reads `useSession()` / `useCan()`; the capability rules themselves live
 * in `capabilities.ts`.
 *
 * Nothing role-dependent renders until the session is known, so a deep link to a screen the
 * role may not open never shows that screen's content, not even for a frame.
 *
 * On the mock, signing in takes no credentials and the dev tools can preview any role. On the
 * real API (live/backend.ts `mode === "api"`), signing in is email and password, the role and
 * its capabilities come from GET /me/operator, and the server can end the session at any time
 * (expired, revoked, signed out in another tab): the console then shows sign-in, saying why.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OperatorContext } from "@synan/mock/command";
import { errorCode } from "../kit/errors";
import { api, auth, DEV_TOOLS, mockBackend, mode, rememberDevRole } from "../live/backend";
import {
  ROLE_LABEL,
  capabilitiesOf,
  isConsoleRole,
  landingLabel,
  landingPath,
  type Capability,
  type ConsoleRole,
} from "./capabilities";

/**
 * Why nobody is signed in: `fresh` (no session on this device yet), `signed-out` (this person
 * signed out here), `expired` (the server refused the session), `elsewhere` (another tab signed out).
 */
export type SignedOutReason = "fresh" | "signed-out" | "expired" | "elsewhere";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out"; reason: SignedOutReason }
  | { status: "error"; error: unknown }
  | { status: "ready"; user: OperatorContext };

export interface SessionValue {
  state: SessionState;
  /** The signed-in user, or null while loading or signed out. */
  user: OperatorContext | null;
  role: ConsoleRole | null;
  /** The role in plain words ("Desk clerk"). */
  roleLabel: string;
  capabilities: ReadonlySet<Capability>;
  can: (capability: Capability) => boolean;
  /** True when the role has any console at all. */
  hasConsole: boolean;
  /** Where this role starts, and its name for "Go to …" links. */
  landing: string;
  landingLabel: string;
  /** Events the user may work; null means every event. */
  eventScope: ReadonlySet<string> | null;
  signOut: () => Promise<void>;
  /** Mock: no credentials. Real API: email and password (POST /auth/login), then GET /me/operator. */
  signIn: (credentials?: { email: string; password: string }) => Promise<OperatorContext>;
  retry: () => void;
  /** Development only, mock only: become another role at once. Undefined otherwise. */
  preview?: (role: ConsoleRole) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const NONE: ReadonlySet<Capability> = new Set();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const generation = useRef(0);
  const current = useRef(state);
  current.current = state;
  /** This tab is signing out on purpose: the session store's "cleared" is not news. */
  const leaving = useRef(false);

  const load = useCallback(() => {
    const mine = ++generation.current;
    // Real API with nothing stored: straight to sign-in, without asking the server.
    if (auth && !auth.session()) {
      setState({ status: "signed-out", reason: "fresh" });
      return;
    }
    api.operator().then(
      (user) => mine === generation.current && setState({ status: "ready", user }),
      (error: unknown) => {
        if (mine !== generation.current) return;
        const code = errorCode(error);
        setState(
          code === "UNAUTHENTICATED" || code === "TOKEN_EXPIRED"
            ? { status: "signed-out", reason: auth ? "expired" : "signed-out" }
            : { status: "error", error },
        );
      },
    );
  }, []);

  useEffect(load, [load]);

  // Real API: the server can end the session, and another tab can sign out.
  useEffect(() => {
    if (!auth) return;
    const offServer = auth.onSignedOut(() => {
      generation.current++;
      setState({ status: "signed-out", reason: "expired" });
    });
    const offSession = auth.onSession((session) => {
      if (session || leaving.current || current.current.status !== "ready") return;
      generation.current++;
      setState({ status: "signed-out", reason: "elsewhere" });
    });
    return () => {
      offServer();
      offSession();
    };
  }, []);

  const signOut = useCallback(async () => {
    generation.current++;
    leaving.current = true;
    try {
      await api.signOut();
    } finally {
      leaving.current = false;
    }
    setState({ status: "signed-out", reason: "signed-out" });
  }, []);

  const signIn = useCallback(async (credentials?: { email: string; password: string }) => {
    const mine = ++generation.current;
    let user: OperatorContext;
    if (auth) {
      if (!credentials) throw new Error("UNAUTHENTICATED");
      await auth.signIn(credentials.email, credentials.password);
      user = await api.operator();
    } else {
      user = await api.signIn();
    }
    if (mine === generation.current) setState({ status: "ready", user });
    return user;
  }, []);

  const preview = useCallback(
    async (role: ConsoleRole) => {
      mockBackend?.setPersona(role);
      rememberDevRole(role);
      setState({ status: "loading" });
      load();
    },
    [load],
  );

  const value = useMemo<SessionValue>(() => {
    const user = state.status === "ready" ? state.user : null;
    const capabilities = user ? capabilitiesOf(user) : NONE;
    const role = user && isConsoleRole(user.role) ? user.role : null;
    return {
      state,
      user,
      role,
      roleLabel: role ? ROLE_LABEL[role] : (user?.role ?? ""),
      capabilities,
      can: (capability) => capabilities.has(capability),
      hasConsole: capabilities.size > 0,
      landing: landingPath(capabilities),
      landingLabel: landingLabel(capabilities),
      eventScope: user?.event_ids ? new Set(user.event_ids) : null,
      signOut,
      signIn,
      retry: () => {
        setState({ status: "loading" });
        load();
      },
      preview: DEV_TOOLS && mode === "mock" ? preview : undefined,
    };
  }, [state, signOut, signIn, load, preview]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

/** `const can = useCan(); can("alerts.resolve")`. */
export function useCan(): (capability: Capability) => boolean {
  return useSession().can;
}

/** Renders its children only when the signed-in role has the capability: absent, not disabled. */
export function Can({ I, children, otherwise = null }: { I: Capability; children: ReactNode; otherwise?: ReactNode }) {
  return <>{useSession().can(I) ? children : otherwise}</>;
}
