/**
 * S2 · Scan (docs/06 §3.2). The gate decides how the screen is laid out (D-11):
 *   perimeter — the camera viewfinder for QR codes, wristband tap alongside;
 *   interior  — no camera: the screen is a tap target for wristbands, and a QR held up
 *               to it is answered "Wristband required" (via manual entry or a reader).
 * Under it, the verdict panel (minimum 2 s dwell). At the bottom, in thumb reach, the two
 * controls a staffer needs: type a number (123) and wristband reading (NFC). The torch
 * sits at the top right of the viewfinder. Portrait stacks; landscape sits side by side.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { QR_PREFIX_EMAIL, QR_PREFIX_PORTAL } from "@synan/contracts/qr";
import { useWakeLock } from "../../../../packages/ui/src/components/mobile";
import { gateById, type Gate } from "../data/mock";
import { decide, normaliseUid, useScanner, type Presented, type Scan as ScanRecord } from "../data/store";
import { announce } from "../data/feedback";
import { useCamera } from "../hooks/use-camera";
import { useNfc, type NfcStatus } from "../hooks/use-nfc";
import { useReaderKeys } from "../hooks/use-reader-keys";
import { VerdictPanel } from "../components/verdict";
import { ManualEntry } from "../components/manual-entry";
import { EndShift } from "../components/end-shift";

/** Minimum time a verdict stays on screen so the operator can read it (docs/05 §7). */
const DWELL_MS = 2000;

/** Shows each verdict for at least DWELL_MS; a newer one waits, then replaces it. */
function useDwell(onShow: (scan: ScanRecord) => void) {
  const [shown, setShown] = useState<ScanRecord | null>(null);
  const shownAt = useRef(0);
  const pending = useRef<ScanRecord | null>(null);
  const timer = useRef<number | null>(null);
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return {
    shown,
    push: useCallback((scan: ScanRecord) => {
      const show = (next: ScanRecord) => {
        setShown(next);
        shownAt.current = performance.now();
        onShowRef.current(next);
      };
      const waited = performance.now() - shownAt.current;
      if (waited >= DWELL_MS) return show(scan);
      pending.current = scan;
      timer.current ??= window.setTimeout(() => {
        timer.current = null;
        if (pending.current) show(pending.current);
        pending.current = null;
      }, DWELL_MS - waited);
    }, []),
  };
}

const nfcLabel: Record<NfcStatus, string> = {
  unsupported: "Not on this device",
  off: "Off — tap to start",
  starting: "Starting…",
  on: "On",
  denied: "Blocked in settings",
  failed: "Didn't start — tap to retry",
};

