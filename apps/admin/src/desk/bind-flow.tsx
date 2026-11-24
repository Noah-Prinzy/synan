/**
 * Bind a band to someone who has none (01 §5.3, POST /carriers/bind). Two ways, one screen:
 *
 *   Scan the band   the clerk scans (or types) a stock band; Enter binds it.
 *   Desk code       the clerk scans a band and reads out a six-character code; the attendee
 *                   enters it on their own phone (A5) and the band binds to their pass.
 *
 * The desk checks the number's form before asking the server, and every refusal says what to
 * do next. A refused number is selected, so the next scan replaces it.
 */
import { useRef, useState } from "react";
import { BAND_ERROR_COPY } from "@synan/contracts/copy";
import { Button, cn } from "@synan/ui/components";
import type { DeskRegistration } from "@synan/mock/command";
import { Notice } from "../kit";
import { BandField, type BandFieldHandle } from "./band-field";
import { bandProblem, displayName, maskBand, normaliseBand } from "./copy";
import { desk, deskErrorCode, deskFailure, fieldMessage } from "./desk-api";
import { DeskCodeStep } from "./desk-code";
import { FlowFrame, type DeskOutcome } from "./flow-parts";
import { track } from "./use-online";

type Mode = "scan" | "code";

export function BindFlow({
  row,
  eventId,
  autoFocus,
  disabled,
  onDone,
}: {
  row: DeskRegistration;
  eventId: string;
  autoFocus: boolean;
  /** Offline: the step stays, the action waits. */
  disabled: boolean;
  onDone: (outcome: DeskOutcome) => void;
}) {
  const [mode, setMode] = useState<Mode>("scan");
  const name = displayName(row);
  return (
    <FlowFrame
      id="desk-bind"
      title="Bind a band"
      description={
        <>
          For {row.attendee.full_name ? <span className="text-foreground">{name}</span> : "this visitor"}. Scan a band from the box, or give them a
          code to bind it on their phone.
        </>
      }
    >
      <div role="tablist" aria-label="How to bind" className="grid grid-cols-2 border-b border-border">
        <ModeTab active={mode === "scan"} onClick={() => setMode("scan")} controls="desk-bind-scan">
          Scan the band
        </ModeTab>
        <ModeTab active={mode === "code"} onClick={() => setMode("code")} controls="desk-bind-code">
          Desk code
        </ModeTab>
      </div>
      {mode === "scan" ? (
        <div id="desk-bind-scan" role="tabpanel">
          <ScanStep row={row} autoFocus={autoFocus} disabled={disabled} onDone={onDone} />
        </div>
      ) : (
        <div id="desk-bind-code" role="tabpanel">
          <DeskCodeStep row={row} eventId={eventId} disabled={disabled} onDone={onDone} />
        </div>
      )}
    </FlowFrame>
  );
}

function ModeTab({ active, onClick, controls, children }: { active: boolean; onClick: () => void; controls: string; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        "pressable relative min-h-11 text-13 font-medium transition-colors duration-120 ease-standard motion-reduce:transition-none",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {active ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 bg-brand" /> : null}
    </button>
  );
}

function ScanStep({
  row,
  autoFocus,
  disabled,
  onDone,
}: {
  row: DeskRegistration;
  autoFocus: boolean;
  disabled: boolean;
  onDone: (outcome: DeskOutcome) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<BandFieldHandle>(null);
  const inFlight = useRef(false);

  const bind = async (raw: string) => {
    // A reader can send Enter twice; one bind per band.
    if (inFlight.current || disabled) return;
    const problem = bandProblem(raw);
    if (problem) {
      setError(problem);
      field.current?.focus(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await track(desk.bind({ registration_id: row.id, identifier: normaliseBand(raw) }));
      onDone({ kind: "bound", band: maskBand(raw), via: "scan" });
    } catch (failure) {
      const message = fieldMessage(failure, "identifier");
      if (message) setError(message);
      else if (deskErrorCode(failure) === "CONFLICT") setError(BAND_ERROR_COPY.band_in_use.message);
      else setNotice(deskFailure(failure, "The band was not bound"));
      field.current?.focus(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void bind(value);
      }}
    >
      <BandField
        ref={field}
        label="Band number"
        hint="With a reader, scan the band: it binds at once. Without one, type the number printed inside the band and press Enter."
        value={value}
        onChange={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        onSubmit={(next) => void bind(next)}
        error={error}
        autoFocus={autoFocus}
      />
      {notice ? <Notice tone="danger">{notice}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={disabled} className="w-full sm:w-auto">
          Bind band
        </Button>
        {disabled ? <span className="text-12 text-muted-foreground">Waiting for the connection.</span> : null}
      </div>
    </form>
  );
}
