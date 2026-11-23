/**
 * Every runtime use of the product name in the API derives from here (and BRAND in the contracts).
 * A rename changes `BRAND` in packages/contracts/src/brand.ts; nothing in this file needs editing.
 */
import { BRAND } from "@synan/contracts/brand";

export { BRAND };

export const API_BRAND = {
  /** JWT `iss` / `aud` of access tokens. Changing these invalidates tokens issued under the old values. */
  tokenIssuer: BRAND.slug,
  tokenAudience: `${BRAND.slug}-api`,
  /** Service name in logs. */
  serviceName: `${BRAND.slug}-api`,
  mail: {
    signInSubject: `Your ${BRAND.name} sign-in link`,
    signInIntro: `Sign in to ${BRAND.name}:`,
    passSubject: (eventTitle: string) => `Your pass for ${eventTitle}`,
  },
  /** Dev/test fixtures only. */
  dev: {
    emailDomain: `${BRAND.slug}.dev`,
    defaultPassword: `${BRAND.slug}-dev`,
    orgName: `${BRAND.name} Demo`,
    liveEventSlug: `${BRAND.slug}-live-2026`,
    liveEventTitle: `${BRAND.name} Live 2026`,
  },
} as const;

/** `local@<dev domain>` — the address shape used by the dev seed and tests. */
export const devEmail = (local: string) => `${local}@${API_BRAND.dev.emailDomain}`;
