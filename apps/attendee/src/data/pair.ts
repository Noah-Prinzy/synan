/** A5: POST /me/credential/bind (desk code, or a band read with Web NFC). */
import { backend, type BindResult } from "./backend";

export type { BindResult };

/** Shown in the mock build only, so the flow can be exercised. Null against the real API. */
export const devCodeHint: string | null = backend.devCodeHint;

export function bindBand(code: string): BindResult | Promise<BindResult> {
  return backend.bindBand({ via: "desk_code", code: code.trim().toUpperCase() });
}

/** A band read by Web NFC: its serial number as hex, colons removed. */
export function bindTappedBand(uid: string): BindResult | Promise<BindResult> {
  return backend.bindBand({ via: "nfc", uid });
}

/** The band bound to the pass now, or null. */
export function boundBand(): { uid: string; hint: string } | null {
  return backend.boundBand();
}
