import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND_PUBLIC_DIR, brandHtml } from "../../packages/ui/src/brand/name";

// Installable PWA (vite-plugin-pwa, IndexedDB queue) arrives in Phase 3 (docs/07 §2).
export default defineConfig({
  base: "/scan/",
  publicDir: BRAND_PUBLIC_DIR,
  plugins: [react(), tailwindcss(), brandHtml("scanner")],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5175 },
});
