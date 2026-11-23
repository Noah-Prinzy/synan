import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND_PUBLIC_DIR, brandHtml } from "../../packages/ui/src/brand/name";
import { pwa } from "../../packages/ui/src/components/mobile/pwa-plugin";

// Installable: a hand-written manifest and service worker (packages/ui mobile/pwa-plugin.ts)
// stand in for vite-plugin-pwa (D-17) so the lockfile is unchanged. The IndexedDB scan
// queue arrives with the real ingest in Phase 3; the mock keeps its queue in localStorage.
export default defineConfig({
  base: "/scan/",
  publicDir: BRAND_PUBLIC_DIR,
  plugins: [
    react(),
    tailwindcss(),
    brandHtml("scanner"),
    pwa({
      surface: "scanner",
      base: "/scan/",
      startPath: "",
      shortName: "Gate",
      description: "Scan passes and wristbands at a gate.",
      // Phones hold portrait from code once installed (lockPortraitOnPhones); tablets rotate.
      orientation: "any",
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5175 },
});
