/**
 * After activation, a console role signs in and goes straight on to authenticator set-up (03 §3:
 * the second factor its privileged actions ask for). The activation screen leaves a flag for this
 * tab (sessionStorage, no secret in it); once the new person is signed in, the set-up opens through
 * the same path as the operator menu's item, unless an authenticator is already enrolled.
 */
import { useEffect } from "react";
import { auth } from "../live/backend";
import { requestEnrolment } from "./mfa-bus";
import { useSession } from "./session";

const KEY = "synan.admin.after-activation";

export function markActivated(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    /* without storage, set-up stays one click away in the operator menu */
  }
}

function flagged(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function clearFlag(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

/** Rendered once inside the session provider (real API only). */
export function AfterActivation() {
  const { state, hasConsole } = useSession();
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || !hasConsole || !flagged()) return;
    // Let the console's first screen mount (and the step-up host register) before the set-up opens.
    const timer = window.setTimeout(() => {
      clearFlag();
      if (!auth?.session()?.mfa_enrolled) requestEnrolment();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ready, hasConsole]);
  return null;
}
