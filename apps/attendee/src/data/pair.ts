/** A5: POST /me/credential/bind, served by @synan/mock. */
import { DEMO_DESK_CODES } from "@synan/mock";
import { portal } from "./mock";

export type BindResult =
  | { ok: true; band: { uid: string } }
  | { ok: false; reason: "already_bound" | "unknown_band" };

/** Shown in the mock build only, so the flow can be exercised. */
export const devCodeHint = DEMO_DESK_CODES.free;

export function bindBand(code: string): BindResult {
  const outcome = portal.bind({ via: "desk_code", code: code.trim().toUpperCase() });
  if (outcome.ok) return { ok: true, band: { uid: outcome.uid } };
  return { ok: false, reason: outcome.code === "CONFLICT" ? "already_bound" : "unknown_band" };
}
