/** Date and time wording for the portal, always in the event's own time zone. */

export function formatDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso));
}

export function formatLongDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(new Date(iso));
}

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
}

export function dateParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: timezone }).formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: pick("weekday"), day: pick("day"), month: pick("month") };
}

/** A stable key for grouping by local calendar day. */
export function dayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(new Date(iso));
}

/** "Kampala time (GMT+3)" rather than "Africa/Kampala". */
export function zoneLabel(timezone: string, at: string | number = Date.now()): string {
  const city = (timezone.split("/").pop() ?? timezone).replace(/_/g, " ");
  const offset =
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(at))
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return offset ? `${city} time (${offset})` : `${city} time`;
}

/** "today", "tomorrow", "in 3 days". */
export function relativeDays(iso: string, now: number): string {
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
