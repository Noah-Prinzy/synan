import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { BRAND_PUBLIC_DIR, brandHtml } from "../../packages/ui/src/brand/name";

export default defineConfig({
  publicDir: BRAND_PUBLIC_DIR,
  plugins: [react(), tailwindcss(), brandHtml("attendee")],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5173 },
});
