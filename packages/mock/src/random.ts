/** Seeded randomness, so every run of the mock produces the same world. */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for fixtures. Returns [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hex(rng: Rng, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

/** A v4-shaped UUID drawn from `rng`. */
export function uuidFrom(rng: Rng): string {
  const variant = "89ab"[Math.floor(rng() * 4)];
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-${variant}${hex(rng, 3)}-${hex(rng, 12)}`;
}

/** The same name always yields the same UUID. */
export function idFor(name: string): string {
  return uuidFrom(createRng(hashString(name)));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
