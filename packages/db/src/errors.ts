/**
 * Database errors, safe to log and to decide on.
 *
 * Drizzle wraps a driver error as "Failed query: <sql>\nparams: <values>" with the PostgreSQL error in
 * `cause`, so the wrapper's message carries query parameters (identifiers, hashes, sometimes personal
 * data), and the driver's error and client objects can carry connection settings, the password among
 * them. Decide on the SQLSTATE (`pgErrorCode`, through the whole cause chain), never on message text;
 * log `describeError`, never the raw object.
 */

type Chain = { cause?: unknown; code?: unknown; severity?: unknown; routine?: unknown; message?: unknown; name?: unknown };

/** Every error in the cause chain, outermost first (bounded). */
function chain(e: unknown): Chain[] {
  const out: Chain[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 6; x = (x as Chain).cause, i++) out.push(x as Chain);
  return out;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The PostgreSQL SQLSTATE of an error from node-postgres or PGlite, wrapped by Drizzle or not; undefined otherwise. */
export function pgErrorCode(e: unknown): string | undefined {
  for (const x of chain(e)) if (typeof x.code === "string" && SQLSTATE.test(x.code)) return x.code;
  return undefined;
}

/**
 * A server message with values left out: PostgreSQL quotes the offending value after a colon
 * ("invalid input syntax for type uuid: "…""), while names (constraints, tables, roles) follow a word.
 */
function redactServerMessage(m: string): string {
  return m.replace(/(:\s*)"[^"]*"/g, '$1"…"').replace(/(:\s*)'[^']*'/g, "$1'…'").slice(0, 200);
}

/**
 * One line for a log: for a PostgreSQL error its SQLSTATE, severity, routine and redacted message; for
 * any other error its name and message, with Drizzle's query text and parameters, connection URLs and
 * email addresses removed. Never the object itself.
 */
export function describeError(e: unknown): string {
  const links = chain(e);
  const pgErr = links.find((x) => typeof x.code === "string" && SQLSTATE.test(x.code) && typeof x.severity === "string");
  if (pgErr) {
    const parts = [`pg ${pgErr.code}`, String(pgErr.severity)];
    if (typeof pgErr.routine === "string") parts.push(pgErr.routine);
    return `${parts.join(" ")}: ${redactServerMessage(String(pgErr.message ?? ""))}`;
  }
  const first = links[0];
  if (!first) return String(e).slice(0, 200);
  let msg = String(first.message ?? e);
  if (/^Failed query:/.test(msg)) msg = "Failed query (text and parameters withheld)";
  const code = typeof first.code === "string" ? ` ${first.code}` : "";
  return `${String(first.name ?? "Error")}${code}: ${msg}`
    .replace(/\b(postgres(?:ql)?):\/\/[^\s"']+/gi, "$1://[url]")
    .replace(/[^\s<>"'@:/]+@[^\s<>"'@]+\.[a-z]{2,}/gi, "[address]")
    .slice(0, 300);
}
