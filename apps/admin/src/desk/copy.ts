/**
 * The desk's words. States come from the contracts' copy (one source for every surface); the
 * sentences here say what a state means for the person standing at the desk.
 */
import {
  CARRIER_STATE_COPY,
  CREDENTIAL_STATE_COPY,
  REGISTRATION_STATE_COPY,
  TIER_LABEL,
  type StateSignal,
} from "@synan/contracts/copy";
import type { DeskRegistration } from "@synan/mock/command";

export { CARRIER_STATE_COPY, CREDENTIAL_STATE_COPY, REGISTRATION_STATE_COPY, TIER_LABEL };

export const signalText: Record<StateSignal, string> = {
  ok: "text-success",
  warn: "text-warning",
  stop: "text-destructive",
  idle: "text-muted-foreground",
};

export function displayName(row: DeskRegistration): string {
  return row.attendee.full_name ?? "Public visitor";
}

/** The band as the desk shows it: state words from CARRIER_STATE_COPY, the masked hint only. */
export function bandView(row: DeskRegistration): { label: string; signal: StateSignal; hint: string | null } {
  if (row.band_hint) {
    const state = row.checked_in_at ? CARRIER_STATE_COPY.active : CARRIER_STATE_COPY.bound;
    return { label: state.label, signal: state.signal, hint: row.band_hint };
  }
  // Lost and not yet replaced: reported by its holder, or marked lost at a desk. Gates refuse it.
  if (row.band_lost) return { label: `${CARRIER_STATE_COPY.lost.label}, not yet replaced`, signal: "stop", hint: null };
  return { label: "No band yet", signal: "idle", hint: null };
}

/** Why the desk cannot bind or replace a band for this registration, or null when it can. */
export function bandBlock(row: DeskRegistration): { signal: StateSignal; title: string; body: string } | null {
  if (row.state === "cancelled") {
    return {
      signal: "idle",
      title: "This registration is cancelled",
      body: "There is no pass to bind a band to. If they believe this is wrong, a supervisor or the organiser can look into it.",
    };
  }
  if (row.state === "pending_approval") {
    return {
      signal: "warn",
      title: "Awaiting approval",
      body: "The organiser has not approved this registration yet, so there is no pass. A band can be bound once it is approved.",
    };
  }
  if (row.credential_state === "revoked") {
    return {
      signal: "stop",
      title: "This pass is revoked",
      body: "Gates refuse it, and no band can be bound to it. Ask them to wait a moment and call a supervisor.",
    };
  }
  if (row.credential_state === "suspended_review") {
    return {
      signal: "warn",
      title: "This pass is under review",
      body: "It was held for a check. Gates refuse it until a supervisor clears it. Call a supervisor; the band can be bound once it is cleared.",
    };
  }
  return null;
}

/** Why the pass cannot be sent again, or null when it can. */
export function resendBlock(row: DeskRegistration): string | null {
  if (!row.attendee.email) return "They registered without an email address, so there is nowhere to send a pass. Bind a band instead.";
  if (row.state === "cancelled") return "This registration is cancelled, so it has no pass to send.";
  if (row.state === "pending_approval") return "The pass is sent when the registration is approved.";
  if (row.credential_state === "revoked") return "This pass is revoked, so it cannot be sent again.";
  if (row.credential_state === "suspended_review") return "This pass is under review; it can be sent once a supervisor clears it.";
  if (!row.credential_id) return "No pass has been issued yet.";
  return null;
}

/**
 * Tidy what a reader or a person typed: spaces, colons and dashes go (readers and printed
 * labels use them as separators); letters become capitals.
 */
export function normaliseBand(raw: string): string {
  return raw.replace(/[\s:-]/g, "").toUpperCase();
}

/** The desk's own check before asking the server, in words a clerk can act on. */
export function bandProblem(raw: string): string | null {
  const id = normaliseBand(raw);
  if (!id) return "Scan the band, or type the number printed inside it.";
  if (!/^[0-9A-F]+$/.test(id)) {
    const odd = id.replace(/[0-9A-F]/g, "");
    return /O/.test(odd)
      ? "A band number has only digits and the letters A to F. Is that an O where a zero should be?"
      : `A band number has only digits and the letters A to F; “${odd.slice(0, 3)}” is not one of them. Scan it again.`;
  }
  if (id.length < 8) return `That is ${id.length} characters; a band number has at least 8. Scan it again.`;
  if (id.length > 32) return `That is ${id.length} characters; a band number has at most 32. Clear the field and scan once.`;
  return null;
}

/** `••••81BF`: what the desk shows for a band typed or scanned a moment ago, as the server's band hint reads. */
export function maskBand(raw: string): string {
  const id = normaliseBand(raw);
  return id.length >= 4 ? `••••${id.slice(-4)}` : id;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
