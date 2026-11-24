/**
 * A3: the event and its profile schema (GET /events/:slug/profile-schema, in the contract
 * ProfileField shape) adapted to the form's field kinds, plus client-side validation, the
 * resumable draft, and sending it (data/backend.ts decides where to).
 */
import { backend, type RegistrationForm, type Session, type SubmitOutcome } from "./backend";

export type ProfileField =
  | { kind: "text"; id: string; label: string; required: boolean; placeholder?: string; hint?: string }
  | { kind: "select"; id: string; label: string; required: boolean; options: string[]; hint?: string }
  | { kind: "multi"; id: string; label: string; required: boolean; options: string[]; hint?: string };

export type RegistrationDraft = {
  name: string;
  email: string;
  phone: string;
  answers: Record<string, string | string[]>;
  zoneConsent: boolean;
};

export function emptyDraft(): RegistrationDraft {
  return { name: "", email: "", phone: "", answers: {}, zoneConsent: false };
}

/**
 * The event (self-service registration is for listed, open events only, so `event` is undefined
 * otherwise) and its profile fields.
 */
export function loadRegistration(slug: string): RegistrationForm | Promise<RegistrationForm> {
  return backend.loadRegistration(slug);
}

/** Known only to the mock: the real API answers the same for a known and an unknown address. */
export function isDuplicateEmail(email: string): boolean {
  return backend.isDuplicateEmail(email);
}

/** POST /users/register (or POST /registrations when already signed in as that address). */
export function submitRegistration(slug: string, draft: RegistrationDraft, session: Session | null): Promise<SubmitOutcome> {
  return backend.submitRegistration(slug, draft, session);
}

/** Mock build only: the path that stands in for the emailed link. */
export function emailedLinkFor(email: string, next: string): string | null {
  return backend.emailedLinkFor(email, next);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The contract's own bound (RegisterUserRequest.phone allows 6–24), kept at 7 for a usable number. */
const phonePattern = /^\+?[0-9 ()-]{7,24}$/;

/** A phone number the API accepts, or blank. */
export function isPhone(phone: string): boolean {
  return phonePattern.test(phone.trim());
}

export function validateIdentity(
  draft: RegistrationDraft,
): Partial<Record<"name" | "email" | "phone", string>> {
  const errors: Partial<Record<"name" | "email" | "phone", string>> = {};
  if (draft.name.trim().length < 2) errors.name = "Enter your name as it should appear on your pass.";
  if (draft.email.trim() === "") errors.email = "Enter your email. We send your pass there.";
  else if (!emailPattern.test(draft.email.trim())) errors.email = "That email doesn't look complete. Check for a missing @ or dot.";
  if (draft.phone.trim() !== "" && !phonePattern.test(draft.phone.trim())) {
    errors.phone = "That number looks too short. Include the country code, or leave it blank.";
  }
  return errors;
}

export function validateProfile(
  fields: ProfileField[],
  answers: Record<string, string | string[]>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const value = answers[field.id];
    if (field.kind === "multi") {
      if (!Array.isArray(value) || value.length === 0) errors[field.id] = "Pick at least one.";
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      errors[field.id] = field.kind === "select" ? "Choose one to continue." : "Fill this in to continue.";
    }
  }
  return errors;
}

function storageKey(slug: string): string {
  return `synan.registration.${slug}`;
}

export function loadDraft(slug: string): RegistrationDraft {
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<RegistrationDraft>;
    return { ...emptyDraft(), ...parsed, answers: parsed.answers ?? {} };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(slug: string, draft: RegistrationDraft): void {
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(draft));
  } catch {
    // Private browsing can reject storage; the form still works for this visit.
  }
}

export function clearDraft(slug: string): void {
  try {
    sessionStorage.removeItem(storageKey(slug));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
