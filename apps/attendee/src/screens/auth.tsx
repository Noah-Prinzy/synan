import { BRAND, pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { linkProblem, verifyToken, useSession, getSession, signOut } from "../data/auth";
import { PageShell, Eyebrow, Panel } from "../components/page";
import { ActionButton, buttonClass } from "@synan/ui/components";
import { fieldClass } from "../components/form-styles";
import { ERROR_COPY } from "@synan/contracts/copy";

/** Only same-origin paths may be a post-sign-in destination (no open redirect). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/pass";
}

/**
 * Direction A sign-in: a brand cell (the logotype and one line) beside the form
 * cell; on phones the form stands alone with the logotype above it.
 */
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell bleed>
      <div className="grid md:min-h-160 md:grid-cols-2">
        {/* The header already carries the logo; this cell carries the promise, level with the form. */}
        <div className="relative hidden flex-col justify-center overflow-hidden border-r border-border p-10 md:flex">
          <p className="relative max-w-sm font-display text-28 leading-tight">
            Your pass, your agenda and the venue&apos;s updates — for every event you attend.
          </p>
        </div>
        <div className="flex flex-col justify-center px-4 py-12 sm:px-6 md:px-16">
          <div className="enter mx-auto w-full max-w-md">{children}</div>
        </div>
      </div>
    </PageShell>
  );
}

type SignInState = "idle" | "submitting" | "sent";

