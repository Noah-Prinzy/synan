/**
 * The second factor on the real API (03 §3): one prompt for the whole console, registered with
 * `auth.onStepUp`. When a call answers MFA_REQUIRED the API client asks here; the code typed is
 * verified (POST /auth/mfa/verify) and the call is retried. A step-up lasts 15 minutes.
 *
 * - Says which action needs the code, and that it lasts 15 minutes.
 * - Six boxes: typing advances, paste fills, the sixth digit submits.
 * - A refused code is asked again with the tries left (the client allows three per prompt).
 * - No authenticator yet: the set-up step instead (POST /auth/mfa/enrol: the key as text and as a
 *   QR code; POST /auth/mfa/enrol/confirm with a code from it). The same code then steps up, so
 *   the action goes through without a second code.
 * - Cancel leaves everything as it was; the action reports that it was not done.
 *
 * Loaded lazily, and only when live/backend.ts runs on the real API.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton, Button, Dialog } from "@synan/ui/components";
import { STEP_UP_ATTEMPTS, type StepUpAnswer, type StepUpRequest } from "../api";
import { errorCode, errorCopy, noAnswer } from "../kit/errors";
import { auth } from "../live/backend";
import { CODE_LENGTH, CodeInput, type CodeInputHandle } from "./code-input";
import { onEnrolmentRequest } from "./mfa-bus";
import { qrMatrix, qrPath } from "./qr";

/** What each guarded call is, in the words of "… needs a code". Fallback: "This action". */
const ACTION: Partial<Record<string, string>> = {
  publishLayout: "Publishing the venue layout",
  putAccessRules: "Republishing the access rules",
  exportReport: "Exporting a report",
  createReportSchedule: "Scheduling a report",
  changeTier: "Changing an attendee's tier",
  rebindCarrier: "Replacing a wristband",
  resend: "Resending a pass",
  clearReview: "Clearing a pass under review",
  revoke: "Revoking a pass",
  changeStaffRole: "Changing a staff member's role",
  registerDevice: "Registering a device",
  rotateDeviceToken: "Renewing a device's token",
  retireDevice: "Retiring a device",
  createWebhook: "Adding a webhook",
  updateWebhook: "Changing a webhook",
  deleteWebhook: "Removing a webhook",
  rotateWebhookSecret: "Renewing a webhook secret",
  processDataRequest: "Processing a data request",
  rejectDataRequest: "Declining a data request",
  mfaEnrol: "Setting up a new authenticator",
};

const actionOf = (operation: string | null) => (operation ? (ACTION[operation] ?? "This action") : null);

type View =
  | { kind: "closed" }
  /** Asking for a code; `problem` after a refused one. */
  | { kind: "ask"; request: StepUpRequest }
  /** A code was handed to the client; waiting for it to settle or ask again. */
  | { kind: "checking"; operation: string }
  /** No authenticator: explain, then show the key. `after` = the action already failed (set up, then retry). */
  | { kind: "enrol"; operation: string | null; after: boolean }
  /** The prompt ended without the action: why, and one way on. */
  | { kind: "failed"; operation: string; text: string };

