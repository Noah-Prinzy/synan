/** Production configuration names every app and API address, and only over TLS (review F4). */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("production addresses", () => {
  it("F4: in production every app and API address must be named, and https", () => {
    const prod = {
      NODE_ENV: "production", ACCESS_TOKEN_PRIVATE_JWK: "{}", MAIL_TRANSPORT: "memory", REPO: "postgres",
      DATABASE_URL: "postgres://api@db/app", DATABASE_VAULT_URL: "postgres://vault@db/app", DATABASE_SCAN_URL: "postgres://scan@db/app",
      DB_DATA_KEYS: "k1:AAAA", DB_BLIND_INDEX_KEYS: "bi1:AAAA",
      ADMIN_APP_URL: "https://ops.example.test/admin", SCANNER_APP_URL: "https://ops.example.test/scan", ATTENDEE_APP_ORIGIN: "https://example.test",
      API_PUBLIC_ORIGIN: "https://api.example.test", ALLOWED_ORIGINS: "https://example.test,https://ops.example.test",
    };
    expect(loadConfig(prod, [])).toMatchObject({ adminAppUrl: "https://ops.example.test/admin", scannerAppUrl: "https://ops.example.test/scan" });
    for (const k of ["ADMIN_APP_URL", "SCANNER_APP_URL", "ATTENDEE_APP_ORIGIN", "API_PUBLIC_ORIGIN", "ALLOWED_ORIGINS"] as const) {
      const { [k]: _gone, ...without } = prod;
      expect(() => loadConfig(without, []), `${k} missing`).toThrow(new RegExp(`${k} is required in production`));
      const plain = k === "ALLOWED_ORIGINS" ? "https://example.test,http://ops.example.test" : prod[k].replace("https:", "http:");
      expect(() => loadConfig({ ...prod, [k]: plain }, []), `${k} over http`).toThrow(new RegExp(`${k} must be an https:// URL in production`));
    }
    // Outside production the development defaults (http, localhost) still start.
    expect(() => loadConfig({}, [])).not.toThrow();
  });
});
