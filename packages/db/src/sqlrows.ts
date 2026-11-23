/** Small shared helpers for the typed wrappers over SQL functions. */
import { sql, type SQL } from "drizzle-orm";
import type { AnyDb, AnyTx } from "./client";

export type DbOrTx = AnyDb | AnyTx;

export async function rows<T = Record<string, unknown>>(db: DbOrTx, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

export const tsOrNull = (d: Date | null | undefined) => (d ? sql`${d.toISOString()}::timestamptz` : sql`NULL::timestamptz`);
export const tsOrNow = (d: Date | null | undefined) => (d ? sql`${d.toISOString()}::timestamptz` : sql`now()`);
export const uuidOrNull = (v: string | null | undefined) => sql`${v ?? null}::uuid`;
export const intervalOrNull = (v: string | null | undefined) => sql`${v ?? null}::interval`;

export const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));
export const date = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
export const json = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** A page of results with the total number of rows matching the filters. */
export interface Page<T> {
  items: T[];
  total: number;
}

/** Time range (half-open, [from, to)) and pagination accepted by the report helpers. */
export interface RangeQuery {
  from?: Date | null;
  to?: Date | null;
}
export interface PageQuery {
  limit?: number;
  offset?: number;
}
