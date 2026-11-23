/** Injectable clock so expiry, windows and rollups are testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class ManualClock implements Clock {
  constructor(private t: number = Date.parse("2026-11-23T10:00:00.000Z")) {}
  now() {
    return this.t;
  }
  set(ms: number) {
    this.t = ms;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
