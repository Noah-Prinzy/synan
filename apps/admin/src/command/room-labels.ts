/**
 * A room's name on the map, from its full form to its shortest clear one (moved here unchanged
 * from zone-map.tsx so it can be tested without the map).
 */

/** Words that say what kind of space a room is, dropped first when its name must shorten. */
const GENERIC = new Set(["room", "lounge", "hall", "floor", "stage", "bar", "booth", "suite", "court", "desk", "point", "area"]);

const singular = (word: string) => word.toLowerCase().replace(/s$/, "");

/**
 * A room's name from longest to shortest, each still a whole word or a clear abbreviation:
 *   "Workshop C" in zone "Workshops"  → "C"        (the zone already says "Workshop")
 *   "Quiet Room", "Partner Lounge"    → "Quiet", "Partner"
 *   "Boardroom", "Cloakroom"          → "Board", "Cloak"
 *   "Speaker Green Room"              → "Speaker Green" → "Speaker" (when no other room starts so)
 * and last the initials ("PL"). The full name is always in the hover card, the list and the
 * aria-label. `firstWords` counts, over the venue's rooms, how many names start with each word
 * (lower-case).
 */
export function labelCandidates(name: string, zoneName: string, firstWords: Map<string, number>): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const zoneWords = new Set(zoneName.split(/\s+/).map(singular));
  const out: string[] = [name.trim()];
  const withoutZone = words.filter((w) => !zoneWords.has(singular(w)));
  if (withoutZone.length > 0 && withoutZone.length < words.length) out.push(withoutZone.join(" "));
  const withoutGeneric = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  if (withoutGeneric.length > 0 && withoutGeneric.length < words.length) out.push(withoutGeneric.join(" "));
  const compound = words.map((w) => (/^.{3,}room$/i.test(w) ? w.slice(0, -4) : w));
  if (compound.join(" ") !== words.join(" ")) out.push(compound.filter((w) => !GENERIC.has(w.toLowerCase())).join(" ") || compound.join(" "));
  const first = words[0] ?? "";
  if (words.length > 1 && (firstWords.get(first.toLowerCase()) ?? 0) === 1 && !GENERIC.has(first.toLowerCase())) out.push(first);
  if (words.length > 1) out.push(words.map((w) => (/^\d+$/.test(w) ? w : w[0]?.toUpperCase() ?? "")).join(""));
  return [...new Set(out.filter(Boolean))];
}
