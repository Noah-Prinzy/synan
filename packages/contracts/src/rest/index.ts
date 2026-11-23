/**
 * REST contracts (02 §5). Every endpoint in 02 §5 has an entry in `endpoints`,
 * whether or not the server implements it yet.
 */
import { authEndpoints } from "./auth.js";
import { credentialEndpoints } from "./credentials.js";
import type { EndpointDef } from "./endpoint.js";
import { eventEndpoints } from "./events.js";
import { meEndpoints } from "./me.js";
import { registrationEndpoints } from "./registration.js";
import { scanEndpoints } from "./scans.js";
import { reportEndpoints, staffEndpoints } from "./staff.js";
import { venueEndpoints } from "./venue.js";

export * from "./endpoint.js";
export * from "./auth.js";
export * from "./venue.js";
export * from "./events.js";
export * from "./registration.js";
export * from "./credentials.js";
export * from "./scans.js";
export * from "./staff.js";
export * from "./me.js";

/** The complete endpoint registry, keyed by a stable operation name. */
export const endpoints = {
  ...authEndpoints,
  ...venueEndpoints,
  ...eventEndpoints,
  ...registrationEndpoints,
  ...credentialEndpoints,
  ...scanEndpoints,
  ...staffEndpoints,
  ...reportEndpoints,
  ...meEndpoints,
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;
