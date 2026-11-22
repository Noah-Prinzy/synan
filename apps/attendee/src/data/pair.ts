// Band provisioning mock data
// BANDS map: valid, already bound, unknown
export type BindResult = { ok: true; band: Band } | { ok: false; reason: "already_bound" | "unknown_band" };

export interface Band {
  uid: string;
  carrier: string;
  boundTo: string | null;
}

// Mock band database
const bands: Record<string, Band> = {
  K4M2PZ: {
    uid: "K4M2PZ",
    carrier: "NFC wristband",
    boundTo: null,
  },
  BUSY01: {
    uid: "BUSY01",
    carrier: "NFC wristband",
    boundTo: "taken@connexia.dev",
  },
  // Pre-bound to the demo user
  "04A29F31C7D0": {
    uid: "04A29F31C7D0",
    carrier: "NFC wristband",
    boundTo: "noahdevsug@gmail.com",
  },
};

// Dev code hint for testing
// In production this would come from the pass data
export const devCodeHint = "K4M2PZ";

export function bindBand(code: string, email: string): BindResult {
  const upperCode = code.trim().toUpperCase();
  const band = bands[upperCode];

  if (!band) {
    return { ok: false, reason: "unknown_band" };
  }

  if (band.boundTo && band.boundTo !== email) {
    return { ok: false, reason: "already_bound" };
  }

  // Bind the band to this email
  band.boundTo = email;
  return { ok: true, band: { ...band } };
}

// Get band by UID
export function getBand(uid: string): Band | null {
  return bands[uid.toUpperCase()] ?? null;
}

// Check if band is bound to current user
export function isBandBound(uid: string, email: string): boolean {
  const band = getBand(uid);
  return band?.boundTo === email;
}

// Unbind a band (for lost band flow)
export function unbindBand(uid: string): void {
  const band = bands[uid.toUpperCase()];
  if (band) {
    band.boundTo = null;
  }
}
