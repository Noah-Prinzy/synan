import { BRAND, pageTitle } from "@synan/ui/brand";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { linkProblem, verifyToken, useSession, getSession, signOut } from "../data/auth";
import { PageShell, Eyebrow, Panel } from "../components/page";
import { buttonClass } from "@synan/ui/components";
import { ERROR_COPY } from "@synan/contracts/copy";

/** Only same-origin paths may be a post-sign-in destination (no open redirect). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/pass";
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
      setError("Enter your email");
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
      <PageShell>
        <div className="mx-auto w-full max-w-[30rem] md:py-8">
          <Eyebrow>Sign in</Eyebrow>
          <h1 className="mt-2 font-display text-40 leading-tight">Check your email</h1>
          <p className="mt-4 text-17 leading-relaxed text-muted-foreground">
            We sent a sign-in link to {email.trim()}. It should arrive within a minute.
          </p>
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
          <div className="mt-8">
            <Link
              to={`/sign-in?email=${encodeURIComponent(email)}`}
              className={buttonClass("secondary", "md")}
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
      <div className="mx-auto w-full max-w-[30rem] md:py-8">
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
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 min-h-12 w-full border border-input bg-background px-3 py-2.5 text-17 placeholder:text-muted-foreground focus:border-brand"
            placeholder="you@example.com"
            disabled={state === "submitting"}
            autoFocus
          />
          {error && (
            <p className="mt-1.5 text-15 text-destructive">{error}</p>
          )}
          <button
            type="submit"
            className={buttonClass("primary", "md", "mt-6 w-full")}
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
      <PageShell>
        <p role="status" className="text-13 font-medium text-muted-foreground">
          Checking your link…
        </p>
      </PageShell>
    );
  }

  if (state === "success") {
    return (
      <PageShell>
        <div role="status" className="mx-auto w-full max-w-[30rem] md:py-8">
          <Eyebrow>Signed in</Eyebrow>
          <h1 className="mt-2 font-display text-40 leading-tight">You&apos;re in</h1>
          <p className="mt-2 text-15 text-muted-foreground">Taking you to {next === "/pass" ? "your pass" : next}…</p>
        </div>
      </PageShell>
    );
  }

  // Expired and invalid links read differently (copy from contracts, docs/02 §7).
  const problem = !token ? { title: "This link is incomplete", message: "The sign-in link is missing its code. Request a new one." } : ERROR_COPY[linkProblem(token) === "expired" ? "LINK_EXPIRED" : "LINK_INVALID"];

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-[30rem] md:py-8">
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
    </PageShell>
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
    <PageShell>
      <div className="mx-auto w-full max-w-[30rem] md:py-8">
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
