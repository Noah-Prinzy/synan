/**
 * Database errors are decided on by SQLSTATE and logged without query parameters or connection
 * settings (src/errors.ts). Runs on PGlite and, in the realpg mode, on the real server.
 */
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { describeError, pgErrorCode } from "../src/errors";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a failure");
};

describe("database errors", () => {
  it("are read by SQLSTATE through Drizzle's wrapper", async () => {
    const e = await failure(db.execute(sql`select ${"secret-value-123"}::uuid`));
    expect(String((e as Error).message)).toMatch(/^Failed query/); // the wrapper, whose text carries the parameters
    expect(pgErrorCode(e)).toBe("22P02");
    const d = describeError(e);
    expect(d).toMatch(/^pg 22P02 ERROR/);
    expect(d).not.toContain("secret-value-123");
  });

  it("never log parameters, connection settings or addresses", () => {
    const wrapped = Object.assign(new Error("Failed query: select * from users where email_hash = $1\nparams: abc@example.org"), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint "users_email_hash_uq"'), {
        code: "23505", severity: "ERROR", routine: "_bt_check_unique", detail: "Key (email_hash)=(abcdef) already exists.",
        client: { connectionParameters: { password: "hunter2-password" } },
      }),
    });
    const d = describeError(wrapped);
    expect(d).toBe('pg 23505 ERROR _bt_check_unique: duplicate key value violates unique constraint "users_email_hash_uq"');
    const plain = describeError(new Error("Failed query: select $1\nparams: abc@example.org"));
    expect(plain).toBe("Error: Failed query (text and parameters withheld)");
    const conn = describeError(new Error("connect failed for postgres://api:hunter2-password@db:5432/app (mail ops@example.org)"));
    expect(conn).not.toContain("hunter2");
    expect(conn).not.toContain("ops@example.org");
    expect(pgErrorCode(new Error("x"))).toBeUndefined();
  });
});
