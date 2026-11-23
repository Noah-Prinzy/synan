/**
 * A3: the event's profile schema (GET /events/:slug/profile-schema, served by
 * @synan/mock in the contract ProfileField shape) adapted to the form's field
 * kinds, plus client-side validation and the resumable draft.
 */
import type { ProfileField as ContractProfileField } from "@synan/mock";
import { getEvents, type EventSummary } from "./events";
import { portal } from "./mock";

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

/** Self-service registration is for listed, open events only. */
export function findEvent(slug: string): EventSummary | undefined {
  return getEvents().find((event) => event.slug === slug);
}

function toField(field: ContractProfileField): ProfileField {
  const hint = field.hint ?? undefined;
  const placeholder = field.placeholder ?? undefined;
  const base = { id: field.key, label: field.label, required: field.required };
  if (field.type === "select") return { ...base, kind: "select", options: field.options ?? [], hint };
  if (field.type === "multiselect") return { ...base, kind: "multi", options: field.options ?? [], hint };
  // text, email, phone, date and checkbox all render as text until the form grows those kinds.
  return { ...base, kind: "text", placeholder, hint };
}

export function profileFor(slug: string): ProfileField[] {
  const profile = portal.profile(slug);
  if (!profile) return [];
  return profile.fields.map(toField);
}

export function isDuplicateEmail(email: string): boolean {
  return portal.isRegisteredEmail(email);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9 ()-]{7,}$/;

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
