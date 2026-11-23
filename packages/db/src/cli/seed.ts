/** `corepack pnpm --filter ./packages/db db:seed` — seeds an empty, migrated $DATABASE_URL. */
import { createDb } from "../client";
import { seed } from "../seed/index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const db = createDb(url);
try {
  const summary = await seed(db);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.$client.end();
}
