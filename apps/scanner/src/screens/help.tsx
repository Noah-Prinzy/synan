/**
 * S5 · Reference (docs/06 §3.2): one screen, no nested navigation — what the colours mean,
 * when to call a supervisor, how to switch gates, how to end a shift — plus this device's
 * sound and vibration. Every word on a verdict comes from the contracts' scan-result copy.
 */
import { Link, useNavigate } from "react-router-dom";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import type { ScanResult } from "@synan/contracts/enums";
import { setPreference, useScanner } from "../data/store";
import { announce, unlockAudio } from "../data/feedback";
import { toneGlyph, toneText } from "../components/verdict";

const groups: { title: string; meaning: string; results: ScanResult[] }[] = [
  { title: "Green", meaning: "Let them in.", results: ["admitted"] },
  { title: "Amber", meaning: "Let them in after a quick look.", results: ["already_inside"] },
  {
    title: "Red",
    meaning: "Do not let them in. The line under the word says what to do.",
    results: ["denied_room", "capacity_block", "revoked", "suspended", "unknown_token", "wristband_required", "pass_spent"],
  },
];

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (next: boolean) => void; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="pressable flex min-h-16 w-full items-center justify-between gap-4 border border-transparent border-b-border px-4 py-3 text-left sm:px-6"
    >
      <span>
        <span className="block text-17">{label}</span>
        <span className="block text-15 text-muted-foreground">{hint}</span>
      </span>
      <span className={`shrink-0 border px-3 py-1.5 text-15 ${on ? "border-brand text-foreground" : "border-border text-muted-foreground"}`}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );
}

export default function Help() {
  const { sound, vibrate, gateId } = useScanner();
  const navigate = useNavigate();
  const supervisor = (Object.keys(SCAN_RESULT_COPY) as ScanResult[]).filter(
    (result) => SCAN_RESULT_COPY[result].shownAtGate && /supervisor/i.test(SCAN_RESULT_COPY[result].instruction),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-6 pb-4 sm:px-6">
        <h1 className="text-28 font-medium leading-tight">How it works</h1>
        <p className="mt-1 text-15 text-muted-foreground">Read the colour first, then the line under the word.</p>
      </div>

      <section aria-label="What the colours mean" className="border-t border-border">
        {groups.map((group) => {
          const tone = SCAN_RESULT_COPY[group.results[0]!].tone;
          return (
            <div key={group.title} className="border-b border-border px-4 py-4 sm:px-6">
              <p className={`flex items-center gap-2 text-21 font-semibold ${toneText[tone]}`}>
                <span aria-hidden="true" className="font-mono">{toneGlyph[tone]}</span>
                {group.title}
              </p>
              <p className="mt-1 text-17">{group.meaning}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {group.results.map((result) => (
                  <li key={result} className="text-15">
                    <span className={`font-semibold tracking-tight ${toneText[tone]}`}>{SCAN_RESULT_COPY[result].label}</span>
                    <span className="text-muted-foreground"> — {SCAN_RESULT_COPY[result].instruction}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="supervisor" className="border-b border-border px-4 py-5 sm:px-6">
        <h2 id="supervisor" className="text-17 font-medium">When to call a supervisor</h2>
        <p className="mt-1 text-15 text-muted-foreground">
          On {supervisor.map((result) => SCAN_RESULT_COPY[result].label).join(", ")}, or whenever someone disputes a red
          result. Never argue at the gate.
        </p>
      </section>

      <section aria-labelledby="gate" className="border-b border-border">
        <h2 id="gate" className="px-4 pt-5 text-17 font-medium sm:px-6">Your gate and shift</h2>
        <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:px-6">
          <Link to="/pair" className="pressable flex min-h-14 items-center justify-center border border-border text-17">
            Switch gate
          </Link>
          <button
            type="button"
            disabled={!gateId}
            onClick={() => navigate("/", { state: { endShift: true } })}
            className="pressable min-h-14 border border-border text-17 disabled:opacity-40"
          >
            End shift
          </button>
        </div>
      </section>

      <section aria-labelledby="device">
        <h2 id="device" className="px-4 pt-5 pb-2 text-17 font-medium sm:px-6">This device</h2>
        <div className="border-t border-border">
          <Toggle
            label="Sound"
            hint="One beep to let in, two for amber, a low tone to refuse."
            on={sound}
            onChange={(next) => {
              setPreference("sound", next);
              if (next) {
                unlockAudio();
                announce("green", { sound: true, vibrate: false });
              }
            }}
          />
          <Toggle
            label="Vibration"
            hint="One tick to let in, two for amber, a long buzz to refuse."
            on={vibrate}
            onChange={(next) => {
              setPreference("vibrate", next);
              if (next) announce("green", { sound: false, vibrate: true });
            }}
          />
        </div>
        <p className="px-4 py-4 text-15 text-muted-foreground sm:px-6">
          The screen stays on while the scan screen is open.
        </p>
      </section>
    </div>
  );
}
