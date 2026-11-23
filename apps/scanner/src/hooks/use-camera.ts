/**
 * The perimeter viewfinder: the rear camera, QR decoding with the browser's own
 * BarcodeDetector (Chrome on Android; no library, no lockfile change), and the torch.
 * The camera stops whenever the app is hidden and starts again when it returns, so a
 * pocketed phone is not filming and the battery lasts the shift.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "starting" | "live" | "denied" | "unavailable" | "no-decoder" | "stopped";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Torch is in Chrome on Android, not yet in the DOM typings. */
type TorchTrack = Omit<MediaStreamTrack, "getCapabilities"> & {
  getCapabilities?: () => { torch?: boolean };
};

/** How often a frame is decoded. Fast enough to feel instant, light on the battery. */
const DECODE_EVERY_MS = 120;
/** The same code held in front of the camera is reported once per this window. */
const SAME_CODE_MS = 2500;

export function useCamera(enabled: boolean, onCode: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("stopped");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      setStatus("stopped");
      return;
    }
    let cancelled = false;
    let raf = 0;
    let lastDecode = 0;
    let lastText = "";
    let lastAt = 0;
    const Ctor = (window as Window & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!detector || !video || video.readyState < 2 || time - lastDecode < DECODE_EVERY_MS) return;
      lastDecode = time;
      detector
        .detect(video)
        .then((codes) => {
          const text = codes[0]?.rawValue;
          if (!text || cancelled) return;
          const now = performance.now();
          if (text === lastText && now - lastAt < SAME_CODE_MS) return;
          lastText = text;
          lastAt = now;
          onCodeRef.current(text);
        })
        .catch(() => {});
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      setStatus("starting");
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          await video.play().catch(() => {});
        }
        const track = media.getVideoTracks()[0] as TorchTrack | undefined;
        setTorchAvailable(Boolean(track?.getCapabilities?.().torch));
        setStatus(detector ? "live" : "no-decoder");
        if (detector) raf = requestAnimationFrame(loop);
      } catch (error) {
        const name = (error as { name?: string }).name;
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
        stop();
        setStatus("stopped");
      } else if (!stream.current) {
        void start();
      }
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [enabled, stop]);

  const toggleTorch = useCallback(async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  return { videoRef, status, torch: { available: torchAvailable, on: torchOn, toggle: toggleTorch } };
}
