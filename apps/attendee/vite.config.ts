import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND_PUBLIC_DIR, brandHtml } from "../../packages/ui/src/brand/name";
import { pwa } from "../../packages/ui/src/components/mobile/pwa-plugin";

export default defineConfig({
  publicDir: BRAND_PUBLIC_DIR,
  plugins: [
    react(),
    tailwindcss(),
    brandHtml("attendee"),
    // Installable, and the pass opens offline (docs/06 A4): a hand-written manifest and
    // service worker (packages/ui mobile/pwa-plugin.ts) instead of vite-plugin-pwa (D-17),
    // so the lockfile is unchanged. Active in production builds only.
    pwa({
      surface: "attendee",
      base: "/",
      // The home-screen icon's job is the pass at the door; sign-in redirects back to it.
      startPath: "pass",
      shortName: "Synan",
      description: "Your pass, your agenda and the venue's updates.",
      shortcuts: [
        { name: "My pass", path: "pass" },
        { name: "Agenda", path: "agenda" },
      ],
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5173 },
});
