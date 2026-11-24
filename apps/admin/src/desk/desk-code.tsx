/**
 * The desk code (01 §5.3, A5; POST /carriers/desk-code). The clerk scans the stock band they are
 * handing over and reads out a six-character code; the attendee types it on their own phone
 * (My pass → Bind wristband → Desk code) and the band binds to their pass. The code is single
 * use and lasts ten minutes. While it is shown, the desk looks at the registration every few
 * seconds and moves on by itself once the band is bound.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@synan/ui/components";
import type { DeskCodeResult, DeskRegistration } from "@synan/mock/command";
import { Notice } from "../kit";
import { DEV_TOOLS } from "../live/backend";
import { BandField, type BandFieldHandle } from "./band-field";
import { bandProblem, displayName, maskBand, normaliseBand } from "./copy";
import { desk, deskFailure, deskIsMock, deskNow, fieldMessage } from "./desk-api";
import type { DeskOutcome } from "./flow-parts";
import { track } from "./use-online";

const POLL_MS = 3000;

export function DeskCodeStep({
  row,
  eventId,
  disabled,
  onDone,
}: {
  row: DeskRegistration;
  eventId: string;
  disabled: boolean;
  onDone: (outcome: DeskOutcome) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: DeskCodeResult; band: string } | null>(null);
  const field = useRef<BandFieldHandle>(null);

  const issue = async (raw: string) => {
    if (busy || disabled) return;
    const problem = bandProblem(raw);
    if (problem) {
      setError(problem);
      field.current?.focus(true);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const code = await track(desk.deskCode({ identifier: normaliseBand(raw) }));
      setIssued({ code, band: maskBand(raw) });
    } catch (failure) {
      const message = fieldMessage(failure, "identifier");
      if (message) setError(message);
      else setNotice(deskFailure(failure, "No code was made"));
      field.current?.focus(true);
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <CodeShown
        row={row}
        eventId={eventId}
        issued={issued}
        onDone={onDone}
        onAgain={() => {
          setIssued(null);
          setValue("");
        }}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-3 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void issue(value);
      }}
    >
      <BandField
        ref={field}
        label="The band you are handing them"
        hint="Scan it first. The code binds this band to the pass of whoever enters it, so read it out only to them."
        value={value}
        onChange={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        onSubmit={(next) => void issue(next)}
        error={error}
        autoFocus
      />
      {notice ? <Notice tone="danger">{notice}</Notice> : null}
      <div>
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={disabled} className="w-full sm:w-auto">
          Get a code
        </Button>
      </div>
    </form>
  );
}

function CodeShown({
  row,
  eventId,
  issued,
  onDone,
  onAgain,
}: {
  row: DeskRegistration;
  eventId: string;
  issued: { code: DeskCodeResult; band: string };
  onDone: (outcome: DeskOutcome) => void;
  onAgain: () => void;
}) {
  const expires = Date.parse(issued.code.expires_at);
  const [left, setLeft] = useState(() => expires - deskNow());
  const [checking, setChecking] = useState(false);
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;
  const expired = left <= 0;

  useEffect(() => {
    const id = window.setInterval(() => setLeft(expires - deskNow()), 1000);
    return () => window.clearInterval(id);
  }, [expires]);

  const check = async () => {
    if (done.current) return;
    try {
      const fresh = await track(desk.registration(eventId, row.id));
      if (fresh.band_hint && !done.current) {
        done.current = true;
        finish.current({ kind: "bound", band: issued.band, via: "code" });
      }
    } catch {
      /* the next look tries again; the banner says when the desk is offline */
    }
  };

  useEffect(() => {
    if (expired) return;
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const minutes = Math.max(0, Math.floor(left / 60_000));
  const seconds = Math.max(0, Math.floor((left % 60_000) / 1000));
  const code = issued.code.code;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="border border-border px-4 py-4">
        <p className="text-12 text-muted-foreground">Desk code for band <span className="font-mono text-foreground">{issued.band}</span></p>
        <p
          className={`mt-2 font-mono text-40 leading-none tracking-[0.18em] tabular-nums ${expired ? "text-muted-foreground line-through" : ""}`}
          aria-label={`Desk code: ${code.split("").join(" ")}`}
        >
          {code.slice(0, 3)}
          <span aria-hidden="true" className="inline-block w-3" />
          {code.slice(3)}
        </p>
        <p className="mt-3 text-12 text-muted-foreground" aria-live="off">
          {expired ? (
            <span className="text-warning">Expired. Get a new code: the band stays in stock until it is bound.</span>
          ) : (
            <>
              Works once · expires in{" "}
              <span className="font-mono text-foreground tabular-nums">
                {minutes}:{String(seconds).padStart(2, "0")}
              </span>
            </>
          )}
        </p>
      </div>

      <ol className="flex flex-col gap-2 text-13 leading-relaxed">
        <li className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
          <span className="font-mono text-12 text-muted-foreground">1</span>
          <span>Hand {row.attendee.full_name ? displayName(row) : "them"} the band.</span>
        </li>
        <li className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
          <span className="font-mono text-12 text-muted-foreground">2</span>
          <span>
            On their phone: <span className="text-foreground">My pass → Bind wristband → Desk code</span>.
          </span>
        </li>
        <li className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
          <span className="font-mono text-12 text-muted-foreground">3</span>
          <span>They type the code. This screen moves on by itself when the band is theirs.</span>
        </li>
      </ol>

      {!expired ? (
        <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground">
          <span aria-hidden="true" className="relative h-px w-10 overflow-hidden bg-border">
            <span className="animate-skeleton-sweep absolute inset-y-0 w-1/3 bg-foreground/50" />
          </span>
          Waiting for them to enter it…
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant={expired ? "primary" : "secondary"} size="sm" onClick={onAgain}>
          {expired ? "Get a new code" : "Use another band"}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          loading={checking}
          onClick={async () => {
            setChecking(true);
            await check();
            setChecking(false);
          }}
        >
          Check now
        </Button>
      </div>

      {DEV_TOOLS && deskIsMock && !expired ? (
        <MockRedeem code={code} registrationId={row.id} onRedeemed={() => void check()} />
      ) : null}
    </div>
  );
}

/** Development: stand in for the attendee typing the code on their phone. */
function MockRedeem({ code, registrationId, onRedeemed }: { code: string; registrationId: string; onRedeemed: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="border border-dashed border-foreground/30 px-3 py-2 text-12 text-muted-foreground">
      <span className="font-mono text-11 tracking-[0.12em] text-foreground">MOCK</span> · Nobody has a phone here.{" "}
      <button
        type="button"
        className="min-h-8 text-foreground underline decoration-border underline-offset-4 hover:decoration-brand"
        onClick={() =>
          desk.mock.redeemDeskCode(code, registrationId).then(
            () => onRedeemed(),
            (error: unknown) => setProblem(fieldMessage(error, "code") ?? fieldMessage(error, "identifier") ?? "The mock could not redeem it."),
          )
        }
      >
        Enter the code as the attendee
      </button>
      {problem ? <span className="mt-1 block text-destructive">{problem}</span> : null}
    </div>
  );
}
