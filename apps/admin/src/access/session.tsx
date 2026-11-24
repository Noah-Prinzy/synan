/**
 * The signed-in user ("who am I", GET /me/operator) and what they may do. Everything that
 * depends on the role reads `useSession()` / `useCan()`; the capability rules themselves live
 * in `capabilities.ts`.
 *
 * Nothing role-dependent renders until the session is known, so a deep link to a screen the
 * role may not open never shows that screen's content, not even for a frame.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OperatorContext } from "@synan/mock/command";
import { errorCode } from "../kit/errors";
import { api, backend, DEV_TOOLS, rememberDevRole } from "../live/backend";
import {
  ROLE_LABEL,
  capabilitiesOf,
  isConsoleRole,
  landingLabel,
  landingPath,
  type Capability,
  type ConsoleRole,
} from "./capabilities";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
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
  signIn: () => Promise<void>;
  retry: () => void;
  /** Development only: become another role at once. Undefined in a production build. */
  preview?: (role: ConsoleRole) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const NONE: ReadonlySet<Capability> = new Set();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    api.operator().then(
      (user) => mine === generation.current && setState({ status: "ready", user }),
      (error: unknown) => {
        if (mine !== generation.current) return;
        const code = errorCode(error);
        setState(code === "UNAUTHENTICATED" || code === "TOKEN_EXPIRED" ? { status: "signed-out" } : { status: "error", error });
      },
    );
  }, []);

  useEffect(load, [load]);

  const signOut = useCallback(async () => {
    generation.current++;
    await api.signOut();
    setState({ status: "signed-out" });
  }, []);

  const signIn = useCallback(async () => {
    const mine = ++generation.current;
    const user = await api.signIn();
    if (mine === generation.current) setState({ status: "ready", user });
  }, []);

  const preview = useCallback(
    async (role: ConsoleRole) => {
      backend.setPersona(role);
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
      preview: DEV_TOOLS ? preview : undefined,
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
