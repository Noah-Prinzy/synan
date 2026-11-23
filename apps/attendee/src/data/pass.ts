/**
 * A4 view model: GET /me/credential + the band carrier, mapped to the five states the
 * pass shows verbatim (docs/06 A4), and the four tiers (D-02).
 */
import type { AttendeeTier, CredentialState as ContractCredentialState, MyCredential } from "@synan/mock";
import { delay, hint, type PortalCodeBatch } from "@synan/mock";
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

const CODES_KEY = "synan.pass.codes";

/**
 * GET /me/credential/codes: the next 15 minutes of signed codes (D-05, D-12). Each batch
 * fetched online is kept on the device, so a reload with no connection still has codes
 * to rotate through until they run out.
 */
export function getCodes(): PortalCodeBatch {
  if (typeof navigator === "undefined" || navigator.onLine) {
    const batch = portal.codes();
    try {
      localStorage.setItem(CODES_KEY, JSON.stringify(batch));
    } catch {
      /* storage blocked: the batch lives for this page only */
    }
    return batch;
  }
  try {
    const saved = localStorage.getItem(CODES_KEY);
    if (saved) return JSON.parse(saved) as PortalCodeBatch;
  } catch {
    /* fall through */
  }
  return portal.codes();
}

/**
 * Email a fresh single-use copy of the pass. No attendee endpoint exists for this yet
 * (only the operator resend, POST /credentials/:id/resend); proposed: POST /me/credential/resend.
 */
export async function emailPassCopy(): Promise<void> {
  await delay(600);
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
}

export function reportLostBand(): void {
  portal.reportLostBand();
}
