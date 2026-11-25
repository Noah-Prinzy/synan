/**
 * Where the Admin Command lives, for the one hand-over between the staff apps: an activation link
 * for a console role (or a speaker or crew member) opened here goes on to the Admin Command's own
 * activation page, the token still in the fragment. Build time: VITE_ADMIN_URL (origin and base
 * path); by default the dev server, or `/admin` on the same origin in a production build.
 */
const env = import.meta.env.VITE_ADMIN_URL as string | undefined;
export const ADMIN_URL = (env?.trim() || (import.meta.env.DEV ? "http://localhost:5174/admin" : "/admin")).replace(/\/+$/, "");
