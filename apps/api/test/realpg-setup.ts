/**
 * Setup file of the `realpg` mode (vitest.config.ts): any real-server database a test file created and
 * did not release (an app never closed, a test that failed before its cleanup) is dropped after the file.
 */
import { afterAll } from "vitest";
import { openRealPgDatabases } from "./helpers.js";

afterAll(async () => {
  for (const d of [...openRealPgDatabases]) {
    openRealPgDatabases.delete(d);
    await d.drop().catch(() => undefined);
  }
});
