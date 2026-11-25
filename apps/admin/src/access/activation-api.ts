/**
 * Staff activation calls (03 §3): read what a link is good for (POST /auth/activate/check) and set
 * the password with it (POST /auth/activate). Both are public and send no bearer token, even when
 * someone is signed in on this browser: the link belongs to the person who opens it.
 *
 * The mock has no accounts: demo links make every state reachable, for the screens only.
 *   …/activate#token=demo-valid      a supervisor's link (any other demo-valid-<role> works too)
 *   …/activate#token=demo-gate       a security-staff link (forwards to the Gate Scanner)
 *   …/activate#token=demo-expired    past its 72 hours
 *   …/activate#token=demo-used       already used
 *   anything else                    not valid
 */
import type { Role } from "@synan/contracts/enums";
import type { ActivationCheck } from "@synan/contracts/rest";
import { STAFF_PASSWORD } from "@synan/contracts/copy";
import { apiClient } from "../live/backend";

export interface ActivationApi {
  check(token: string): Promise<ActivationCheck>;
  /** Resolves when the password is set; throws with the contracts' error code otherwise. */
  activate(token: string, password: string): Promise<void>;
}

/** The mock's error: `code` read by kit/errors like the real API's failure. */
class MockActivationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const ROLES: readonly Role[] = ["admin", "organiser", "supervisor", "desk_clerk", "security_staff", "speaker", "crew"];

function mockApi(): ActivationApi {
  const used = new Set<string>();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 350));
  const stateOf = (token: string): ActivationCheck => {
    if (used.has(token) || token === "demo-used") return { state: "used" };
    if (token === "demo-expired") return { state: "expired" };
    if (token === "demo-gate") return { state: "valid", role: "security_staff", expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() };
    const m = /^demo-valid(?:-([a-z_]+))?$/.exec(token);
    const role = (m?.[1] ?? "supervisor") as Role;
    if (m && ROLES.includes(role)) return { state: "valid", role, expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() };
    return { state: "invalid" };
  };
  return {
    async check(token) {
      await wait();
      return stateOf(token);
    },
    async activate(token, password) {
      await wait();
      const s = stateOf(token).state;
      if (s === "expired") throw new MockActivationError("LINK_EXPIRED");
      if (s !== "valid") throw new MockActivationError("LINK_INVALID");
      if (password.length < STAFF_PASSWORD.min || password.length > STAFF_PASSWORD.max) throw new MockActivationError("VALIDATION_FAILED");
      used.add(token);
    },
  };
}

export const activationApi: ActivationApi = apiClient
  ? {
      check: (token) => apiClient!.call("checkActivation", { body: { token } }, { auth: "none" }),
      async activate(token, password) {
        await apiClient!.call("activateStaff", { body: { token, password } }, { auth: "none" });
      },
    }
  : mockApi();
