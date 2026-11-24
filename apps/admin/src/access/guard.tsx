/**
 * What a role sees at the edges of what it may do (D-23):
 *
 *   RequireCapability  wraps a route; a role without the capability gets a calm "not available
 *                      for your role" page with one way back, never the screen itself.
 *   SessionGate        wraps everything role-dependent; holds the page until the session is
 *                      known, so a deep link never flashes a screen the role may not open.
 *   NoConsole          the whole page for a role with no console (security staff, speaker,
 *                      crew): what the account is for, and sign out.
 *   SignedOut          the whole page after signing out.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@synan/ui/brand";
import { ActionButton, buttonClass } from "@synan/ui/components";
import { ErrorState, LoadingState, useDocumentTitle } from "../kit";
import { ROLE_PURPOSE, type Capability } from "./capabilities";
import { useSession } from "./session";

export function RequireCapability({ need, children }: { need: Capability | readonly Capability[]; children: ReactNode }) {
  const { can } = useSession();
  const needs = typeof need === "string" ? [need] : need;
  return needs.every(can) ? <>{children}</> : <NotForRole />;
}

/** Inside the shell: this screen is not part of the role's console. */
export function NotForRole() {
  const { roleLabel, role, landing, landingLabel } = useSession();
  useDocumentTitle("Not available");
  return (
    <section aria-labelledby="not-for-role" className="max-w-160 px-4 py-10 sm:px-6">
      <p className="font-mono text-11 text-muted-foreground">{roleLabel}</p>
      <h1 id="not-for-role" className="mt-1 font-display text-28 leading-tight tracking-tight text-balance">
        This screen is not part of your console
      </h1>
      <p className="mt-2 max-w-120 text-13 leading-relaxed text-muted-foreground">
        As {article(roleLabel)} <span className="text-foreground">{roleLabel.toLowerCase()}</span>, your console covers{" "}
        {role ? lowerFirst(ROLE_PURPOSE[role]) : "what your role allows."} If you need this screen, ask an admin to change your role.
      </p>
      <div className="mt-6">
        <Link to={landing} className={buttonClass("secondary", "compact")}>
          Go to {landingLabel}
        </Link>
      </div>
    </section>
  );
}

/** Holds role-dependent content until the session is known; handles the states around it. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const { state } = session;
  if (state.status === "loading") {
    return (
      <Frame>
        <LoadingState label="Signing you in…" className="px-0 sm:px-0" />
      </Frame>
    );
  }
  if (state.status === "error") {
    return (
      <Frame>
        <ErrorState title="Could not load your account" error={state.error} onRetry={session.retry} className="mx-0 sm:mx-0" />
      </Frame>
    );
  }
  if (state.status === "signed-out") return <SignedOut />;
  if (!session.hasConsole) return <NoConsole />;
  return <>{children}</>;
}

/** The standalone page frame: the wordmark once, one centred column, no chrome. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto w-full max-w-160 px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <p className="text-21">
          <Wordmark />
        </p>
        {children}
      </main>
    </div>
  );
}

export function NoConsole() {
  const { user, role, roleLabel, signOut } = useSession();
  useDocumentTitle("No console for this account");
  const scanner = role === "security_staff";
  return (
    <Frame>
      <section aria-labelledby="no-console" className="mt-10">
        <h1 id="no-console" className="font-display text-40 leading-tight tracking-tight text-balance">
          {scanner ? "This account uses the Gate Scanner" : "This account has no console"}
        </h1>
        <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">
          {user ? <>You are signed in as {user.name}, {article(roleLabel)} {roleLabel.toLowerCase()}. </> : null}
          {scanner
            ? "Gate scanning happens on the scanner phone or tablet at your checkpoint. Open the Gate Scanner there and pair it with your gate."
            : "Your access is your credential: show your pass or wristband at the door. Your organiser grants the rooms you need for each event."}
        </p>
        <dl className="mt-8 grid max-w-120 grid-cols-[8rem_minmax(0,1fr)] border-t border-border text-13">
          <dt className="border-b border-border py-2.5 text-12 text-muted-foreground">Account</dt>
          <dd className="min-w-0 truncate border-b border-border py-2.5">{user?.email ?? "—"}</dd>
          <dt className="border-b border-border py-2.5 text-12 text-muted-foreground">Role</dt>
          <dd className="border-b border-border py-2.5">{roleLabel}</dd>
          <dt className="border-b border-border py-2.5 text-12 text-muted-foreground">Help</dt>
          <dd className="border-b border-border py-2.5 text-muted-foreground">Ask your shift lead or an admin if you expected the console.</dd>
        </dl>
        <div className="mt-8">
          <SignOutButton signOut={signOut} />
        </div>
      </section>
    </Frame>
  );
}

function SignOutButton({ signOut }: { signOut: () => Promise<void> }) {
  return (
    <ActionButton action={signOut} doneLabel="Signed out" variant="quiet" size="compact" keepDone>
      Sign out
    </ActionButton>
  );
}

export function SignedOut() {
  const { signIn } = useSession();
  const [failed, setFailed] = useState(false);
  useDocumentTitle("Signed out");
  return (
    <Frame>
      <section aria-labelledby="signed-out" className="mt-10">
        <h1 id="signed-out" className="font-display text-40 leading-tight tracking-tight">
          You are signed out
        </h1>
        <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">
          Sign in again to return to the console. Signing in asks for your password and a code from your authenticator.
        </p>
        <div className="mt-8">
          <ActionButton
            action={async () => {
              setFailed(false);
              try {
                await signIn();
              } catch (error) {
                setFailed(true);
                throw error;
              }
            }}
            doneLabel="Signed in"
            variant="primary"
            size="compact"
          >
            Sign in
          </ActionButton>
        </div>
        {failed ? <p className="mt-3 text-12 text-destructive">Sign-in did not go through. Try again.</p> : null}
      </section>
    </Frame>
  );
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
