/**
 * Resend the pass (POST /credentials/:id/resend, second factor, rate-limited). One confirming
 * step: where it goes, what the copy is good for, when the last one went.
 */
import { useState } from "react";
import { Button } from "@synan/ui/components";
import type { DeskRegistration } from "@synan/mock/command";
import { Notice, formatStamp } from "../kit";
import { desk, deskErrorCode, deskFailure } from "./desk-api";
import { FlowFrame, type DeskOutcome } from "./flow-parts";
import { StepUpCancelled, useStepUp } from "./step-up-guard";
import { track } from "./use-online";

export function ResendFlow({
  row,
  timeZone,
  disabled,
  onCancel,
  onDone,
}: {
  row: DeskRegistration;
  timeZone: string;
  disabled: boolean;
  onCancel: () => void;
  onDone: (outcome: DeskOutcome) => void;
}) {
  const stepUp = useStepUp();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "neutral" | "warning" | "danger"; text: string } | null>(null);
  const email = row.attendee.email ?? "";

  const send = async () => {
    if (busy || disabled || !row.credential_id) return;
    setBusy(true);
    setNotice(null);
    try {
      await stepUp(() => track(desk.resend(row.credential_id as string)));
      onDone({ kind: "resent", to: email });
    } catch (failure) {
      if (failure instanceof StepUpCancelled) {
        setNotice({ tone: "neutral", text: "Nothing was sent: the second factor was not confirmed." });
      } else if (deskErrorCode(failure) === "RATE_LIMITED") {
        setNotice({
          tone: "warning",
          text: "A pass went to them less than a minute ago. Ask them to look in spam or promotions; if it is not there, try again in a minute.",
        });
      } else {
        setNotice({ tone: "danger", text: deskFailure(failure, "The pass was not sent") });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowFrame id="desk-resend" title="Resend the pass" onCancel={onCancel}>
      <div className="flex flex-col gap-1 text-13 leading-relaxed">
        <p>
          A fresh copy goes to <span className="break-all font-medium">{email}</span>.
        </p>
        <p className="text-muted-foreground">
          The emailed copy works once, at the entrance or here at the desk. The QR on their phone keeps working.
          {row.pass_sent_at ? (
            <>
              {" "}
              Last sent <span className="font-mono text-12 text-foreground tabular-nums">{formatStamp(row.pass_sent_at, timeZone)}</span>.
            </>
          ) : null}
        </p>
        <p className="text-12 text-muted-foreground">Asks for your second factor.</p>
      </div>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy} disabled={disabled} onClick={() => void send()} className="w-full sm:w-auto">
          Send pass
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel} className="w-full sm:w-auto">
          Cancel
        </Button>
      </div>
    </FlowFrame>
  );
}
