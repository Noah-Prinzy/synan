/**
 * The product name, in one place. Everything that carries the name on the wire derives from here,
 * so a rename is a one-line change. UI copy in `errors/` deliberately does not use the name.
 */
export const BRAND = {
  /** Display name. */
  name: "Synan",
  /** Lowercase machine form: protocol names, issuers, prefixes. [a-z0-9-] only. */
  slug: "synan",
  /** Two-letter abbreviation used in compact wire prefixes (QR text prefix, ticket subprotocol). */
  abbrev: "sy",
} as const;

/** WebSocket application subprotocol (P-16). */
export const WS_SUBPROTOCOL = `${BRAND.slug}.v1` as const;
/** Prefix of the subprotocol entry that carries the single-use ticket. */
export const WS_TICKET_PREFIX = `${BRAND.abbrev}t.` as const;
// QR text prefixes (QR_PREFIX_PORTAL / QR_PREFIX_EMAIL) derive from BRAND.abbrev in ./qr.