export default function Scan() {
  const { gateId, sound, vibrate } = useScanner();
  const gate = gateById(gateId) as Gate;
  const navigate = useNavigate();
  const location = useLocation();
  const [manualOpen, setManualOpen] = useState(false);
  const [repeat, setRepeat] = useState<string | null>(null);
  const manualButton = useRef<HTMLButtonElement>(null);

  // A gate device in use never dims or locks (re-acquired after the app returns).
  useWakeLock(true);

  const { shown, push } = useDwell((scan) => {
    setRepeat(null);
    announce(SCAN_RESULT_COPY[scan.result].tone, { sound, vibrate });
  });

  const handle = useCallback(
    (presented: Presented) => {
      const scan = decide(presented, gate);
      if (!SCAN_RESULT_COPY[scan.result].shownAtGate) {
        // Duplicate read: the standing verdict stays; say once, quietly, that it was seen.
        setRepeat(SCAN_RESULT_COPY[scan.result].instruction);
        if (vibrate) navigator.vibrate?.(10);
        return;
      }
      push(scan);
    },
    [gate, push, vibrate],
  );

  const onCode = useCallback((text: string) => handle({ medium: "qr", data: text }), [handle]);
  const onUid = useCallback(
    (raw: string) => {
      const uid = normaliseUid(raw);
      if (uid) handle({ medium: "nfc", uid });
    },
    [handle],
  );

  const camera = useCamera(gate.perimeter && !manualOpen, onCode);
  const nfc = useNfc(true, onUid);
  useReaderKeys(!manualOpen, onUid);

  const endShiftOpen = Boolean((location.state as { endShift?: boolean } | null)?.endShift);
  const closeEndShift = () => navigate(".", { replace: true, state: null });

  const submitManual = (value: string) => {
    const text = value.trim();
    if (text.startsWith(QR_PREFIX_PORTAL) || text.startsWith(QR_PREFIX_EMAIL)) {
      onCode(text);
      return true;
    }
    const uid = normaliseUid(text);
    if (!uid) return false;
    handle({ medium: "nfc", uid });
    return true;
  };

  const canTap = nfc.status !== "unsupported";
  const idleHint = gate.perimeter
    ? canTap
      ? "Hold the pass QR inside the square, or tap a wristband on the back of this phone."
      : "Hold the pass QR inside the square. For wristbands, use a reader or 123."
    : canTap
      ? "Waiting for a wristband."
      : "Waiting for a reader, or a number typed with 123.";

  return (
    <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
      {/* Input: camera (perimeter) or tap target (interior). Top ~55% in portrait. */}
      <div className="relative flex min-h-0 basis-[55%] flex-col border-b border-border [@media(max-height:700px)_and_(orientation:portrait)]:basis-[46%] landscape:basis-1/2 landscape:border-r landscape:border-b-0">
        {gate.perimeter ? (
          <Viewfinder camera={camera} />
        ) : (
          <TapTarget status={nfc.status} onStart={() => void nfc.start()} />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <VerdictPanel scan={shown} repeatNote={repeat} idleHint={idleHint} />

        {/* Thumb reach: the two controls, at the bottom edge, full-width halves. */}
        <div className="grid shrink-0 grid-cols-2 border-t border-border">
          <button
            ref={manualButton}
            type="button"
            onClick={() => setManualOpen(true)}
            className="pressable flex min-h-16 items-center justify-center gap-3 border border-transparent px-3 landscape:min-h-14"
          >
            <span className="font-mono text-21" aria-hidden="true">123</span>
            <span className="text-15">Type a number</span>
          </button>
          <button
            type="button"
            onClick={() => (nfc.status === "on" ? nfc.stop() : void nfc.start())}
            disabled={nfc.status === "unsupported" || nfc.status === "starting"}
            aria-pressed={nfc.status === "on"}
            className="pressable flex min-h-16 flex-col items-center justify-center border border-transparent border-l-border px-3 text-center disabled:opacity-100 landscape:min-h-14"
          >
            <span className="flex items-center gap-2 text-15">
              <span aria-hidden="true" className={`size-1.5 ${nfc.status === "on" ? "bg-success" : "bg-muted-foreground"}`} />
              Wristbands
            </span>
            <span className="text-13 text-muted-foreground">{nfcLabel[nfc.status]}</span>
          </button>
        </div>
      </div>

      <ManualEntry
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={submitManual}
        returnTo={manualButton}
        perimeter={gate.perimeter}
      />
      <EndShift open={endShiftOpen} onClose={closeEndShift} />
    </div>
  );
}

function Viewfinder({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const { status, videoRef, torch } = camera;
  const message: Partial<Record<typeof status, string>> = {
    starting: "Starting the camera…",
    denied: "The camera is blocked. Allow it in the browser's site settings, or use 123.",
    unavailable: "No camera found. Use 123 or tap wristbands.",
    "no-decoder": "This browser can't read QR codes. Use Chrome on Android, or type the number with 123.",
    stopped: "Camera paused.",
  };
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        className={`absolute inset-0 size-full object-cover ${status === "live" || status === "no-decoder" ? "" : "invisible"}`}
      />
      {/* Reticle: a thin foreground square, no chrome (docs/06 S2). */}
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <div className="aspect-square h-[62%] max-w-[78%] border border-foreground/70" />
      </div>
      {message[status] ? (
        <p role="status" className="absolute inset-x-0 bottom-0 bg-background/80 px-4 py-3 text-15">
          {message[status]}
        </p>
      ) : (
        <p className="sr-only" role="status">
          Camera on. Hold the QR code inside the square.
        </p>
      )}
      {torch.available ? (
        <button
          type="button"
          onClick={() => void torch.toggle()}
          aria-pressed={torch.on}
          className={`pressable absolute top-2 right-2 flex min-h-12 min-w-12 items-center justify-center border bg-background/70 px-3 text-15 ${
            torch.on ? "border-brand text-foreground" : "border-border text-muted-foreground"
          }`}
        >
          {torch.on ? "Torch on" : "Torch"}
        </button>
      ) : null}
    </div>
  );
}

function TapTarget({ status, onStart }: { status: NfcStatus; onStart: () => void }) {
  const listening = status === "on";
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div aria-hidden="true" className={`flex aspect-square h-[46%] max-h-56 items-center justify-center border ${listening ? "border-foreground/70" : "border-border"}`}>
        <span className="font-mono text-13 uppercase tracking-[0.12em] text-muted-foreground">NFC</span>
      </div>
      {status === "unsupported" ? (
        <p className="max-w-[30ch] text-15 text-muted-foreground">
          This device can't read wristbands. Use a USB or Bluetooth reader, or type the number with 123.
        </p>
      ) : listening ? (
        <p className="text-17">Tap the wristband on the back of the phone.</p>
      ) : status === "denied" ? (
        <p className="max-w-[30ch] text-15 text-muted-foreground">NFC is blocked for this site. Allow it in the browser's site settings.</p>
      ) : (
        <button type="button" onClick={onStart} className="pressable min-h-14 border border-border px-6 text-17">
          Start reading wristbands
        </button>
      )}
    </div>
  );
}
