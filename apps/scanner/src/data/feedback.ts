/**
 * Haptics and tones per verdict (docs/06 S2: "distinct tones per verdict, default on").
 * Each tone can be told apart without looking: one short tick for a pass, two for amber,
 * a long low buzz for a refusal. Vibration API where present (Android); tones through
 * WebAudio, unlocked by the operator's first touch (browsers block sound before that).
 */
import type { GateTone } from "@synan/contracts/enums";
import { haptic } from "@synan/ui/components";

const VIBRATION: Record<GateTone, number | number[]> = {
  green: 30,
  amber: [30, 90, 30],
  red: [90, 60, 90, 60, 90],
  none: 0,
};

/** [frequency Hz, duration ms, gap after ms] */
const TONES: Record<GateTone, [number, number, number][]> = {
  green: [[1320, 90, 0]],
  amber: [[880, 80, 70], [880, 80, 0]],
  red: [[330, 320, 0]],
  none: [],
};

let audio: AudioContext | null = null;

/** Call from a touch or key handler once: browsers start audio only after a gesture. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function play(tone: GateTone): void {
  if (!audio || audio.state !== "running") return;
  let at = audio.currentTime + 0.01;
  for (const [frequency, duration, gap] of TONES[tone]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = tone === "red" ? "square" : "sine";
    osc.frequency.value = frequency;
    // Short ramps, no clicks.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(tone === "red" ? 0.12 : 0.25, at + 0.01);
    gain.gain.setValueAtTime(tone === "red" ? 0.12 : 0.25, at + duration / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, at + duration / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + duration / 1000 + 0.02);
    at += (duration + gap) / 1000;
  }
}

export function announce(tone: GateTone, options: { sound: boolean; vibrate: boolean }): void {
  if (options.vibrate && tone !== "none") haptic(VIBRATION[tone]);
  if (options.sound) play(tone);
}
