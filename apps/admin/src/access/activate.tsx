/**
 * Staff activation `/admin/activate#token=…` (docs/06 §2, 03 §3). The invitation email opens it.
 *
 * 1. The token is read from the fragment once, kept in memory only, and the fragment is removed
 *    from the address bar and history. It is never stored, logged or put in a path or query.
 * 2. POST /auth/activate/check says what the link is good for before anyone chooses a password:
 *    valid (with the account's role), expired, already used, or not valid. A security-staff link
 *    goes on to the Gate Scanner's own activation page, the token still in the fragment.
 * 3. A password with its rules shown as it is typed (12 to 200 characters, the two entries match),
 *    then POST /auth/activate. A refusal that is about the link is shown as the link's state.
 * 4. Done: sign in. A console role is then taken to authenticator set-up (the second factor its
 *    privileged actions ask for); a speaker or crew member learns their access is their credential.
 *
 * Plain on purpose, existing components only: the visual redesign is coming.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Role } from "@synan/contracts/enums";
import { ROLE_COPY, STAFF_PASSWORD } from "@synan/contracts/copy";
import { ActionButton, Field, TextInput, buttonClass } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import { LoadingState, errorCode, noAnswer, retryAfter, useDocumentTitle } from "../kit";
import { Notice } from "../kit/states";
import { mode } from "../live/backend";
import { activationApi } from "./activation-api";
import { markActivated } from "./after-activation";
import { SCANNER_URL } from "./app-urls";
import { Frame } from "./guard";
import { useSession } from "./session";

type LinkState = "checking" | "valid" | "expired" | "used" | "invalid" | "gate" | "done";
type Trouble = { tone: "warning" | "danger"; text: string } | null;

/** The token in `#token=…`, or null. Read once; the caller removes the fragment. */
export function tokenFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return raw && raw.trim() ? raw.trim() : null;
}

