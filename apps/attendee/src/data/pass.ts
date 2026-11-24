/**
 * A4 view model: GET /me/credential + the band carrier, mapped to the five states the pass shows
 * verbatim (docs/06 A4), and the four tiers (D-02). Live: re-renders on every change the source
 * reports (a band bound, /stream/me flipping the state).
 */
import { useCallback, useEffect, useState } from "react";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { MyCredential, PortalCode, PortalCodeBatch } from "@synan/contracts/rest";
import { backend } from "./backend";
import { failureKind } from "./failure";
import { useDataVersion } from "./live";

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
  eventId: string;
  event: { slug: string; title: string; startsAt: string; timezone: string; venue: string };
  state: CredentialState;
  band: { uid: string; hint: string } | null;
  nearestDesk: string;
};

export type { PortalCodeBatch };

export type PassResource =
  | { status: "ready"; data: Pass; retry: () => void }
  /** Signed in, but no pass is issued to this person. */
  | { status: "none"; data?: undefined; retry: () => void }
  | { status: "loading" | "error" | "offline"; data?: undefined; retry: () => void };

/**
 * The attendee's pass, live. `preview` (from ?state=) forces a display state in the mock build.
 * The mock always knows the pass, so this is ready at once there. The real API shows the pass
 * kept on this device straight away and refreshes it in the background.
 */
export function usePass(preview: string | null = null): PassResource {
  useDataVersion();
  const pass = backend.peekPass(preview);
  const [state, setState] = useState<"loading" | "error" | "offline" | "none">("loading");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const known = pass !== null;

  useEffect(() => {
    if (known && backend.mode === "mock") return;
    let live = true;
    if (!known) setState("loading");
    Promise.resolve(backend.loadPass()).then(
      (result) => {
        if (live && result.pass === null) setState("none");
      },
      (error: unknown) => {
        if (live && !known) setState(failureKind(error));
      },
    );
    return () => {
      live = false;
    };
    // Refresh once per visit (and on retry); later changes arrive through the source.
  }, [attempt]);

  if (pass) return { status: "ready", data: pass, retry };
  return { status: state, retry };
}

/** For a screen's loading state: resolves with the pass, or null when none is issued. */
export async function loadPass(): Promise<Pass | null> {
  return (await backend.loadPass()).pass;
}

/** The code to show at `nowMs`, or null once the batch is exhausted. */
export function currentCode(batch: PortalCodeBatch, nowMs: number): PortalCode | null {
  return batch.codes.find((code) => Date.parse(code.not_before) <= nowMs && nowMs < Date.parse(code.expires_at)) ?? null;
}

/**
 * GET /me/credential/codes: the next 15 minutes of signed codes (D-05, D-12). Each batch fetched
 * online is kept on the device, so a reload with no connection still has codes to rotate through.
 * `initialCodes` is what is already on the device (null before the first fetch).
 */
export function initialCodes(): PortalCodeBatch | null {
  return backend.initialCodes();
}

export function getCodes(): PortalCodeBatch | Promise<PortalCodeBatch> {
  return backend.getCodes();
}

/** POST /me/credential/resend: email a fresh single-use copy of the pass. */
export function emailPassCopy(): Promise<void> {
  return backend.emailPassCopy();
}

export function reportLostBand(): Promise<void> {
  return backend.reportLostBand();
}

/** /stream/me: called when the pass's state changes while subscribed. */
export function watchPass(onState: (state: MyCredential["state"]) => void): () => void {
  return backend.watchPass(onState);
}
