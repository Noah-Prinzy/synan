/** Response security headers (03 §3): on every response, errors included; HSTS in production only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./helpers.js";

const HARDENING = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
};

describe("response security headers (development)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  it("every response — public, authenticated, error, not found, preflight — carries the hardening headers and no HSTS", async () => {
    const token = (await h.login(h.seed.emails.organiser)).access_token;
    const responses = [
      await h.call("GET", "/time"),
      await h.call("GET", "/dashboard", { token }),
      await h.call("GET", "/dashboard"), // 401
      await h.call("GET", "/no-such-route"),
      await h.call("POST", "/auth/login", { body: "{bad json" }),
      await h.call("OPTIONS", "/time", { headers: { origin: "http://localhost:5173" } }),
    ];
    for (const r of responses) {
      for (const [k, v] of Object.entries(HARDENING)) expect(r.headers.get(k), `${k} on ${r.status}`).toBe(v);
      const csp = r.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(r.headers.get("strict-transport-security")).toBeNull();
    }
    // CORS for the dev servers is unchanged.
    expect(responses[5]!.status).toBe(204);
    expect(responses[5]!.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("response security headers (production)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({
      config: {
        production: true, mailTransport: "memory",
        // Production names every address, TLS only (config.ts).
        adminAppUrl: "https://ops.example.test/admin", scannerAppUrl: "https://ops.example.test/scan", attendeeAppOrigin: "https://example.test",
        publicApiOrigin: "https://api.example.test", allowedOrigins: ["https://example.test", "https://ops.example.test"],
      },
    });
  });
  afterAll(async () => h.close());

  it("sends Strict-Transport-Security in production", async () => {
    for (const r of [await h.call("GET", "/time"), await h.call("GET", "/no-such-route")]) {
      expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});
