import { existsSync } from "node:fs";
// Local, uncommitted settings (see .env.example). Real environment variables win.
if (existsSync(".env")) process.loadEnvFile(".env");

import { createApp } from "./app.js";
import { API_BRAND } from "./brand.js";

const tag = `[${API_BRAND.serviceName}]`;
const app = await createApp();
const url = await app.listen();
console.log(`${tag} listening on ${url} (repo=${app.ctx.repos.kind}, ${app.notImplemented.length} endpoints answer 501)`);
if (app.seed) {
  const s = app.seed;
  console.log(
    `${tag} dev seed: operators ${s.emails.admin} / ${s.emails.organiser}; gate users ${Object.values(s.gates).map((g) => g.email).join(", ")}\n` +
      `${tag} dev seed: password from DEV_SEED_PASSWORD (default "${API_BRAND.dev.defaultPassword}")\n` +
      `${tag} dev seed: admin TOTP secret ${s.adminMfaSecret} (random per start). Live event slug "${s.eventSlug}".`,
  );
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
