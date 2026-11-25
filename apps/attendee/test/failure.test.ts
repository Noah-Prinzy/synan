/**
 * How a failed call becomes words on the attendee's screen (data/failure.ts, data/failure-copy.ts):
 * every code the API can send has its contracts copy, an offline phone says so, and anything else
 * degrades to the generic message instead of a blank or a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_COPY } from "@synan/contracts/copy";
import { ErrorCode } from "@synan/contracts/errors";
import { ApiFailure, failureKind, isFailure } from "../src/data/failure";
import { failureCopy } from "../src/data/failure-copy";

let onLine = true;
beforeEach(() => {
  onLine = true;
  vi.stubGlobal("navigator", {
    get onLine() {
      return onLine;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("failure copy", () => {
  it.each(ErrorCode.options)("shows the contracts' words for %s", (code) => {
    const copy = failureCopy(new ApiFailure(code, ERROR_COPY[code].status));
    expect(copy).toEqual({ title: ERROR_COPY[code].title, message: ERROR_COPY[code].message });
    expect(copy.title.trim()).not.toBe("");
    expect(copy.message.trim()).not.toBe("");
  });

  it("says 'You're offline.' when nothing could be sent, and whenever the phone itself is offline", () => {
    expect(failureCopy(new ApiFailure("OFFLINE", 0))).toEqual({ title: "You're offline.", message: "You're offline." });
    onLine = false;
    // Even a server answer read while the phone went offline is shown as offline: the next step is the connection.
    expect(failureCopy(new ApiFailure("CONFLICT", 409))).toEqual({ title: "You're offline.", message: "You're offline." });
  });

  it("falls back to the generic message for no answer while online, a thrown non-API error, or nothing at all", () => {
    const generic = { title: ERROR_COPY.INTERNAL.title, message: ERROR_COPY.INTERNAL.message };
    expect(failureCopy(new ApiFailure("NETWORK", 0))).toEqual(generic);
    expect(failureCopy(new TypeError("Failed to fetch"))).toEqual(generic);
    expect(failureCopy("boom")).toEqual(generic);
    expect(failureCopy(undefined)).toEqual(generic);
  });
});

describe("failure kind", () => {
  it("is offline only when nothing could be sent or the phone is offline; every other failure is an error", () => {
    expect(failureKind(new ApiFailure("OFFLINE", 0))).toBe("offline");
    expect(failureKind(new ApiFailure("NETWORK", 0))).toBe("error");
    expect(failureKind(new ApiFailure("INTERNAL", 500))).toBe("error");
    expect(failureKind(new Error("x"))).toBe("error");
    onLine = false;
    expect(failureKind(new ApiFailure("INTERNAL", 500))).toBe("offline");
  });

  it("matches a failure by any of the codes given, or any failure with none given", () => {
    const failure = new ApiFailure("NO_CREDENTIAL", 404);
    expect(isFailure(failure)).toBe(true);
    expect(isFailure(failure, "NOT_FOUND", "NO_CREDENTIAL")).toBe(true);
    expect(isFailure(failure, "NOT_FOUND")).toBe(false);
    expect(isFailure(new Error("NO_CREDENTIAL"), "NO_CREDENTIAL")).toBe(false);
  });
});