function troubleOf(error: unknown): Trouble {
  const silent = noAnswer(error);
  if (silent === "offline") return { tone: "warning", text: "You are offline. Setting your password needs a connection; try again when you are back online." };
  if (silent === "unreachable") return { tone: "warning", text: "The server did not answer. Check the connection, then try again." };
  if (errorCode(error) === "RATE_LIMITED") {
    const wait = retryAfter(error);
    const minutes = wait ? Math.max(1, Math.ceil(wait / 60)) : null;
    return { tone: "warning", text: `Too many attempts from this connection. Try again ${minutes ? `in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "in a few minutes"}.` };
  }
  return { tone: "danger", text: "Something went wrong on our side. Try again in a moment." };
}

const isConsole = (role: Role | null) => role === "admin" || role === "organiser" || role === "supervisor" || role === "desk_clerk";

export default function Activate() {
  const navigate = useNavigate();
  const session = useSession();
  // Read before the effect below removes it from the address bar (and kept across StrictMode's re-run).
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [state, setState] = useState<LinkState>(token ? "checking" : "invalid");
  const [role, setRole] = useState<Role | null>(null);
  const [trouble, setTrouble] = useState<Trouble>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setTrouble(null);
    activationApi.check(token).then(
      (r) => {
        if (cancelled) return;
        setRole(r.role ?? null);
        if (r.state === "valid" && r.role === "security_staff") {
          // Gate staff set their password in the Gate Scanner, on the device they will use.
          setState("gate");
          window.location.replace(`${SCANNER_URL}/activate#token=${encodeURIComponent(token)}`);
        } else setState(r.state);
      },
      (error: unknown) => {
        if (cancelled) return;
        // A token too short or too long to be one of ours is simply not a valid link.
        if (errorCode(error) === "VALIDATION_FAILED") setState("invalid");
        else setTrouble(troubleOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const title = { checking: "Checking your link", valid: "Set your password", expired: "Link expired", used: "Link already used", invalid: "Link not valid", gate: "Opening the Gate Scanner", done: "Password set" }[state];
  useDocumentTitle(title);

  const signIn = async () => {
    // A console role sets up its authenticator right after signing in.
    if (isConsole(role)) markActivated();
    // Someone else signed in on this browser: the new account signs in fresh.
    if (session.state.status === "ready") await session.signOut();
    navigate("/", { replace: true });
  };

  return (
    <Frame>
      <section aria-labelledby="activate-title" className="mt-10">
        <p className="text-12 text-muted-foreground">Staff account</p>
        <h1 id="activate-title" tabIndex={-1} className="mt-1 font-display text-40 leading-tight tracking-tight text-balance">
          {title}
        </h1>
        {state === "checking" ? (
          trouble ? (
            <div className="mt-6 grid max-w-120 gap-4">
              <Notice tone={trouble.tone}>{trouble.text}</Notice>
              <div>
                <button type="button" className={buttonClass("secondary", "compact")} onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <LoadingState label="Checking the link from your email…" className="px-0 sm:px-0" />
          )
        ) : null}
        {state === "valid" && token ? <PasswordForm token={token} role={role} onDone={() => setState("done")} onLinkDead={(s) => setState(s)} /> : null}
        {state === "gate" ? (
          <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">
            This account is for gate staff: you set its password in the Gate Scanner. If it does not open,{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => token && window.location.replace(`${SCANNER_URL}/activate#token=${encodeURIComponent(token)}`)}>
              open the Gate Scanner
            </button>
            .
          </p>
        ) : null}
        {state === "expired" ? (
          <Explain>
            Invitation links work for 72 hours, and this one has run out. Ask an admin to send you a new invitation: the new
            email has a fresh link.
          </Explain>
        ) : null}
        {state === "used" ? (
          <>
            <Explain>
              A password has already been set with this link; each link works once. If you set it, sign in with your email address
              and that password. If you did not, ask an admin to send you a new invitation.
            </Explain>
            <div className="mt-8">
              <ActionButton action={signIn} doneLabel="Opening sign-in" variant="primary" size="compact">
                Sign in
              </ActionButton>
            </div>
          </>
        ) : null}
        {state === "invalid" ? (
          <Explain>
            This link does not work. Open the link from your newest invitation email, in full: a link that was cut short, or one
            a newer invitation replaced, cannot be used. If it still does not work, ask an admin to send you a new invitation.
          </Explain>
        ) : null}
        {state === "done" ? (
          <>
            <Explain>
              {isConsole(role)
                ? "Sign in with your email address and the password you just set. You will then set up an authenticator app: the console asks for a code from it before privileged actions."
                : `Your account is ready. As ${role ? ROLE_COPY[role].label.toLowerCase() : "staff"} you have no console: at the event, your access is your credential. Signing in shows your account and its role.`}
            </Explain>
            <div className="mt-8">
              <ActionButton action={signIn} doneLabel="Opening sign-in" variant="primary" size="compact">
                Sign in
              </ActionButton>
            </div>
          </>
        ) : null}
        {mode === "mock" && state !== "done" ? (
          <p className="mt-12 max-w-120 text-12 text-muted-foreground">
            Mock: try #token=demo-valid, demo-valid-desk_clerk, demo-valid-crew, demo-gate, demo-expired or demo-used.
          </p>
        ) : null}
      </section>
    </Frame>
  );
}

function Explain({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">{children}</p>;
}

/** The two entries and their rules, checked as they are typed. */
function PasswordForm({
  token,
  role,
  onDone,
  onLinkDead,
}: {
  token: string;
  role: Role | null;
  onDone: () => void;
  onLinkDead: (state: "expired" | "used" | "invalid") => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fields, setFields] = useState<{ password?: string; confirm?: string }>({});
  const [trouble, setTrouble] = useState<Trouble>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const long = password.length >= STAFF_PASSWORD.min;
  const short = password.length <= STAFF_PASSWORD.max;
  const same = password.length > 0 && password === confirm;
  const rules = [
    { met: long, text: `At least ${STAFF_PASSWORD.min} characters${password.length > 0 && !long ? ` (${password.length} so far)` : ""}` },
    ...(short ? [] : [{ met: false, text: `No more than ${STAFF_PASSWORD.max} characters` }]),
    { met: same, text: "Both entries match" },
  ];

  const submit = async () => {
    setTrouble(null);
    const problems = {
      password: !long ? `Use at least ${STAFF_PASSWORD.min} characters.` : !short ? `Use no more than ${STAFF_PASSWORD.max} characters.` : undefined,
      confirm: long && short && !same ? "The two entries are different. Type the same password twice." : undefined,
    };
    setFields(problems);
    if (problems.password || problems.confirm) {
      (problems.password ? passwordRef : confirmRef).current?.focus();
      throw new Error("VALIDATION_FAILED");
    }
    try {
      await activationApi.activate(token, password);
    } catch (error) {
      const code = errorCode(error);
      if (code === "LINK_EXPIRED" || code === "LINK_INVALID") {
        // The link died meanwhile (used in another tab, replaced, or ran out): say which.
        const state = code === "LINK_EXPIRED" ? "expired" : await activationApi.check(token).then((r) => (r.state === "used" ? "used" : "invalid"), () => "invalid" as const);
        onLinkDead(state);
      } else if (code === "VALIDATION_FAILED" && !noAnswer(error)) {
        setFields({ password: `Use ${STAFF_PASSWORD.min} to ${STAFF_PASSWORD.max} characters.` });
        passwordRef.current?.focus();
      } else setTrouble(troubleOf(error));
      throw error;
    }
    setPassword("");
    setConfirm("");
    onDone();
  };

  return (
    <>
      <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">
        {role ? `Your account is for the role ${ROLE_COPY[role].label}. ` : ""}Choose a password of at least {STAFF_PASSWORD.min} characters.
        Spaces are fine: a few unrelated words make a strong password. Do not reuse one from another site.
      </p>
      <form noValidate onSubmit={(event: FormEvent) => event.preventDefault()} className="mt-8 grid max-w-96 gap-4" aria-describedby={trouble ? "activate-trouble" : undefined}>
        <Field label="New password" error={fields.password} required>
          <TextInput
            ref={passwordRef}
            type="password"
            name="new-password"
            autoComplete="new-password"
            autoFocus
            value={password}
            aria-describedby={fields.password ? undefined : "password-rules"}
            onChange={(event) => {
              setPassword(event.target.value);
              setFields({});
            }}
          />
        </Field>
        <ul id="password-rules" className="grid gap-1 text-12 text-muted-foreground">
          {rules.map((rule) => (
            <li key={rule.text} className="flex items-center gap-2">
              <SignalShape state={rule.met ? "ok" : "idle"} className={rule.met ? "text-success" : undefined} />
              <span className={rule.met ? "text-foreground" : undefined}>{rule.text}</span>
              <span className="sr-only">{rule.met ? ": done" : ": not yet"}</span>
            </li>
          ))}
        </ul>
        <Field label="Type it again" error={fields.confirm} required>
          <TextInput
            ref={confirmRef}
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              setFields({});
            }}
          />
        </Field>
        {trouble ? (
          <div id="activate-trouble">
            <Notice tone={trouble.tone}>{trouble.text}</Notice>
          </div>
        ) : null}
        <div className="pt-1">
          <ActionButton type="submit" action={submit} doneLabel="Password set" failedLabel="Try again" variant="primary" size="compact" keepDone>
            Set password
          </ActionButton>
        </div>
      </form>
    </>
  );
}
