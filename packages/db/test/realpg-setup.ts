/**
 * Setup file of the `realpg` mode (vitest.config.ts): every real-server database a test file made and
 * did not close is dropped after that file.
 */
import { afterAll } from "vitest";
import { realPgDatabases } from "./helpers";

afterAll(async () => {
  for (const d of realPgDatabases.splice(0)) await d.drop().catch(() => undefined);
});
