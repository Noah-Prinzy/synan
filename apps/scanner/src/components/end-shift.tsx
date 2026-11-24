/**
 * Shift end (docs/06 §3.1): a dialog over /scan, not a route. It sums up the shift —
 * admitted, refused, still queued (API mode: and undone, the server's count once the handover
 * answers) — and confirms the handover before the device lets go of the gate.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { ActionButton } from "@synan/ui/components";
import { API_MODE } from "../data/api/config";
import { endShift, handOver, releaseGate, useScanner } from "../data/store";
import { Sheet } from "./sheet";

export function EndShift({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scans, shiftStartedAt, gateId } = useScanner();
  const navigate = useNavigate();
  // API mode: the server's count of admissions undone this shift, from the handover summary.
  const [serverUndone, setServerUndone] = useState<number | null>(null);
  const shift = scans.filter((scan) => scan.gateId === gateId && scan.at >= (shiftStartedAt ?? 0));
  const admitted = shift.filter((scan) => SCAN_RESULT_COPY[scan.result].admits && scan.result !== "duplicate_read" && !scan.undone).length;
  const refused = shift.filter((scan) => !SCAN_RESULT_COPY[scan.result].admits).length;
  const waiting = scans.filter((scan) => !scan.synced).length;
  // Until the handover answers, this device's own count of the shift's undone admissions.
  const undone = serverUndone ?? shift.filter((scan) => scan.undone && scan.result === "admitted").length;
  const cells: [string, number][] = [
    ["Admitted", admitted],
    ["Refused", refused],
    ["Queued", waiting],
    ...(API_MODE ? [["Undone", undone] as [string, number]] : []),
  ];

  return (
    <Sheet open={open} onClose={onClose} title="End your shift?" placement="center">
      <dl className={`mt-4 grid ${cells.length === 4 ? "grid-cols-4" : "grid-cols-3"} border border-border`}>
        {cells.map(([label, value], index) => (
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
            if (!API_MODE) {
              await endShift();
              await new Promise((resolve) => window.setTimeout(resolve, 500));
              navigate("/pair", { replace: true, state: { ended: true } });
              return;
            }
            // API mode: the gate is kept until the server's summary has been shown.
            const summary = await handOver();
            if (typeof summary?.undone === "number") setServerUndone(summary.undone);
            await new Promise((resolve) => window.setTimeout(resolve, 500));
            navigate("/pair", { replace: true, state: { ended: true } });
            releaseGate();
          }}
        >
          End shift
        </ActionButton>
      </div>
    </Sheet>
  );
}
