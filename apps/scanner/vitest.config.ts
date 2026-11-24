import { defineConfig } from "vitest/config";

// Unit tests for the offline core (data/api): Node's WebCrypto has Ed25519, and fake-indexeddb
// stands in for the browser's IndexedDB. The app's Vite plugins are not needed here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
