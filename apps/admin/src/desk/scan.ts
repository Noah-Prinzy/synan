/**
 * Development: the mock's "scan a band" buttons type into the band field on screen, as a USB
 * reader would. The band field registers itself here while it is mounted.
 */
export type ScanTarget = (uid: string) => void;
export const scanTargets: ScanTarget[] = [];

/** Type `uid` into the band field on screen and press Enter, as a reader would. */
export function simulateScan(uid: string): boolean {
  const target = scanTargets.at(-1);
  if (!target) return false;
  target(uid);
  return true;
}
