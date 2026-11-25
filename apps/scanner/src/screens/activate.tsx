/**
 * Staff activation for gate staff, `/scan/activate#token=…` (docs/06 §3, 03 §3). The invitation
 * email of a security-staff account opens it, on the device they will scan with.
 *
 * - The token is read from the fragment once, kept in memory only, and removed from the address
 *   bar and history. It is never stored, logged, or put in a path or query.
 * - POST /auth/activate/check first: valid, expired, already used or not valid. A link for any
 *   other role goes on to the Admin Command's activation page (the token still in the fragment).
 * - The password with its rules shown as it is typed (12 to 200 characters, both entries match),
 *   then POST /auth/activate. Done: sign in, then choose the gate (S1).
 *
 * Plain on purpose, the scanner's existing styles only: the visual redesign is coming.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivationCheck } from "@synan/contracts/rest";
import { STAFF_PASSWORD } from "@synan/contracts/copy";
import { Wordmark } from "@synan/ui/brand";
import { ApiFailure, call, currentSession } from "../data/api/client";
import { ADMIN_URL } from "../data/api/app-urls";
import { API_MODE } from "../data/api/config";
import { signOut } from "../data/api/runtime";

type LinkState = "checking" | "valid" | "expired" | "used" | "invalid" | "console" | "done";

/** The token in `#token=…`, or null. */
export function tokenFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * Real API: the two public calls, without a session. Mock (no accounts): demo links make every
 * state reachable — #token=demo-valid (gate staff), demo-console (forwards to the Admin Command),
 * demo-expired, demo-used; anything else is not valid.
 */
const used = new Set<string>();
const activation = API_MODE
  ? {
      check: (token: string) => call("checkActivation", { body: { token } }, { auth: false }) as Promise<ActivationCheck>,
      activate: async (token: string, password: string) => void (await call("activateStaff", { body: { token, password } }, { auth: false })),
    }
  : {
      async check(token: string): Promise<ActivationCheck> {
        await new Promise((r) => setTimeout(r, 300));
        if (used.has(token) || token === "demo-used") return { state: "used" };
        if (token === "demo-expired") return { state: "expired" };
        if (token === "demo-valid") return { state: "valid", role: "security_staff", expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() };
        if (token === "demo-console") return { state: "valid", role: "supervisor", expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() };
        return { state: "invalid" };
      },
      async activate(token: string, password: string) {
        await new Promise((r) => setTimeout(r, 300));
        if (token !== "demo-valid" || used.has(token)) throw new ApiFailure("http", 400, "LINK_INVALID", "Link not valid");
        if (password.length < STAFF_PASSWORD.min || password.length > STAFF_PASSWORD.max) throw new ApiFailure("http", 400, "VALIDATION_FAILED", "Check the details");
        used.add(token);
      },
    };

const problemOf = (e: unknown): string =>
  e instanceof ApiFailure && e.kind === "network"
    ? "No connection to the server. Try again when the link is back."
    : e instanceof ApiFailure && e.code === "RATE_LIMITED"
      ? "Too many attempts from this connection. Wait a few minutes, then try again."
      : "Something went wrong on our side. Try again in a moment.";

