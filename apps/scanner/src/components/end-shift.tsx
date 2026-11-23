/**
 * Shift end (docs/06 §3.1): a dialog over /scan, not a route. It sums up the shift —
 * admitted, refused, still queued — and confirms the handover before the device lets go
 * of the gate.
 */
import { useNavigate } from "react-router-dom";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { ActionButton } from "@synan/ui/components";
import { endShift, useScanner } from "../data/store";
import { Sheet } from "./sheet";

export function EndShift({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scans, shiftStartedAt, gateId } = useScanner();
  const navigate = useNavigate();
  const shift = scans.filter((scan) => scan.gateId === gateId && scan.at >= (shiftStartedAt ?? 0));
  const admitted = shift.filter((scan) => SCAN_RESULT_COPY[scan.result].admits && scan.result !== "duplicate_read" && !scan.undone).length;
  const refused = shift.filter((scan) => !SCAN_RESULT_COPY[scan.result].admits).length;
  const waiting = scans.filter((scan) => !scan.synced).length;

  return (
    <Sheet open={open} onClose={onClose} title="End your shift?" placement="center">
      <dl className="mt-4 grid grid-cols-3 border border-border">
        {[
          ["Admitted", admitted],
          ["Refused", refused],
          ["Queued", waiting],
        ].map(([label, value], index) => (
          <div key={label as string} className={`px-3 py-3 ${index > 0 ? "border-l border-border" : ""}`}>
            <dt className="text-13 text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-mono text-28">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-15 text-muted-foreground">
        {waiting > 0
          ? "Scans still waiting are kept on this device and sent when it is back online. Hand it to your supervisor."
          : "Everything is sent. Hand the device to your supervisor."}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={onClose} className="pressable min-h-14 border border-border text-17">
          Keep scanning
        </button>
        <ActionButton
          variant="primary"
          className="min-h-14 text-17"
          doneLabel="Shift ended"
          keepDone
          action={async () => {
            endShift();
            await new Promise((resolve) => window.setTimeout(resolve, 500));
            navigate("/pair", { replace: true, state: { ended: true } });
          }}
        >
          End shift
        </ActionButton>
      </div>
    </Sheet>
  );
}
