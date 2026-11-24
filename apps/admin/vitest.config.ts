import { defineConfig } from "vitest/config";

// Unit tests for the logic a silent regression would hurt on event day. Node by default; a test
// file that needs the browser (storage, visibility, React rendering) opts into happy-dom with a
// `@vitest-environment happy-dom` comment. The app's Vite plugins are not needed here. Two workers
// at most: other work shares the machine.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    maxWorkers: 2,
    minWorkers: 1,
  },
});
