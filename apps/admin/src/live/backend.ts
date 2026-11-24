/**
 * The admin's one backend instance (docs/02 §8). Which one is decided at build time:
 *
 *   VITE_API_URL unset   the mock (live/mock-backend.ts), exactly as before.
 *   VITE_API_URL=<url>   the real API (src/api), e.g. VITE_API_URL=http://127.0.0.1:5180.
 *
 * Each side is loaded with a dynamic import behind a condition Vite replaces with a constant, so a
 * build carries one of them and not the other. Everything else imports `api`, `configure`,
 * `connect` and `clock` from here and does not know which it got; only sign-in, the second factor
 * and the development tools ask `mode`.
 *
 * Development-only URL parameters (mock only; ignored in a production build):
 *   ?venue=large        Nexus Hall's 60-room build (the performance test)
 *   ?live=none          no event is live (the D1 empty state)
 *   ?slow=1             REST takes 2.5 s (loading state)
 *   ?fail=1             the first layout load fails (error state)
 *   ?ambient=0          no background traffic
 *   ?scenario=<name>    play a named scenario on load;  &loop=1 to repeat it
 *   ?fps=1              show the frame-time sampler (also on the real API)
 *   ?setup=fresh        no organisation or venues yet (D0 first run, empty venue list)
 *   ?as=<role>          sign in as admin, organiser, supervisor, desk_clerk, security_staff, speaker or crew
 */
import type { MockClock } from "@synan/mock";
import type { CommandApi, CommandMock, ConfigureApi } from "@synan/mock/command";
import type { AdminAuth, ApiClient } from "../api";
import type { LiveTransport } from "./transport";

/**
 * True in development, and in a performance build (VITE_SYNAN_DEVTOOLS=1) used only to
 * measure production React with the scenario switcher. Never set for a shipped build.
 */
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_SYNAN_DEVTOOLS === "1";

/** The real API's origin, or null on the mock. */
export const API_URL: string | null = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : null;

/** `api`: signing in, the second factor and the server's capabilities are real; the mock's personas are gone. */
export const mode: "mock" | "api" = import.meta.env.VITE_API_URL ? "api" : "mock";

const params = new URLSearchParams(DEV_TOOLS ? window.location.search : "");

export const devParams = {
  venue: params.get("venue") === "large" ? ("large" as const) : ("standard" as const),
  noLive: params.get("live") === "none",
  slow: params.get("slow") === "1",
  fail: params.get("fail") === "1",
  ambient: params.get("ambient") !== "0",
  scenario: params.get("scenario"),
  loop: params.get("loop") === "1",
  fps: params.get("fps") === "1",
  /** First run (D0): no organisation and no venues yet. */
  freshSetup: params.get("setup") === "fresh",
};

const DEV_ROLE_KEY = "synan.admin.dev-role";

/**
 * Development only, mock only: the role to sign in as (?as=supervisor, or the last role picked in
 * the dev tools). A production build always starts from the real session.
 */
function devRole(): string | null {
  if (!DEV_TOOLS) return null;
  const wanted = params.get("as");
  if (wanted) return wanted;
  try {
    return window.localStorage.getItem(DEV_ROLE_KEY);
  } catch {
    return null;
  }
}

/** Development only: keep the previewed role across reloads. */
export function rememberDevRole(role: string): void {
  if (!DEV_TOOLS) return;
  try {
    if (role === "admin") window.localStorage.removeItem(DEV_ROLE_KEY);
    else window.localStorage.setItem(DEV_ROLE_KEY, role);
  } catch {
    /* the preview lasts for this page only */
  }
}

interface Backend {
  api: CommandApi;
  configure: ConfigureApi;
  /**
   * The screens read only `now()`. On the real API it is server time (GET /time offset), not a
   * MockClock; the type stays MockClock so the desk's mock keeps compiling until it moves over.
   */
  clock: MockClock;
  connect(eventId: string): LiveTransport | null;
  /** Real API only: sign-in, the second-factor prompt, sign-out from the server. */
  auth: AdminAuth | null;
  /** Real API only: the typed client, for calls the two interfaces do not cover (the desk). */
  client: ApiClient | null;
  /** Mock only: personas, scenarios and link control for the development tools. */
  mock: CommandMock | null;
}

async function load(): Promise<Backend> {
  if (import.meta.env.VITE_API_URL) {
    const { createRealBackend } = await import("../api");
    const real = createRealBackend(String(import.meta.env.VITE_API_URL), {
      debug: DEV_TOOLS ? (message, detail) => console.debug(message, detail ?? "") : undefined,
    });
    return {
      api: real.api,
      configure: real.configure,
      clock: real.clock as unknown as MockClock,
      connect: real.connect,
      auth: real.auth,
      client: real.client,
      mock: null,
    };
  }
  const { createMockBackend } = await import("./mock-backend");
  const mock = createMockBackend({ ...devParams, wantedRole: devRole() });
  return { ...mock, auth: null, client: null };
}

const chosen = await load();

export const api: CommandApi = chosen.api;

/** The configure side: first run, venues, events, the wizard and the event workspace. */
export const configure: ConfigureApi = chosen.configure;

export const clock: MockClock = chosen.clock;

export const connect: (eventId: string) => LiveTransport | null = chosen.connect;

/** Real API only (null on the mock). */
export const auth: AdminAuth | null = chosen.auth;

/** Real API only (null on the mock): the typed client. */
export const apiClient: ApiClient | null = chosen.client;

/** Mock only (null on the real API): the development tools' handle on the mock server. */
export const mockBackend: CommandMock | null = chosen.mock;
