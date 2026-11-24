import type { PrincipalKind, Role } from "@synan/contracts/enums";

/** The verified identity attached to a request after access-token verification. */
export interface AuthContext {
  /** users.id or attendees.id. */
  sub: string;
  kind: PrincipalKind;
  role: Role | null;
  /** Epoch ms of the last second-factor verification in this session, if any. */
  mfaAt: number | null;
  /** auth session (refresh family) id; for a device, the device id. */
  sid: string;
  /** Devices only: the one checkpoint a fixed reader is installed at. */
  checkpointId?: string | null;
  /** Devices only: the device token version the access token was minted from. */
  tokenVersion?: number | null;
}

/** Admin, organiser and supervisor sign in as operators (D-23); every other role as staff. */
export function kindForRole(role: Role): PrincipalKind {
  return role === "admin" || role === "organiser" || role === "supervisor" ? "operator" : "staff";
}
