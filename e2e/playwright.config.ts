import { defineConfig, devices } from "@playwright/test";
import { ORIGINS } from "./ports.ts";

const CI = !!process.env.CI;

/**
 * End-to-end journeys (docs/07 §2.6): the three apps built in real-API mode against one API on the
 * in-memory backend with the dev seed. `server/stack.ts` starts all of it; Playwright stops it.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./.results/artifacts",
  // One worker: the journeys share one API and one server clock, and the machine is shared.
  workers: Number(process.env.E2E_WORKERS ?? 1),
  fullyParallel: false,
  forbidOnly: CI,
  // Timeouts only: a rerun must pass for a journey to count (and the report shows it as flaky).
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./.results/report", open: "never" }],
    ["json", { outputFile: "./.results/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The apps register service workers in production builds; the journeys test the network path.
    serviceWorkers: "block",
    locale: "en-GB",
    timezoneId: "Africa/Kampala",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: undefined, headless: true },
    },
  ],
  webServer: {
    command: "node --import tsx server/stack.ts",
    url: `${ORIGINS.control}/health`,
    // Builds of all three apps take about 35 s on a developer machine.
    timeout: 240_000,
    reuseExistingServer: !CI,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
