/** Shared primitive schemas used across REST and WS contracts. */
import { z } from "zod";

/** Opaque resource identifier (UUID). Never sequential, never a credential token. */
/**
 * Canonicalised to lower case at the boundary: PostgreSQL compares uuids case-insensitively, so two
 * spellings of one id must never reach the server as different strings (locks, caches, maps).
 */
export const Id = z.uuid().overwrite((s) => s.toLowerCase());
export type Id = z.infer<typeof Id>;

/** ISO-8601 UTC timestamp string, e.g. `2026-11-23T10:00:00.000Z`. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** IANA timezone name, e.g. `Europe/London`. */
export const IanaTimezone = z.string().min(1).max(64);

/** URL-safe event slug. */
export const Slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens");
export type Slug = z.infer<typeof Slug>;

export const Email = z.email().max(254);

/** Opaque cursor pagination used by every list endpoint. */
export const PageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });

/** Empty body / 204-style acknowledgement. */
export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;

/** `credentials.zone_state`: `OUTSIDE` or `INSIDE_<zone_id>` (02 §4.3). */
export const ZoneState = z.union([z.literal("OUTSIDE"), z.string().regex(/^INSIDE_.+$/)]);
export type ZoneState = z.infer<typeof ZoneState>;

/** Path prefix for every REST endpoint (02 §5). */
export const API_BASE_PATH = "/api/v1" as const;
