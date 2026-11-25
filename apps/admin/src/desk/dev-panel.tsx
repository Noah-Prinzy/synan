/**
 * Development only: drive the desk's states without hardware. "Scan" buttons type a demo band
 * into the band field on screen and press Enter, as a USB reader does. Not in production builds
 * (the screen renders it only under DEV_TOOLS, on the mock) and drawn dashed, like the other dev tools.
 */
import { useState } from "react";
import { desk } from "./desk-api";
import { simulateScan } from "./scan";
import { setMockOffline, useOffline } from "./use-online";

const SCANS = [
  { kind: "stock", label: "Stock band" },
  { kind: "unknown", label: "Unknown band" },
  { kind: "not_in_stock", label: "Not in stock" },
  { kind: "bound_elsewhere", label: "Bound to someone else" },
] as const;

export function DeskDevPanel({ onStockChanged }: { onStockChanged: () => void }) {
  const offline = useOffline();
  const [note, setNote] = useState<string | null>(null);
  const button =
    "min-h-8 px-2.5 text-left text-12 transition-colors duration-120 hover:border-foreground/50 disabled:opacity-40";
  return (
    <details className="mx-4 mt-10 mb-6 border border-dashed border-foreground/30 text-12 sm:mx-6 2xl:mx-8">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-muted-foreground">
        <span className="font-mono text-11 tracking-[0.12em] text-foreground">DEV</span> Mock desk: scan a demo band, go offline
      </summary>
      <div className="flex flex-col gap-3 border-t border-dashed border-foreground/30 px-3 py-3">
        <div>
          <p className="mb-2 text-12 text-muted-foreground">Scan into the band field on screen (as a reader would: types, then Enter)</p>
          <div className="flex flex-wrap gap-1">
            {SCANS.map((scan) => (
              <button
                key={scan.kind}
                type="button"
                className={button}
                // Keep focus in the band field, where a reader types.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const uid = desk.mock.sampleBand(scan.kind);
                  setNote(simulateScan(uid) ? `Scanned ${uid}` : "Open someone's bind, rebind or lost-band step first.");
                }}
              >
                {scan.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={button} onClick={() => setMockOffline(!desk.mock.isOffline())}>
            {desk.mock.isOffline() ? "Back online" : "Go offline"}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              desk.mock.expireMfa();
              setNote("The second factor will be asked again.");
            }}
          >
            Forget second factor
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              desk.mock.setStock(12);
              onStockChanged();
              setNote("The box now holds 12 bands.");
            }}
          >
            Nearly out of bands
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              desk.mock.failNext("INTERNAL");
              setNote("The next desk call fails with a server error.");
            }}
          >
            Next call fails
          </button>
        </div>
        <p className="text-12 text-muted-foreground" role="status">
          {note ?? (offline ? "Offline." : "Second factor: any six digits except 000000.")}
        </p>
      </div>
    </details>
  );
}
