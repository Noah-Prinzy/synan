/**
 * Event-local time (docs/01 §9): stored in UTC, shown and edited in the event's own zone,
 * with the zone labelled. These helpers convert between an ISO instant and the
 * `YYYY-MM-DDTHH:mm` value a datetime-local input holds, in any IANA zone — not the browser's.
 */

const partsFormats = new Map<string, Intl.DateTimeFormat>();

function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = partsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormats.set(timeZone, format);
  }
  return format;
}

function wallParts(at: number, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of partsFormat(timeZone).formatToParts(new Date(at))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** Offset of a zone from UTC at an instant, in ms (local − UTC). */
export function zoneOffset(at: number, timeZone: string): number {
  const p = wallParts(at, timeZone);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0);
  return asUtc - Math.floor(at / 60_000) * 60_000;
}

const pad = (n: number | undefined) => String(n ?? 0).padStart(2, "0");

/** ISO instant → `2026-11-25T10:00` in the zone, for a datetime-local input. Empty for null. */
export function toLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const p = wallParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `2026-11-25T10:00` read as wall time in the zone → ISO instant. Null when empty or invalid. */
export function fromLocalInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let at = wall - zoneOffset(wall, timeZone);
  at = wall - zoneOffset(at, timeZone); // second pass settles a DST edge
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** "Wed 25 Nov 2026" in the zone. */
export function formatDate(iso: string | null, timeZone: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: options.weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: options.year === false ? undefined : "numeric",
    timeZone,
  });
}

/** "25–27 Nov 2026", "30 Nov – 2 Dec 2026", or "Dates not set". */
export function formatDateRange(start: string | null, end: string | null, timeZone: string): string {
  if (!start || !end) return "Dates not set";
  const a = wallParts(Date.parse(start), timeZone);
  const b = wallParts(Date.parse(end), timeZone);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return formatDate(start, timeZone);
  if (a.year === b.year && a.month === b.month) {
    return `${a.day}–${formatDate(end, timeZone)}`;
  }
  if (a.year === b.year) return `${formatDate(start, timeZone, { year: false })} – ${formatDate(end, timeZone)}`;
  return `${formatDate(start, timeZone)} – ${formatDate(end, timeZone)}`;
}

/** "14:30" in the zone. */
export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}

/** "25 Nov, 14:30" in the zone — for "last edited" columns. */
export function formatStamp(iso: string, timeZone: string): string {
  return `${formatDate(iso, timeZone, { year: false })}, ${formatTime(iso, timeZone)}`;
}

/** "EAT · UTC+3" — the zone's short name and offset, to label event-local times. */
export function zoneLabel(timeZone: string, at = Date.now()): string {
  const minutes = Math.round(zoneOffset(at, timeZone) / 60_000);
  const sign = minutes < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const offset = `UTC${sign}${h}${m ? `:${pad(m)}` : ""}`;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return `${city} · ${offset}`;
}

let zones: string[] | null = null;

/** Every IANA zone the browser knows, for a time-zone picker. */
export function allTimeZones(): string[] {
  if (!zones) {
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch {
      zones = ["Africa/Kampala", "Africa/Nairobi", "Africa/Lagos", "Africa/Johannesburg", "Europe/London", "UTC"];
    }
  }
  return zones;
}