export default function Activate() {
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [state, setState] = useState<LinkState>(token ? "checking" : "invalid");
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setProblem(null);
    activation.check(token).then(
      (r) => {
        if (cancelled) return;
        if (r.state === "valid" && r.role !== "security_staff") {
          // Every other role sets its password in the Admin Command.
          setState("console");
          window.location.replace(`${ADMIN_URL}/activate#token=${encodeURIComponent(token)}`);
        } else setState(r.state);
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiFailure && e.code === "VALIDATION_FAILED") setState("invalid");
        else setProblem(problemOf(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const title = { checking: "Checking your link", valid: "Set your password", expired: "Link expired", used: "Link already used", invalid: "Link not valid", console: "Opening the Admin Command", done: "Password set" }[state];
  useEffect(() => {
    document.title = `${title} · Gate Scanner`;
  }, [title]);

  const toSignIn = async () => {
    // Someone else was signed in on this device: the new account signs in fresh.
    if (API_MODE && currentSession()) await signOut();
    navigate("/pair", { replace: true });
  };

  return (
    <div className="scanner-root fixed inset-0 flex flex-col overflow-y-auto overscroll-contain bg-background text-foreground">
      <main className="mx-auto w-full max-w-xl px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-8 sm:px-6">
        <p className="text-17">
          <Wordmark small />
        </p>
        <p className="mt-8 text-13 text-muted-foreground">Gate staff account</p>
        <h1 className="mt-1 text-28 font-medium leading-tight">{title}</h1>
        {state === "checking" ? (
          problem ? (
            <>
              <p role="alert" className="mt-4 text-15 text-destructive">
                {problem}
              </p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="pressable mt-4 min-h-12 border border-border px-5 text-15">
                Try again
              </button>
            </>
          ) : (
            <p role="status" className="mt-3 text-15 text-muted-foreground">
              Checking the link from your email…
            </p>
          )
        ) : null}
        {state === "valid" && token ? <PasswordForm token={token} onDone={() => setState("done")} onLinkDead={setState} /> : null}
        {state === "console" ? <Say>This account uses the Admin Command: you set its password there.</Say> : null}
        {state === "expired" ? (
          <Say>Invitation links work for 72 hours, and this one has run out. Ask an admin to send you a new invitation: the new email has a fresh link.</Say>
        ) : null}
        {state === "used" ? (
          <>
            <Say>
              A password has already been set with this link; each link works once. If you set it, sign in with your email address and that
              password. If you did not, ask an admin to send you a new invitation.
            </Say>
            <SignInButton onClick={toSignIn} />
          </>
        ) : null}
        {state === "invalid" ? (
          <Say>
            This link does not work. Open the link from your newest invitation email, in full: a link that was cut short, or one a newer
            invitation replaced, cannot be used. If it still does not work, ask an admin to send you a new invitation.
          </Say>
        ) : null}
        {state === "done" ? (
          <>
            <Say>Sign in with your email address and the password you just set, then choose the gate your shift is at.</Say>
            <SignInButton onClick={toSignIn} />
          </>
        ) : null}
        {!API_MODE && state !== "done" ? (
          <p className="mt-10 border-t border-border pt-3 text-13 text-muted-foreground">Mock: try #token=demo-valid, demo-console, demo-expired or demo-used.</p>
        ) : null}
      </main>
    </div>
  );
}

function Say({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-15 leading-relaxed text-muted-foreground">{children}</p>;
}

function SignInButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable mt-6 min-h-14 w-full border border-transparent bg-action text-17 font-medium text-action-foreground"
    >
      Sign in
    </button>
  );
}

function PasswordForm({ token, onDone, onLinkDead }: { token: string; onDone: () => void; onLinkDead: (state: "expired" | "used" | "invalid") => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "password" | "confirm" | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const long = password.length >= STAFF_PASSWORD.min;
  const short = password.length <= STAFF_PASSWORD.max;
  const same = password.length > 0 && password === confirm;
  const rules = [
    { met: long, text: `At least ${STAFF_PASSWORD.min} characters${password.length > 0 && !long ? ` (${password.length} so far)` : ""}` },
    ...(short ? [] : [{ met: false, text: `No more than ${STAFF_PASSWORD.max} characters` }]),
    { met: same, text: "Both entries match" },
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!long || !short) return setError({ field: "password", text: `Use ${STAFF_PASSWORD.min} to ${STAFF_PASSWORD.max} characters.` });
    if (!same) return setError({ field: "confirm", text: "The two entries are different. Type the same password twice." });
    setBusy(true);
    setError(null);
    try {
      await activation.activate(token, password);
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === "LINK_EXPIRED" || e.code === "LINK_INVALID")) {
        const state = e.code === "LINK_EXPIRED" ? "expired" : await activation.check(token).then((r) => (r.state === "used" ? "used" : "invalid"), () => "invalid" as const);
        onLinkDead(state);
      } else if (e instanceof ApiFailure && e.code === "VALIDATION_FAILED") setError({ field: "password", text: `Use ${STAFF_PASSWORD.min} to ${STAFF_PASSWORD.max} characters.` });
      else setError({ field: null, text: problemOf(e) });
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-2 min-h-14 w-full border border-input bg-background px-3 text-17 focus:border-brand focus-visible:outline-none";
  return (
    <form onSubmit={submit} noValidate>
      <p className="mt-3 text-15 text-muted-foreground">
        At least {STAFF_PASSWORD.min} characters. Spaces are fine: a few unrelated words make a strong password.
      </p>
      <label htmlFor="activate-password" className="mt-6 block text-13 font-medium text-muted-foreground">
        New password
      </label>
      <input
        id="activate-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        aria-invalid={error?.field === "password" ? true : undefined}
        aria-describedby={error?.field === "password" ? "activate-error" : "activate-rules"}
        className={field}
      />
      <ul id="activate-rules" className="mt-3 grid gap-1.5 text-15 text-muted-foreground">
        {rules.map((rule) => (
          <li key={rule.text} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-2 shrink-0 ${rule.met ? "bg-success" : "border border-muted-foreground"}`} />
            <span className={rule.met ? "text-foreground" : undefined}>{rule.text}</span>
            <span className="sr-only">{rule.met ? ": done" : ": not yet"}</span>
          </li>
        ))}
      </ul>
      <label htmlFor="activate-confirm" className="mt-4 block text-13 font-medium text-muted-foreground">
        Type it again
      </label>
      <input
        id="activate-confirm"
        type="password"
        autoComplete="new-password"
        enterKeyHint="go"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setError(null);
        }}
        aria-invalid={error?.field === "confirm" ? true : undefined}
        aria-describedby={error?.field === "confirm" ? "activate-error" : undefined}
        className={field}
      />
      {error ? (
        <p id="activate-error" role="alert" className="mt-3 text-15 text-destructive">
          {error.text}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="pressable mt-6 min-h-14 w-full border border-transparent bg-action text-17 font-medium text-action-foreground disabled:opacity-70"
      >
        {busy ? "Setting your password…" : "Set password"}
      </button>
    </form>
  );
}
