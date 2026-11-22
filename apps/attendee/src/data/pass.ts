import type { EventSummary } from "./events";
import { getSession } from "./auth";

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
  band: null,
  nearestDesk: "Desk 2 · North entrance",
};

export function passVariant(state?: string | null, band?: string | null): Pass {
  const nextState = credentialStates.find((item) => item === state) ?? basePass.state;
  // Get the user's band from session if available
  const session = getSession();
  let userBand: { uid: string } | null = null;
  
  if (session && !band) {
    // Check if session has a band stored
    try {
      const sessionData = localStorage.getItem("cnx.session");
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (parsed.bandUid) {
          userBand = { uid: parsed.bandUid };
        }
      }
    } catch {
      // Fallback to default
    }
  }
  
  return { 
    ...basePass, 
    state: nextState, 
    band: band === "0" ? null : (band ? { uid: band } : userBand) 
  };
}

export function shortUid(uid: string): string {
  return `${uid.slice(0, 4)}…${uid.slice(-2)}`;
}

// Persist band binding to session
export function persistBandForSession(bandUid: string): void {
  try {
    const sessionData = localStorage.getItem("cnx.session");
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      parsed.bandUid = bandUid;
      localStorage.setItem("cnx.session", JSON.stringify(parsed));
    }
  } catch {
    // Storage not available
  }
}

// Clear band from session
export function clearBandFromSession(): void {
  try {
    const sessionData = localStorage.getItem("cnx.session");
    if (sessionData) {
      const parsed = JSON.parse(sessionData);
      delete parsed.bandUid;
      localStorage.setItem("cnx.session", JSON.stringify(parsed));
    }
  } catch {
    // Storage not available
  }
}