function SignInScreen() {
  useEffect(() => {
    document.title = pageTitle("Sign in");
  }, []);

  const [searchParams] = useSearchParams();
  const session = useSession();
  const prefillEmail = searchParams.get("email") ?? "";
  const [email, setEmail] = useState(prefillEmail);
  const [state, setState] = useState<SignInState>("idle");
  const [error, setError] = useState<string | null>(null);

  const next = safeNext(searchParams.get("next"));

  // Redirect if already signed in
  if (session) {
    return <Navigate to={next} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Enter the email you registered with.");
      return;
    }
    if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(email.trim())) {
      setError("That email doesn't look complete. Check for a missing @ or dot.");
      return;
    }

    setState("submitting");

    // Small delay to show submitting state. The session starts only when the link is
    // opened (/verify), never when it is requested.
    await new Promise((resolve) => setTimeout(resolve, 500));
    setState("sent");
  };

  if (state === "sent") {
    return (
      <AuthLayout>
        <div>
          <Eyebrow>Sign in</Eyebrow>
          <h1 className="mt-2 font-display text-40 leading-tight">Check your email</h1>
          <p className="mt-4 text-17 leading-relaxed text-muted-foreground">
            We sent a sign-in link to {email.trim()}. It should arrive within a minute. Open it on this device to go straight to your pass.
          </p>
          {import.meta.env.DEV ? (
          <Panel className="mt-8">
            <p className="text-13 font-medium text-muted-foreground">
              Mock build · the link in the email
            </p>
            <p className="mt-2 break-all font-mono text-11 tracking-[0.08em]">
              <Link
                to={`/verify?token=syn-magic-${encodeURIComponent(email.trim())}&next=${encodeURIComponent(next)}`}
                className="underline underline-offset-4"
              >
                /verify?token=syn-magic-{email.trim()}
              </Link>
            </p>
          </Panel>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ActionButton
              doneLabel="Sent again"
              action={() => new Promise((resolve) => setTimeout(resolve, 500))}
              className="min-h-12 px-5 text-15"
            >
              Send the link again
            </ActionButton>
            <button
              type="button"
              onClick={() => setState("idle")}
              className="inline-flex min-h-11 items-center px-2 text-15 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Use a different email
            </button>
          </div>
          <p className="mt-6 text-15 text-muted-foreground">Not there after a minute? Check your spam folder. Each link works once.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div>
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="mt-2 font-display text-40 leading-tight">Sign in to {BRAND.name}</h1>
        <p className="mt-4 text-17 leading-relaxed text-muted-foreground">
          Enter your email address and we&apos;ll send you a secure link to sign in.
        </p>
        <form onSubmit={handleSubmit} className="mt-8">
          <label htmlFor="email" className="text-13 font-medium text-muted-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "email-error" : undefined}
            className={`mt-2 ${fieldClass}`}
            placeholder="you@example.com"
            readOnly={state === "submitting"}
            autoFocus
          />
          {error && (
            <p id="email-error" className="mt-2 text-15 text-destructive">
              <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
              {error}
            </p>
          )}
          <button
            type="submit"
            className={buttonClass("primary", "md", "mt-6 w-full")}
            disabled={state === "submitting"}
          >
            {state === "submitting" ? "Sending your link…" : "Email me a link"}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}

function VerifyScreen() {
  useEffect(() => {
    document.title = pageTitle("Verify");
  }, []);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const next = safeNext(searchParams.get("next"));
  const [state, setState] = useState<"validating" | "invalid" | "success">(
    token ? "validating" : "invalid",
  );

  // All hooks run on every render; verifying starts the session, then a 3-second
  // confirmation precedes the redirect (docs/06 A9).
  useEffect(() => {
    if (!token) return;
    if (!verifyToken(token)) {
      setState("invalid");
      return;
    }
    setState("success");
    const timer = window.setTimeout(() => navigate(next, { replace: true }), 3000);
    return () => window.clearTimeout(timer);
  }, [token, next, navigate]);

  if (state === "validating") {
    return (
      <AuthLayout>
        <p role="status" className="text-13 font-medium text-muted-foreground">
          Checking your link…
        </p>
      </AuthLayout>
    );
  }

  if (state === "success") {
    return (
      <AuthLayout>
        <div role="status">
          <Eyebrow>Signed in</Eyebrow>
          <h1 className="mt-2 font-display text-40 leading-tight">You&apos;re in</h1>
          <p className="mt-2 text-15 text-muted-foreground">Taking you to {next === "/pass" ? "your pass" : next}…</p>
        </div>
      </AuthLayout>
    );
  }

  // Expired and invalid links read differently (copy from contracts, docs/02 §7).
  const problem = !token ? { title: "This link is incomplete", message: "The sign-in link is missing its code. Request a new one." } : ERROR_COPY[linkProblem(token) === "expired" ? "LINK_EXPIRED" : "LINK_INVALID"];

  return (
    <AuthLayout>
      <div>
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="mt-2 font-display text-40 leading-tight">{problem.title}</h1>
        <p role="alert" className="mt-4 text-17 leading-relaxed text-muted-foreground">
          {problem.message}
        </p>
        <div className="mt-8">
          <Link to="/sign-in" className={buttonClass("primary", "md")}>
            Email me a new link
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

function AlreadySignedInScreen() {
  useEffect(() => {
    document.title = pageTitle("Already signed in");
  }, []);

  const session = useSession();

  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <AuthLayout>
      <div>
        <Eyebrow>Signed in</Eyebrow>
        <h1 className="mt-2 font-display text-40 leading-tight">
          Signed in as {session.name}
        </h1>
        <p className="mt-4 text-17 leading-relaxed text-muted-foreground">
          You are currently signed in. If you&apos;d like to switch accounts, sign out first.
        </p>
        <div className="mt-8">
          <button
            onClick={() => {
              signOut();
              window.location.href = "/";
            }}
            className={buttonClass("secondary", "md")}
          >
            Sign out
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}

export default function Auth() {
  const location = useLocation();
  const session = getSession();

  // Check if already signed in for sign-in and verify routes
  if (location.pathname === "/sign-in" && session) {
    return <AlreadySignedInScreen />;
  }

  if (location.pathname === "/verify") {
    return <VerifyScreen />;
  }

  // Default to sign-in
  return <SignInScreen />;
}
