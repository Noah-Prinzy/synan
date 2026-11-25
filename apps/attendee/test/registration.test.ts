// @vitest-environment happy-dom
/**
 * Registration (A3) and the invitation reply (A10): what the form refuses before sending, the draft
 * that survives a reload in this tab, and this device's memory of a reply it sent — kept by a
 * fingerprint of the invitation link, never the link itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  emptyDraft,
  isPhone,
  loadDraft,
  saveDraft,
  validateIdentity,
  validateProfile,
  type ProfileField,
} from "../src/data/registration";
import { fingerprint, isWellFormedToken, repliedBefore, sendReply, validateReply, type RsvpReply } from "../src/data/invitation";
import { INVITATION_REPLIES_KEY } from "../src/data/shared";
import type { RsvpOutcome } from "../src/data/invitation";

const rsvp = vi.fn<(token: string, reply: RsvpReply) => Promise<RsvpOutcome>>();
vi.mock("../src/data/backend", () => ({ backend: { rsvp: (token: string, reply: RsvpReply) => rsvp(token, reply) } }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  rsvp.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("identity checks", () => {
  const draft = (p: Partial<ReturnType<typeof emptyDraft>>) => ({ ...emptyDraft(), name: "Ada Lovelace", email: "ada@example.com", ...p });

  it("accepts a complete identity, with or without a phone", () => {
    expect(validateIdentity(draft({}))).toEqual({});
    expect(validateIdentity(draft({ phone: "+44 (0)20 7946-0958" }))).toEqual({});
    expect(validateIdentity(draft({ phone: "   " }))).toEqual({});
  });

  it("asks for a name of two letters or more, and an email with an @ and a dot", () => {
    expect(validateIdentity(draft({ name: " A " })).name).toBeTruthy();
    expect(validateIdentity(draft({ email: "" })).email).toBe("Enter your email. We send your pass there.");
    for (const email of ["ada", "ada@example", "ada example@x.com", "@example.com"]) {
      expect(validateIdentity(draft({ email })).email).toMatch(/doesn't look complete/);
    }
    expect(validateIdentity(draft({ email: "  ada@example.com  " })).email).toBeUndefined();
  });

  it("refuses a phone the API would refuse (too short, letters), and accepts the API's characters", () => {
    for (const phone of ["12345", "call me", "+44 12a 456789"]) expect(validateIdentity(draft({ phone })).phone).toBeTruthy();
    expect(isPhone("+1 (555) 010-9999")).toBe(true);
    expect(isPhone("1234567")).toBe(true);
    expect(isPhone("123456")).toBe(false);
    expect(isPhone("1".repeat(25))).toBe(false);
  });
});

describe("the event's own questions", () => {
  const fields: ProfileField[] = [
    { kind: "text", id: "company", label: "Company", required: true },
    { kind: "select", id: "diet", label: "Diet", required: true, options: ["None", "Vegan"] },
    { kind: "multi", id: "tracks", label: "Tracks", required: true, options: ["A", "B"] },
    { kind: "text", id: "note", label: "Note", required: false },
  ];

  it("asks for every required answer in words that fit the kind of question", () => {
    expect(validateProfile(fields, {})).toEqual({
      company: "Fill this in to continue.",
      diet: "Choose one to continue.",
      tracks: "Pick at least one.",
    });
  });

  it("treats blank text and an empty selection as unanswered, and never requires an optional question", () => {
    expect(validateProfile(fields, { company: "   ", diet: "", tracks: [] })).toHaveProperty("company");
    expect(validateProfile(fields, { company: "Analytical Engines", diet: "Vegan", tracks: ["B"] })).toEqual({});
  });
});

describe("the draft", () => {
  it("comes back for the same event after a reload, and is separate per event", () => {
    const draft = { ...emptyDraft(), name: "Ada", answers: { company: "AE", tracks: ["A"] }, zoneConsent: true };
    saveDraft("summit", draft);
    expect(loadDraft("summit")).toEqual(draft);
    expect(loadDraft("other-event")).toEqual(emptyDraft());
  });

  it("is gone once cleared (after a successful registration)", () => {
    saveDraft("summit", { ...emptyDraft(), name: "Ada" });
    clearDraft("summit");
    expect(loadDraft("summit")).toEqual(emptyDraft());
  });

  it("starts empty from a damaged or older draft instead of breaking the form", () => {
    sessionStorage.setItem("synan.registration.summit", "{not json");
    expect(loadDraft("summit")).toEqual(emptyDraft());
    sessionStorage.setItem("synan.registration.summit", JSON.stringify({ name: "Ada" }));
    expect(loadDraft("summit")).toEqual({ ...emptyDraft(), name: "Ada", answers: {} });
  });

  it("keeps the form working when storage is refused (private browsing)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveDraft("summit", emptyDraft())).not.toThrow();
    expect(loadDraft("summit")).toEqual(emptyDraft());
  });
});

describe("the invitation reply", () => {
  // An obviously fake, low-entropy token of the right shape (base64url, 16–512 characters).
  const token = `test-invite-token-${"a".repeat(16)}`;
  const reply: RsvpReply = { accept: true, email: "  ada@example.com ", name: " Ada Lovelace ", answers: {}, zoneConsent: false };

  it("accepts only a well-formed link token: 16 to 512 base64url characters", () => {
    expect(isWellFormedToken(token)).toBe(true);
    expect(isWellFormedToken("a".repeat(16))).toBe(true);
    expect(isWellFormedToken("a".repeat(15))).toBe(false);
    expect(isWellFormedToken("a".repeat(513))).toBe(false);
    expect(isWellFormedToken(`${"a".repeat(20)}=`)).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
  });

  it("sends the address and name trimmed, and remembers a sent reply on this device", async () => {
    rsvp.mockResolvedValue({ ok: true, reply: "accepted" });
    await sendReply(token, reply, "Summit");
    expect(rsvp).toHaveBeenCalledWith(token, expect.objectContaining({ email: "ada@example.com", name: "Ada Lovelace" }));
    expect(repliedBefore(token)).toMatchObject({ reply: "accepted", email: "ada@example.com", title: "Summit" });
    expect(repliedBefore(`${token}x`)).toBeNull();
  });

  it("never stores the link's token: only a fingerprint that cannot open the invitation", async () => {
    rsvp.mockResolvedValue({ ok: true, reply: "declined" });
    await sendReply(token, { ...reply, accept: false }, null);
    const stored = localStorage.getItem(INVITATION_REPLIES_KEY) ?? "";
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.slice(0, 12));
    expect(Object.keys(JSON.parse(stored))).toEqual([fingerprint(token)]);
    expect(isWellFormedToken(fingerprint(token))).toBe(false);
  });

  it("does not remember a reply the server refused", async () => {
    rsvp.mockResolvedValue({ ok: false, reason: "invalid" });
    await sendReply(token, reply, "Summit");
    expect(repliedBefore(token)).toBeNull();
  });

  it("gives each link its own, stable fingerprint", () => {
    expect(fingerprint(token)).toBe(fingerprint(token));
    const prints = new Set(Array.from({ length: 500 }, (_, i) => fingerprint(`${token}${i}`)));
    expect(prints.size).toBe(500);
  });

  it("asks for the invited address on every reply, and a name only to accept", () => {
    expect(validateReply("", "", false)).toEqual({ email: "Enter the address your invitation was sent to." });
    expect(validateReply("ada@example.com", "", false)).toEqual({});
    expect(validateReply("ada@example.com", "", true)).toHaveProperty("name");
    expect(validateReply("ada", "Ada", true)).toHaveProperty("email");
  });
});
