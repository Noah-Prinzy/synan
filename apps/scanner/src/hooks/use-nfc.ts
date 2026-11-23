/**
 * Wristband reading with Web NFC (Chrome on Android only, D-09). The first start needs a
 * tap from the operator (the browser asks for permission once); after that it starts on
 * its own whenever the scan screen opens. The browser pauses NFC while the page is hidden.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type NfcStatus = "unsupported" | "off" | "starting" | "on" | "denied" | "failed";

type Reader = {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  addEventListener(type: "reading", fn: (event: { serialNumber: string }) => void): void;
  addEventListener(type: "readingerror", fn: () => void): void;
};
type ReaderCtor = new () => Reader;

function ctor(): ReaderCtor | undefined {
  return (window as Window & { NDEFReader?: ReaderCtor }).NDEFReader;
}

export function nfcSupported(): boolean {
  return typeof window !== "undefined" && Boolean(ctor());
}

export function useNfc(wanted: boolean, onUid: (uid: string) => void, onUnreadable?: () => void) {
  const [status, setStatus] = useState<NfcStatus>(() => (nfcSupported() ? "off" : "unsupported"));
  const abort = useRef<AbortController | null>(null);
  const onUidRef = useRef(onUid);
  onUidRef.current = onUid;
  const onErrorRef = useRef(onUnreadable);
  onErrorRef.current = onUnreadable;

  const start = useCallback(async () => {
    const Reader = ctor();
    if (!Reader) return setStatus("unsupported");
    if (abort.current) return;
    setStatus("starting");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const reader = new Reader();
      reader.addEventListener("reading", (event) => onUidRef.current(event.serialNumber));
      reader.addEventListener("readingerror", () => onErrorRef.current?.());
      await reader.scan({ signal: controller.signal });
      setStatus("on");
    } catch (error) {
      abort.current = null;
      setStatus((error as { name?: string }).name === "NotAllowedError" ? "denied" : "failed");
    }
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    if (nfcSupported()) setStatus("off");
  }, []);

  // Start without a tap only when permission was already given; otherwise wait for one.
  useEffect(() => {
    if (!wanted || !nfcSupported()) return;
    let live = true;
    navigator.permissions
      ?.query({ name: "nfc" as PermissionName })
      .then((permission) => {
        if (live && permission.state === "granted") void start();
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [wanted, start, stop]);

  return { status, start, stop };
}