export default function StepUpHost() {
  const [view, setView] = useState<View>({ kind: "closed" });
  const answer = useRef<((value: StepUpAnswer) => void) | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const reply = (value: StepUpAnswer) => {
    const resolve = answer.current;
    answer.current = null;
    resolve?.(value);
  };

  useEffect(() => {
    if (!auth) return;
    const offAsk = auth.onStepUp(
      (request) =>
        new Promise<StepUpAnswer>((resolve) => {
          answer.current = resolve;
          const enrolled = auth?.session()?.mfa_enrolled ?? true;
          setView(enrolled || request.attempt > 1 ? { kind: "ask", request } : { kind: "enrol", operation: request.operation, after: false });
        }),
    );
    const offSettled = auth.onStepUpSettled((outcome) => {
      const current = viewRef.current;
      if (outcome.ok) {
        setView({ kind: "closed" });
        return;
      }
      if (current.kind === "closed") return; // cancelled: already closed
      const operation = current.kind === "ask" ? current.request.operation : (current.operation ?? "");
      const code = errorCode(outcome.error);
      if (code === "MFA_NOT_ENROLLED") setView({ kind: "enrol", operation, after: true });
      else setView({ kind: "failed", operation, text: failureText(outcome.error, actionOf(operation) ?? "This action") });
    });
    const offSession = auth.onSession((session) => {
      if (session) return;
      reply({ cancel: true });
      setView({ kind: "closed" });
    });
    const offEnrol = onEnrolmentRequest(() => setView({ kind: "enrol", operation: null, after: false }));
    return () => {
      offAsk();
      offSettled();
      offSession();
      offEnrol();
      reply({ cancel: true });
    };
  }, []);

  const cancel = () => {
    reply({ cancel: true });
    setView({ kind: "closed" });
  };

  const open = view.kind !== "closed";
  const operation = view.kind === "ask" ? view.request.operation : view.kind === "closed" ? null : view.operation;
  const action = actionOf(operation);

  let title: ReactNode = "Enter your authenticator code";
  let description: ReactNode = null;
  let body: ReactNode = null;

  if (view.kind === "ask" || view.kind === "checking") {
    description = (
      <>
        <span className="text-foreground">{action}</span> needs a fresh code from your authenticator app. Once it is accepted, actions like this need
        no code for 15 minutes.
      </>
    );
    body = (
      <CodeStep
        key={view.kind === "ask" ? view.request.attempt : "checking"}
        checking={view.kind === "checking"}
        request={view.kind === "ask" ? view.request : null}
        onCode={(code) => {
          setView({ kind: "checking", operation: operation ?? "" });
          reply({ code });
        }}
        onCancel={cancel}
      />
    );
  } else if (view.kind === "enrol") {
    title = "Set up your authenticator";
    description = action ? (
      <>
        <span className="text-foreground">{action}</span> needs a code from an authenticator app, and this account does not have one yet.
        {view.after ? " It was not done; set up the app, then try it again." : " It takes about a minute."}
      </>
    ) : (
      "Some actions ask for a code from an authenticator app on your phone. Set one up once; it takes about a minute."
    );
    body = (
      <EnrolStep
        pending={!view.after && answer.current !== null}
        onConfirmed={(code) => {
          if (answer.current) {
            // The code that confirmed the set-up also steps this session up; the action carries on.
            setView({ kind: "checking", operation: operation ?? "" });
            reply({ code });
          } else {
            void auth?.stepUp(code).catch(() => undefined);
            setView({ kind: "closed" });
          }
        }}
        onCancel={cancel}
      />
    );
  } else if (view.kind === "failed") {
    title = `${action ?? "The action"} was not done`;
    body = (
      <div className="grid gap-4">
        <p className="text-13 leading-relaxed text-muted-foreground">{view.text}</p>
        <div className="flex justify-end">
          <Button variant="secondary" size="compact" onClick={() => setView({ kind: "closed" })}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onClose={view.kind === "checking" ? () => undefined : cancel} title={title} description={description} width={view.kind === "enrol" ? "lg" : "md"} dismissible={false}>
      {body}
    </Dialog>
  );
}

function failureText(error: unknown, action: string): string {
  const silent = noAnswer(error);
  if (silent === "offline") return "You went offline while the code was checked. Nothing changed. Try the action again when you are back online.";
  if (silent === "unreachable") return "The server did not answer while the code was checked. Nothing changed. Try the action again in a moment.";
  switch (errorCode(error)) {
    case "INVALID_MFA_CODE":
      return `${STEP_UP_ATTEMPTS} codes in a row were not accepted, so nothing changed. Check that your phone sets its clock automatically, then try the action again with the newest code.`;
    case "RATE_LIMITED":
      return "Too many codes were tried, so codes are paused for this account for up to 15 minutes. Nothing changed. Try the action again after that.";
    default: {
      const copy = errorCopy(error);
      return `${copy.title}. ${copy.message} ${action} did not go through; nothing changed.`;
    }
  }
}

/* ------------------------------------------------------------------ steps */

function CodeStep({
  request,
  checking,
  onCode,
  onCancel,
}: {
  request: StepUpRequest | null;
  checking: boolean;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const input = useRef<CodeInputHandle>(null);
  useEffect(() => input.current?.focus(), []);
  const refused = request?.problem ?? null;
  const left = request ? STEP_UP_ATTEMPTS - request.attempt + 1 : STEP_UP_ATTEMPTS;
  const submit = (value = code) => {
    if (value.length === CODE_LENGTH && !checking) onCode(value);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid gap-4"
    >
      <CodeInput
        ref={input}
        label="Six-digit code from your authenticator"
        describedBy="step-up-status"
        value={code}
        onChange={setCode}
        onComplete={submit}
        invalid={!!refused}
        disabled={checking}
      />
      <p id="step-up-status" role={refused ? "alert" : "status"} className={refused && !checking ? "text-12 text-destructive" : "text-12 text-muted-foreground"}>
        {checking
          ? "Checking the code…"
          : refused
            ? `Code not accepted: it is wrong, expired or already used. Try the newest one. ${left} ${left === 1 ? "try" : "tries"} left.`
            : "Open the authenticator app on your phone and type the six digits shown for Synan."}
      </p>
      <div className="flex flex-wrap justify-end gap-2 pt-3">
        <Button type="button" variant="quiet" size="compact" onClick={onCancel} disabled={checking}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="compact" disabled={checking || code.length < CODE_LENGTH} aria-busy={checking || undefined}>
          {checking ? "Checking…" : "Confirm"}
        </Button>
      </div>
    </form>
  );
}

type Enrolment = { secret: string; otpauth_url: string; expires_at: string };

function EnrolStep({ pending, onConfirmed, onCancel }: { pending: boolean; onConfirmed: (code: string) => void; onCancel: () => void }) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<CodeInputHandle>(null);

  const start = async () => {
    setStartError(null);
    setProblem(null);
    setCode("");
    try {
      setEnrolment(await auth!.startEnrolment());
    } catch (error) {
      setStartError(
        noAnswer(error)
          ? "The server did not answer. Check the connection and try again."
          : errorCode(error) === "MFA_REQUIRED"
            ? "This account already has an authenticator. Use its code; to replace it, ask an admin."
            : `${errorCopy(error).title}. ${errorCopy(error).message}`,
      );
      throw error;
    }
  };

  // Focus the boxes when the key appears and again after a refused code (they are disabled while checking).
  useEffect(() => {
    if (enrolment && !busy) input.current?.focus();
  }, [enrolment, busy]);

  const confirm = async (value = code) => {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await auth!.confirmEnrolment(value);
      onConfirmed(value);
    } catch (error) {
      const c = errorCode(error);
      setProblem(
        noAnswer(error)
          ? "The server did not answer. Check the connection and try again."
          : c === "INVALID_MFA_CODE"
            ? "Code not accepted. Check the app shows Synan, wait for the next code, and type that one."
            : c === "RATE_LIMITED"
              ? "Too many codes were tried. Wait up to 15 minutes, then show a new key."
              : c === "CONFLICT"
                ? "This key has expired or was replaced. Show a new key and add that one."
                : `${errorCopy(error).title}. ${errorCopy(error).message}`,
      );
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (!enrolment) {
    return (
      <div className="grid gap-4">
        <ol className="grid gap-2 text-13 leading-relaxed text-muted-foreground">
          <Step n={1}>
            Install an authenticator app on your phone if you have none: Google Authenticator, Microsoft Authenticator and 1Password all work.
          </Step>
          <Step n={2}>Show your set-up key here, and add it to the app by scanning the code or typing the key.</Step>
          <Step n={3}>Type the six digits the app then shows for Synan.</Step>
        </ol>
        <p className="text-12 text-muted-foreground">The key is shown once. Do not share it: anyone with it can make your codes.</p>
        {startError ? (
          <p role="alert" className="text-12 text-destructive">
            {startError}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-3">
          <Button type="button" variant="quiet" size="compact" onClick={onCancel}>
            {pending ? "Cancel" : "Not now"}
          </Button>
          <ActionButton action={start} doneLabel="Key ready" failedLabel="Try again" variant="primary" size="compact">
            Show my set-up key
          </ActionButton>
        </div>
      </div>
    );
  }

  const expires = new Date(enrolment.expires_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
      className="grid gap-5"
    >
      <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <QrCode text={enrolment.otpauth_url} label="Set-up code for your authenticator app" />
        <div className="grid min-w-0 gap-3 text-13">
          <p className="leading-relaxed text-muted-foreground">
            Scan the code with the app. If you cannot scan, choose to enter a key and type this one; the type is time-based.
          </p>
          <div>
            <p className="text-12 text-muted-foreground">Set-up key</p>
            <p className="mt-1 font-mono text-15 tracking-[0.08em] break-words text-foreground select-all">{groupKey(enrolment.secret)}</p>
            <div className="mt-2">
              <ActionButton
                action={() => navigator.clipboard.writeText(enrolment.secret)}
                doneLabel="Copied"
                failedLabel="Copy blocked: select the key"
                size="compact"
              >
                Copy key
              </ActionButton>
            </div>
          </div>
          <p className="text-12 text-muted-foreground">
            Valid until <span className="font-mono tabular-nums">{expires}</span>. Shown once; do not share it.
          </p>
        </div>
      </div>
      <div className="grid gap-2 pt-4">
        <p id="enrol-code-label" className="text-12 font-medium text-muted-foreground">
          Code from the app
        </p>
        <CodeInput
          ref={input}
          label="Six-digit code from the app"
          describedBy="enrol-status"
          value={code}
          onChange={setCode}
          onComplete={(value) => void confirm(value)}
          invalid={!!problem}
          disabled={busy}
        />
        <p id="enrol-status" role={problem ? "alert" : "status"} className={problem ? "text-12 text-destructive" : "text-12 text-muted-foreground"}>
          {busy ? "Checking the code…" : (problem ?? "Once the code is accepted, the app is set up for this account.")}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-3">
        <Button type="button" variant="quiet" size="compact" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="compact" disabled={busy || code.length < CODE_LENGTH} aria-busy={busy || undefined}>
          {busy ? "Checking…" : "Confirm"}
        </Button>
      </div>
    </form>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
      <span className="font-mono text-12 text-foreground tabular-nums">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** Base32 in fours, easier to type. */
function groupKey(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** White field, near-black modules (05 §3: the one exception to the dark ground, for cameras). */
function QrCode({ text, label }: { text: string; label: string }) {
  let matrix: boolean[][];
  try {
    matrix = qrMatrix(text);
  } catch {
    return null;
  }
  const size = matrix.length + 8;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="size-44 shrink-0" shapeRendering="crispEdges">
      <rect width={size} height={size} className="fill-qr-field" />
      <path d={qrPath(matrix)} className="fill-qr-ink" />
    </svg>
  );
}
