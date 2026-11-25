/**
 * Where the other staff app lives, for the one hand-over between them: a security-staff activation
 * link opened here goes on to the Gate Scanner's activation page (the token stays in the fragment).
 * Build time: VITE_SCANNER_URL (origin and base path); by default the dev server, or `/scan` on the
 * same origin in a production build (01 §2 route roots).
 */
const env = import.meta.env.VITE_SCANNER_URL as string | undefined;
export const SCANNER_URL = (env?.trim() || (import.meta.env.DEV ? "http://localhost:5175/scan" : "/scan")).replace(/\/+$/, "");
