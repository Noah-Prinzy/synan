/**
 * A4 view model: GET /me/credential + the band carrier, mapped to the five states the
 * pass shows verbatim (docs/06 A4), and the four tiers (D-02).
 */
import type { AttendeeTier, CredentialState as ContractCredentialState, MyCredential } from "@synan/mock";
import { hint } from "@synan/mock";
import { portal } from "./mock";

export type CredentialState = "READY" | "NOT YET BOUND" | "UNDER REVIEW" | "REVOKED" | "REPLACED";

export const CREDENTIAL_STATES: readonly CredentialState[] = [
  "READY",
  "NOT YET BOUND",
  "UNDER REVIEW",
  "REVOKED",
  "REPLACED",
];

/** Display names for the four tiers (D-02, docs/01 §4). */
export const tierLabel: Record<AttendeeTier, string> = {
  VIP: "VIP",
  ORDINARY: "Ordinary",
  PRIVATE_INVITE: "Private Invitation",
  PUBLIC: "Public",
};

export type Pass = {
  holder: string;
  tier: AttendeeTier;
  event: { slug: string; title: string; startsAt: string; timezone: string; venue: string };
  state: CredentialState;
  band: { uid: string; hint: string } | null;
  nearestDesk: string;
};

function hasBand(credential: MyCredential): boolean {
  return credential.carriers.some(
    (carrier) => carrier.kind === "nfc" && (carrier.state === "bound" || carrier.state === "active"),
  );
}

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

/**
 * The attendee's pass. `preview` (from ?state=) forces a display state so every state
 * can be reviewed in the mock build.
 */
export function getPass(preview?: string | null): Pass {
  const credential = portal.credential();
  const event = portal.passEvent().detail;
  const uid = portal.bandUid();
  const forced = CREDENTIAL_STATES.find((item) => item === preview);
  return {
    holder: portal.holderName,
    tier: credential.tier,
    event: {
      slug: event.slug,
      title: event.title,
      startsAt: event.starts_at,
      timezone: event.timezone,
      venue: event.venue.name,
    },
    state: forced ?? displayState(credential.state, hasBand(credential)),
    band: uid ? { uid, hint: hint(uid) } : null,
    nearestDesk: portal.nearestDesk,
  };
}

export function getCodes() {
  return portal.codes();
}

export function reportLostBand(): void {
  portal.reportLostBand();
}
