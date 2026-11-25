/**
 * A failing request is logged as one redacted line (roadmap fault 18; found bringing the API up on
 * PostgreSQL 17): never the error object, whose Drizzle wrapper carries the query parameters and whose
 * driver error can carry the client and its connection settings, password included.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());

describe("error logging", () => {
  it("a database failure behind a request logs its SQLSTATE, not its parameters or credentials", async () => {
    const organiser = (await h.login(h.seed.emails.organiser)).access_token;
    const events = h.app.ctx.repos.events as unknown as { listAll: (...a: unknown[]) => Promise<unknown> };
    const original = events.listAll;
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_hash_uq"'), {
      code: "23505", severity: "ERROR", routine: "_bt_check_unique", detail: "Key (email_hash)=(a1b2c3) already exists.",
      client: { connectionParameters: { user: "api_login", password: "s3cret-db-password" } },
    });
    events.listAll = async () => {
      throw Object.assign(new Error("Failed query: select * from events where title ilike $1\nparams: %visitor@example.org%"), { cause: pgError });
    };
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x) ?? String(x))).join(" "));
    try {
      const r = await h.call<{ error: { code: string } }>("GET", "/events?scope=all", { token: organiser });
      expect(r.status).toBe(500);
      expect(r.body.error.code).toBe("INTERNAL");
    } finally {
      console.error = orig;
      events.listAll = original;
    }
    const text = logged.join("\n");
    expect(text).toContain('GET /api/v1/events failed: pg 23505 ERROR _bt_check_unique: duplicate key value violates unique constraint "users_email_hash_uq"');
    for (const secret of ["s3cret-db-password", "visitor@example.org", "a1b2c3", "params", "select * from"]) expect(text).not.toContain(secret);
  });
});
