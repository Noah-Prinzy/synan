import { events, type EventSummary } from "./events";

export type ProfileField =
  | {
      kind: "text";
      id: string;
      label: string;
      required: boolean;
      placeholder?: string;
      hint?: string;
    }
  | {
      kind: "select";
      id: string;
      label: string;
      required: boolean;
      options: string[];
    }
  | {
      kind: "multi";
      id: string;
      label: string;
      required: boolean;
      options: string[];
      hint?: string;
    };

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

const defaultProfile: ProfileField[] = [
  {
    kind: "text",
    id: "organization",
    label: "Organisation",
    required: false,
    placeholder: "Where you work",
  },
  {
    kind: "select",
    id: "role",
    label: "Role",
    required: true,
    options: ["Founder", "Operator", "Engineer", "Policy", "Student", "Other"],
  },
];

const profiles: Record<string, ProfileField[]> = {
  "nexus-summit-2026": [
    {
      kind: "text",
      id: "organization",
      label: "Organisation",
      required: true,
      placeholder: "Where you work",
    },
    {
      kind: "select",
      id: "role",
      label: "Role",
      required: true,
      options: ["Founder", "Operator", "Engineer", "Policy", "Student", "Other"],
    },
    {
      kind: "multi",
      id: "tracks",
      label: "Tracks you plan to attend",
      required: false,
      options: ["Infrastructure", "Policy", "Product", "Research"],
      hint: "Pick any that apply. You can change this at the desk.",
    },
    {
      kind: "select",
      id: "meal",
      label: "Meal preference",
      required: true,
      options: ["No preference", "Vegetarian", "Vegan", "Halal"],
    },
  ],
  "security-operations-forum": [
    {
      kind: "text",
      id: "organization",
      label: "Organisation",
      required: true,
      placeholder: "Agency or company",
    },
    {
      kind: "select",
      id: "role",
      label: "Function",
      required: true,
      options: ["Security lead", "Event operations", "Venue staff", "Other"],
    },
    {
      kind: "multi",
      id: "topics",
      label: "Topics of interest",
      required: false,
      options: ["Threat assessment", "Access control", "Incident response"],
    },
  ],
  "design-week-kampala": [
    {
      kind: "select",
      id: "role",
      label: "You are",
      required: true,
      options: ["Designer", "Student", "Studio", "Press", "Other"],
    },
    {
      kind: "multi",
      id: "days",
      label: "Days you plan to attend",
      required: true,
      options: ["Wed 25 Nov", "Thu 26 Nov", "Fri 27 Nov"],
    },
  ],
};

export const duplicateEmails = ["taken@connexia.dev"];

export function findEvent(slug: string): EventSummary | undefined {
  return events.find((event) => event.slug === slug);
}

export function profileFor(slug: string): ProfileField[] {
  return profiles[slug] ?? defaultProfile;
}

export function isDuplicateEmail(email: string): boolean {
  return duplicateEmails.includes(email.trim().toLowerCase());
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9 ()-]{7,}$/;

export function validateIdentity(
  draft: RegistrationDraft,
): Partial<Record<"name" | "email" | "phone", string>> {
  const errors: Partial<Record<"name" | "email" | "phone", string>> = {};

  if (draft.name.trim().length < 2) errors.name = "Enter your full name";
  if (!emailPattern.test(draft.email.trim())) errors.email = "Enter a valid email address";
  if (draft.phone.trim() !== "" && !phonePattern.test(draft.phone.trim())) {
    errors.phone = "Enter a valid phone number, or leave it blank";
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
      if (!Array.isArray(value) || value.length === 0) errors[field.id] = "Select at least one";
      continue;
    }

    if (typeof value !== "string" || value.trim() === "") errors[field.id] = "Required";
  }

  return errors;
}

function storageKey(slug: string): string {
  return `connexia.registration.${slug}`;
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
