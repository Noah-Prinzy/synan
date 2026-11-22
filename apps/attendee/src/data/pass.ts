import type { EventSummary } from "./events";

export type CredentialState = "READY" | "NOT YET BOUND" | "REVOKED" | "REPLACED";

export type Pass = {
  holder: string;
  tier: string;
  event: Pick<EventSummary, "slug" | "title" | "startsAt" | "timezone" | "venue" | "city">;
  state: CredentialState;
  token: string;
  band: { uid: string } | null;
  nearestDesk: string;
};

const credentialStates: CredentialState[] = ["READY", "NOT YET BOUND", "REVOKED", "REPLACED"];

const basePass: Pass = {
  holder: "Noah Prins",
  tier: "General admission",
  event: {
    slug: "nexus-summit-2026",
    title: "Nexus Summit 2026",
    startsAt: "2026-11-22T09:00:00+03:00",
    timezone: "Africa/Kampala",
    venue: "Nexus Hall",
    city: "Kampala",
  },
  state: "READY",
  token: "cnx:cred:9f31c7d0-4a2e-11f1-9b4d-0aa7c2e1f0a2",
  band: { uid: "04A29F31C7D0" },
  nearestDesk: "Desk 2 · North entrance",
};

export function passVariant(state?: string | null, band?: string | null): Pass {
  const nextState = credentialStates.find((item) => item === state) ?? basePass.state;
  return { ...basePass, state: nextState, band: band === "0" ? null : basePass.band };
}

export function shortUid(uid: string): string {
  return `${uid.slice(0, 4)}…${uid.slice(-2)}`;
}
