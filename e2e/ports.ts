/**
 * Every address the end-to-end stack listens on. Fixed so the apps can be built with the API's
 * origin baked in (VITE_API_URL is a build-time constant). Override the whole block with
 * E2E_PORT_BASE (default 5400: the API on 5400 … the scanner on 5412).
 */
const base = Number(process.env.E2E_PORT_BASE ?? 5400);
if (!Number.isInteger(base) || base < 1024 || base > 65000) throw new Error(`E2E_PORT_BASE must be a port number, got ${process.env.E2E_PORT_BASE}`);

export const HOST = "127.0.0.1";

export const PORTS = {
  api: base,
  /** Test-only control server (mail sink, clock, jobs). Never part of the product. */
  control: base + 1,
  attendee: base + 10,
  admin: base + 11,
  scanner: base + 12,
} as const;

const origin = (port: number) => `http://${HOST}:${port}`;

export const ORIGINS = {
  api: origin(PORTS.api),
  control: origin(PORTS.control),
  attendee: origin(PORTS.attendee),
  admin: origin(PORTS.admin),
  scanner: origin(PORTS.scanner),
} as const;

/** Where each app lives (the admin and the scanner are built with a base path). */
export const APP_URLS = {
  attendee: `${ORIGINS.attendee}/`,
  admin: `${ORIGINS.admin}/admin/`,
  scanner: `${ORIGINS.scanner}/scan/`,
} as const;
