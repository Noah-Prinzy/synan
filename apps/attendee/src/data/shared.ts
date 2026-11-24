/**
 * Mapping rules both data sources share (contract shape → what the screens show). Deliberately
 * free of imports from ./backend, so either source can use it without an import cycle.
 */
import type { CredentialState as ContractCredentialState, EventState as ContractEventState } from "@synan/contracts/enums";
import type { MyCredential, ProfileField as ContractProfileField } from "@synan/contracts/rest";
import type { EventState } from "./events";
import type { CredentialState } from "./pass";
import type { ProfileField } from "./registration";

/** An event-defined profile field (GET /events/:slug/profile-schema) as the form renders it. */
export function toField(field: ContractProfileField): ProfileField {
  const hint = field.hint ?? undefined;
  const placeholder = field.placeholder ?? undefined;
  const base = { id: field.key, label: field.label, required: field.required };
  if (field.type === "select") return { ...base, kind: "select", options: field.options ?? [], hint };
  if (field.type === "multiselect") return { ...base, kind: "multi", options: field.options ?? [], hint };
  // text, email, phone, date and checkbox all render as text until the form grows those kinds.
  return { ...base, kind: "text", placeholder, hint };
}

export function viewState(state: ContractEventState): EventState {
  if (state === "live") return "live";
  if (state === "closed" || state === "archived") return "closed";
  return "upcoming";
}

export function hasBand(credential: MyCredential): boolean {
  return credential.carriers.some(
    (carrier) => carrier.kind === "nfc" && (carrier.state === "bound" || carrier.state === "active"),
  );
}

/** The five states the pass shows verbatim (docs/06 A4). */
export function displayState(state: ContractCredentialState, bandBound: boolean): CredentialState {
  switch (state) {
    case "revoked":
      return "REVOKED";
    case "replaced":
      return "REPLACED";
    case "suspended_review":
      return "UNDER REVIEW";
    case "issued":
    case "active":
      return bandBound ? "READY" : "NOT YET BOUND";
  }
}

/** Fired on the window whenever the signed-in session starts, ends or changes name. */
export const SESSION_EVENT = "syn:session";

export function notifySession(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** A10: the invitation replies this device sent (data/invitation.ts), by token fingerprint. */
export const INVITATION_REPLIES_KEY = "synan.invitation.replies";

export const sleep =(ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
