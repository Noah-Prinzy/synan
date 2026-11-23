import type { PrincipalKind, Role } from "@synan/contracts/enums";

/** The verified identity attached to a request after access-token verification. */
export interface AuthContext {
  /** users.id or attendees.id. */
  sub: string;
  kind: PrincipalKind;
  role: Role | null;
  /** Epoch ms of the last second-factor verification in this session, if any. */
  mfaAt: number | null;
  /** auth session (refresh family) id. */
  sid: string;
}

export function kindForRole(role: Role): PrincipalKind {
  return role === "admin" || role === "organiser" ? "operator" : "staff";
}
