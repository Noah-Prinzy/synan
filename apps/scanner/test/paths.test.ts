/** The client's path table must match the contracts' endpoint registry exactly. */
import { describe, expect, it } from "vitest";
import { endpoints } from "@synan/contracts/rest";
import { PATHS } from "../src/data/api/client";

describe("client paths", () => {
  it.each(Object.entries(PATHS))("%s matches endpoints", (name, def) => {
    const e = endpoints[name as keyof typeof endpoints];
    expect(e, name).toBeDefined();
    expect({ method: def.method, path: def.path }).toEqual({ method: e.method, path: e.path });
  });

  it("the allowlist JWS typ matches the contracts", async () => {
    const { ALLOWLIST_JWS_TYP } = await import("@synan/contracts/rest");
    const { ALLOWLIST_TYP } = await import("../src/data/api/crypto");
    expect(ALLOWLIST_TYP).toBe(ALLOWLIST_JWS_TYP);
  });
});
