/**
 * Real API only: ask the second-factor host (step-up.tsx, loaded lazily) to open the authenticator
 * set-up on its own, from the operator menu. A tiny bus, so the chrome does not load the host.
 */
const listeners = new Set<() => void>();

export function requestEnrolment(): void {
  for (const listener of listeners) listener();
}

export function onEnrolmentRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
