/**
 * USB and Bluetooth NFC readers type the band number and press Enter, like a keyboard
 * (docs/01 §2, D-09). On the scan screen such input is caught without a field having
 * focus: hex characters arriving fast, then Enter. A person typing is far slower, so
 * ordinary keys are never mistaken for a read.
 */
import { useEffect, useRef } from "react";

const MAX_GAP_MS = 60;

export function useReaderKeys(enabled: boolean, onRead: (raw: string) => void) {
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const now = performance.now();
      if (now - last > MAX_GAP_MS) buffer = "";
      last = now;
      if (event.key === "Enter") {
        if (buffer.replace(/[:\s-]/g, "").length >= 8) {
          event.preventDefault();
          onReadRef.current(buffer);
        }
        buffer = "";
        return;
      }
      if (/^[0-9a-fA-F:]$/.test(event.key)) buffer += event.key;
      else buffer = "";
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
