/**
 * S1 · Choose gate (docs/06 §3.2). The staff member's assignments for this shift as large
 * rows; a gate outside the shift is shown with the plain reason and cannot be chosen
 * (P-15). Scanning a printed gate code arrives in Phase 3.
 *
 * API mode: a signed-out device asks for the staff sign-in first (POST /auth/login), then lists
 * GET /me/assignments. The list is kept on the device, so a reload without signal still opens.
 */
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ERROR_COPY } from "@synan/contracts/copy";
import { ApiFailure } from "../data/api/client";
import { reloadGates, signIn, signOut } from "../data/api/runtime";
import { useApi, useWorld } from "../data/world";
import { pairGate, useScanner } from "../data/store";

export default function Pair() {
  const { gateId } = useScanner();
  const navigate = useNavigate();
  const ended = Boolean((useLocation().state as { ended?: boolean } | null)?.ended);
  const api = useApi();
  const { event, gates } = useWorld();

  if (api && !api.ready) return <div className="min-h-0 flex-1" />;
  if (api && !api.session) return <SignIn ended={ended} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="px-4 pt-6 pb-4 sm:px-6">
        {ended ? (
          <p role="status" className="mb-5 border border-border px-4 py-3 text-15">
            Shift ended. Hand this device to your supervisor.
          </p>
        ) : null}
        {event?.title ? <p className="text-13 font-medium text-muted-foreground">{event.title}</p> : null}
        <h1 className="mt-1 text-28 font-medium leading-tight">Choose your gate</h1>
        <p className="mt-2 text-15 text-muted-foreground">Your gates for this shift.</p>
      </div>
      {api && gates.length === 0 ? (
        <div className="border-t border-border px-4 py-6 sm:px-6">
          <p role="status" className="text-17 text-muted-foreground">
            {api.gatesLoading ? "Loading your gates…" : (api.gatesError ?? "No gates are assigned to you right now.")}
          </p>
          {!api.gatesLoading ? (
            <button type="button" onClick={() => void reloadGates()} className="pressable mt-4 min-h-14 border border-border px-6 text-17">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="border-t border-border">
        {gates.map((gate) => {
          const current = gate.id === gateId;
          const body = (
            <>
              <span className="min-w-0">
                <span className="block text-17 font-medium">{gate.label}</span>
                <span className="mt-0.5 block text-15 text-muted-foreground">
                  {gate.perimeter ? "Entrance · passes and wristbands" : `Inside · wristbands only${gate.roomName ? ` · ${gate.roomName}` : ""}`}
                </span>
                {gate.shift.now ? null : (
                  <span className="mt-1 block text-15 text-warning">
                    {ERROR_COPY.OUTSIDE_SHIFT.message} Your shift here starts at <span className="font-mono">{gate.shift.starts}</span>.
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-13 text-muted-foreground">
                  {gate.shift.starts}–{gate.shift.ends}
                </span>
                {current ? <span className="mt-1 block text-13 text-foreground">Current</span> : null}
              </span>
            </>
          );
          return (
            <li key={gate.id} className="border-b border-border">
              {gate.shift.now ? (
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    pairGate(gate);
                    navigate("/", { replace: true });
                  }}
                  className={`pressable relative flex min-h-18 w-full items-center justify-between gap-4 border border-transparent px-4 py-3 text-left sm:px-6`}
                >
                  {current ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
                  {body}
                </button>
              ) : (
                <div aria-disabled="true" className="flex min-h-18 items-center justify-between gap-4 px-4 py-3 opacity-80 sm:px-6">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {api?.session ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <span className="min-w-0 truncate text-15 text-muted-foreground">{api.session.email}</span>
          <button type="button" onClick={() => void signOut()} className="pressable min-h-12 border border-border px-5 text-15">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Staff sign-in (03 §3): email and password, POST /auth/login. */
function SignIn({ ended }: { ended: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(ERROR_COPY.VALIDATION_FAILED.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      setPassword("");
    } catch (e) {
      setError(
        e instanceof ApiFailure
          ? e.kind === "network"
            ? "No connection to the server. Try again when the link is back."
            : e.code
              ? (ERROR_COPY[e.code]?.message ?? e.message)
              : e.message
          : ERROR_COPY.INTERNAL.message,
      );
    } finally {
      setBusy(false);
    }
  };

  const field = "mt-2 min-h-14 w-full border border-input bg-background px-3 text-17 focus:border-brand focus-visible:outline-none";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <form onSubmit={submit} noValidate className="px-4 pt-6 pb-6 sm:px-6">
        {ended ? (
          <p role="status" className="mb-5 border border-border px-4 py-3 text-15">
            Shift ended. Hand this device to your supervisor.
          </p>
        ) : null}
        <h1 className="text-28 font-medium leading-tight">Sign in</h1>
        <p className="mt-2 text-15 text-muted-foreground">Use your gate staff account.</p>
        <label htmlFor="signin-email" className="mt-6 block text-13 font-medium text-muted-foreground">
          Email
        </label>
        <input
          id="signin-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className={field}
        />
        <label htmlFor="signin-password" className="mt-4 block text-13 font-medium text-muted-foreground">
          Password
        </label>
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signin-error" : undefined}
          className={field}
        />
        {error ? (
          <p id="signin-error" role="alert" className="mt-3 text-15 text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="pressable mt-6 min-h-14 w-full border border-transparent bg-action text-17 font-medium text-action-foreground disabled:opacity-70"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
