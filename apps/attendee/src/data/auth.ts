// Auth mock layer using localStorage
const STORAGE_KEY = "syn.session";
const MAGIC_PREFIX = "syn-magic-";

interface Session {
  email: string;
  name: string;
}

function getStoredSession(): Session | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setStoredSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  notify();
}

export function getSession(): Session | null {
  return getStoredSession();
}

export function signIn(email: string): Session {
  // In a real app this would trigger an email send
  // For mock purposes we create a session immediately
  const emailTrimmed = email.trim();
  const session: Session = {
    email: emailTrimmed,
    name: emailTrimmed.split("@")[0] || "User",
  };
  setStoredSession(session);
  return session;
}

export function verifyToken(token: string): Session | null {
  // Mock token format: syn-magic-<email>
  if (token.startsWith(MAGIC_PREFIX)) {
    const email = token.slice(MAGIC_PREFIX.length);
    const emailTrimmed = decodeURIComponent(email).trim();
    const session: Session = {
      email: emailTrimmed,
      name: emailTrimmed.split("@")[0] || "User",
    };
    setStoredSession(session);
    return session;
  }
  return null;
}

/** Mock: tokens starting syn-expired- are expired; anything else not syn-magic- is invalid. */
export function linkProblem(token: string): "expired" | "invalid" {
  return token.startsWith("syn-expired-") ? "expired" : "invalid";
}

export function signOut(): void {
  setStoredSession(null);
}

// React hook for session state
import { useSyncExternalStore } from "react";

const SESSION_EVENT = "syn:session";

function notify(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function subscribe(listener: () => void): () => void {
  const onChange = () => {
    refreshSnapshot();
    listener();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener(SESSION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SESSION_EVENT, onChange);
  };
}

let cached: Session | null = null;
let loaded = false;

function refreshSnapshot(): Session | null {
  cached = getStoredSession();
  loaded = true;
  return cached;
}

function getSnapshot(): Session | null {
  return loaded ? cached : refreshSnapshot();
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
