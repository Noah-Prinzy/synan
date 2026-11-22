import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { signIn, verifyToken, useSession, getSession, signOut } from "../data/auth";
import { PageShell, Eyebrow, Panel } from "../components/page";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute left-0 top-0 -translate-y-full bg-background px-4 py-3 text-sm text-foreground focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}

type SignInState = "idle" | "submitting" | "sent";

function SignInScreen() {
  useEffect(() => {
    document.title = "Sign in · Connexia";
  }, []);

  const [searchParams] = useSearchParams();
  const session = useSession();
  const prefillEmail = searchParams.get("email") ?? "";
  const [email, setEmail] = useState(prefillEmail);
  const [state, setState] = useState<SignInState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Redirect if already signed in
  if (session) {
    return <Navigate to="/account" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Enter your email");
      return;
    }

    setState("submitting");

    // Small delay to show submitting state
    await new Promise((resolve) => setTimeout(resolve, 500));

    signIn(email.trim());
    setState("sent");
  };

  if (state === "sent") {
    return (
      <PageShell>
        <SkipLink />
        <div className="pt-10 md:pt-14 xl:pt-16">
          <Eyebrow>Sign in</Eyebrow>
          <h1 className="mt-2 font-serif text-2xl leading-tight">Check your email</h1>
          <p className="mt-4 max-w-[24rem] text-sm leading-relaxed">
            We sent a sign-in link to {email.trim()}. It should arrive within a minute.
          </p>
          <Panel className="mt-8">
            <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
              Dev link
            </p>
            <p className="mt-2">
              <Link
                to={`/verify?token=cnx-magic-${encodeURIComponent(email.trim())}`}
                className="break-all text-sm underline"
              >
                /verify?token=cnx-magic-{email.trim()}
              </Link>
            </p>
          </Panel>
          <div className="mt-8">
            <Link
              to={`/sign-in?email=${encodeURIComponent(email)}`}
              className="border-border hover:border-foreground hover:bg-card/50 flex h-12 items-center justify-center px-6 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
            >
              Resend link
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>Sign in</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">Sign in to Connexia</h1>
        <p className="mt-4 max-w-[24rem] text-sm leading-relaxed">
          Enter your email address and we&apos;ll send you a secure link to sign in.
        </p>
        <form onSubmit={handleSubmit} className="mt-8 max-w-[24rem]">
          <label htmlFor="email" className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-border bg-card mt-2 w-full border px-3 py-2.5 font-mono text-[0.875rem] placeholder:text-muted-foreground focus:outline-brand"
            placeholder="you@example.com"
            disabled={state === "submitting"}
            autoFocus
          />
          {error && (
            <p className="mt-1.5 text-sm text-destructive">{error}</p>
          )}
          <button
            type="submit"
            className="bg-brand hover:bg-brand/90 border-border mt-6 h-12 w-full border text-white font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none disabled:opacity-50"
            disabled={state === "submitting"}
          >
            {state === "submitting" ? "Sending..." : "Email me a link"}
          </button>
        </form>
      </div>
    </PageShell>
  );
}

function VerifyScreen() {
  useEffect(() => {
    document.title = "Verify · Connexia";
  }, []);

  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const next = searchParams.get("next");
  const [state, setState] = useState<"validating" | "invalid" | "success">("validating");

  const session = useSession();

  // If already have a session, redirect
  if (session) {
    return <Navigate to={next ?? "/pass"} replace />;
  }

  useEffect(() => {
    if (state === "validating" && token) {
      const valid = verifyToken(token);
      if (valid) {
        // Wait 3 seconds for "You're in" confirmation
        setState("success");
        const timer = setTimeout(() => {
          window.location.href = next ?? "/pass";
        }, 3000);
        return () => clearTimeout(timer);
      } else {
        setState("invalid");
      }
    } else if (!token) {
      setState("invalid");
    }
  }, [token, next, state]);

  if (state === "success") {
    return (
      <PageShell>
        <SkipLink />
        <div className="flex flex-col items-center justify-center pt-10 md:pt-14 xl:pt-16">
          <h1 className="font-serif text-2xl leading-tight">You&apos;re in</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Redirecting to {next ?? "your pass"}...
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>Verify</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">Sign in failed</h1>
        <p className="mt-4 max-w-[24rem] text-sm leading-relaxed">
          {token ? "That sign-in link is no longer valid. " : "Missing token. "}
          Send a new link below.
        </p>
        <div className="mt-8">
          <Link
            to="/sign-in"
            className="bg-brand hover:bg-brand/90 border-border mt-6 inline-block h-12 px-6 border text-white font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
          >
            Send a new link
          </Link>
        </div>
      </div>
    </PageShell>
  );
}

function AlreadySignedInScreen() {
  useEffect(() => {
    document.title = "Already signed in · Connexia";
  }, []);

  const session = useSession();

  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <PageShell>
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>Signed in</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">
          Signed in as {session.name}
        </h1>
        <p className="mt-4 max-w-[24rem] text-sm leading-relaxed">
          You are currently signed in. If you&apos;d like to switch accounts, sign out first.
        </p>
        <div className="mt-8">
          <button
            onClick={() => {
              signOut();
              window.location.href = "/";
            }}
            className="border-border hover:border-destructive hover:text-destructive flex h-12 items-center justify-center px-6 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
          >
            Sign out
          </button>
        </div>
      </div>
    </PageShell>
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
