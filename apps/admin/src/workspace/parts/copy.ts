/**
 * Words for the workspace's states (docs/01 §3, §5.2): every state is a shape plus a word,
 * never colour alone. Belongs in `@synan/contracts/copy` next to the scan results; kept here
 * until contracts carries operator copy for credentials, carriers and roles.
 */
import type { CarrierState, CredentialState, RegistrationState } from "@synan/contracts/enums";
import type { SignalState } from "@synan/ui/data";

export const CREDENTIAL_VIEW: Record<CredentialState, { label: string; shape: SignalState; tone: string }> = {
  issued: { label: "Issued", shape: "idle", tone: "text-muted-foreground" },
  active: { label: "Active", shape: "ok", tone: "text-success" },
  suspended_review: { label: "Under review", shape: "warn", tone: "text-warning" },
  revoked: { label: "Revoked", shape: "stop", tone: "text-destructive" },
  replaced: { label: "Replaced", shape: "idle", tone: "text-muted-foreground" },
};

export const CREDENTIAL_ORDER: CredentialState[] = ["issued", "active", "suspended_review", "revoked", "replaced"];

export const REGISTRATION_VIEW: Record<RegistrationState, { label: string; shape: SignalState; tone: string }> = {
  confirmed: { label: "Confirmed", shape: "idle", tone: "text-foreground" },
  pending_approval: { label: "Awaiting approval", shape: "warn", tone: "text-warning" },
  cancelled: { label: "Cancelled", shape: "idle", tone: "text-muted-foreground" },
};

export const CARRIER_VIEW: Record<CarrierState, { label: string; detail: string }> = {
  stock: { label: "Stock", detail: "In the box, not yet given to anyone" },
  assigned: { label: "Assigned", detail: "Set aside for a named attendee" },
  bound: { label: "Bound", detail: "Linked to a credential, not yet scanned" },
  active: { label: "Active", detail: "Bound and seen at a gate" },
  lost: { label: "Lost", detail: "Reported lost and replaced" },
  retired: { label: "Retired", detail: "Out of service" },
};

export const CARRIER_ORDER: CarrierState[] = ["stock", "assigned", "bound", "active", "lost", "retired"];

/** Role names live with the capability map (one place for everything about roles). */
export { ROLE_LABEL } from "../../access/capabilities";

export const CHIP_PROFILE_LABEL: Record<string, string> = {
  ntag_uid: "NTAG (UID)",
  ntag424_dna: "NTAG 424 DNA",
  desfire_ev3: "DESFire EV3",
};

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "1 h 30 min", "45 min", "2 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
