import { pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { emailedLinkFor, getSession, requestSignInLink, signOut, useSession, verifyToken } from "../data/auth";
import type { VerifyOutcome } from "../data/backend";
import { failureCopy } from "../data/failure-copy";
import { PageHeader, PageShell, Panel } from "../components/page";
import { ActionButton, buttonClass } from "@synan/ui/components";
import { fieldClass } from "../components/form-styles";
import { ERROR_COPY } from "@synan/contracts/copy";

/** Only same-origin paths may be a post-sign-in destination (no open redirect). */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/pass";
}

/**
 * The calm sign-in (D-37): one statement, then a narrow centred column with the one field and
 * the one action. `head` is the screen's statement (PageHeader).
 */
function AuthLayout({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <PageShell>
      {head}
      {children ? <div className="enter mx-auto mt-10 w-full max-w-110 md:mt-12">{children}</div> : null}
    </PageShell>
  );
}

const quietLink = "text-foreground underline underline-offset-4 hover:text-brand";

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
    // The same check as registration (data/registration.ts). It was missing its backslashes, so
    // any address with an "s" in it was refused.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That email doesn't look complete. Check for a missing @ or dot.");
      return;
    }

    setState("submitting");

    // The session starts only when the link is opened (/verify), never when it is requested.
    try {
      await requestSignInLink(email, next);
    } catch (failure) {
      setState("idle");
      setError(failureCopy(failure).message);
      return;
    }
    setState("sent");
  };

  // Mock build only: no email is sent, so the link is shown here.
  const emailedLink = import.meta.env.DEV ? emailedLinkFor(email.trim(), next) : null;

  if (state === "sent") {
    return (
      <AuthLayout
        head={
          <PageHeader label="Sign in" title="Check your email." more={`We sent a sign-in link to ${email.trim()}.`}>
            It should arrive within a minute. Open it on this device to go straight to your pass.
          </PageHeader>
        }
      >
        <div>
          {emailedLink ? (
          <Panel className="mb-8">
            <p className="text-13 font-medium text-muted-foreground">
              Mock build · the link in the email
            </p>
            <p className="mt-2 break-all font-mono text-11 tracking-[0.08em]">
              <Link
                to={emailedLink}
                className="underline underline-offset-4"
              >
                /verify?token=syn-magic-{email.trim()}
              </Link>
            </p>
          </Panel>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ActionButton
              doneLabel="Sent again"
              action={() => requestSignInLink(email, next)}
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
          <p className="mt-6 text-center text-15 text-muted-foreground">Not there after a minute? Check your spam folder. Each link works once.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout head={<PageHeader title="Welcome back." more="Sign in with your email and we'll send you a link." />}>
      <div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email" className="text-15 font-medium">
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
            aria-describedby={error ? "email-error" : "email-hint"}
            className={`mt-2 ${fieldClass}`}
            placeholder="you@example.com"
            readOnly={state === "submitting"}
            autoFocus
          />
          {error ? (
            <p id="email-error" className="mt-2 text-15 text-destructive">
              <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
              {error}
            </p>
          ) : (
            <p id="email-hint" className="mt-2 text-13 text-muted-foreground">
              No password needed. The link signs you in here.
            </p>
          )}
          <button
            type="submit"
            className={buttonClass("primary", "md", "mt-6 min-h-14 w-full text-17")}
            disabled={state === "submitting"}
          >
            {state === "submitting" ? "Sending your link…" : "Email me a link"}
          </button>
        </form>
        <p className="mt-6 text-center text-15 text-muted-foreground">
          First time here?{" "}
          <Link to="/" className={quietLink}>
            Register for an event
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

/**
 * A link works once: the redemption is kept per token, so a second effect run (React's
 * development double-run, or a re-render) shares the first answer instead of spending the
 * link again and reporting it as used.
 */
const redemptions = new Map<string, Promise<VerifyOutcome>>();
function redeem(token: string, next: string): Promise<VerifyOutcome> {
  let pending = redemptions.get(token);
  if (!pending) {
    pending = verifyToken(token, next);
    redemptions.set(token, pending);
  }
  return pending;
}

function VerifyScreen() {
  useEffect(() => {
    document.title = pageTitle("Verify");
  }, []);

  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  // The API's link carries the token in the fragment (/auth/verify#token=…&return_to=…), so it
  // never reaches a server log or a Referer; the mock's link uses the query (/verify?token=…).
  const fragment = new URLSearchParams(hash.slice(1));
  const token = fragment.get("token") ?? searchParams.get("token");
  const requested = safeNext(fragment.get("return_to") ?? searchParams.get("next"));
  const [state, setState] = useState<"validating" | "invalid" | "success">(
    token ? "validating" : "invalid",
  );
  const [problem, setProblem] = useState<"expired" | "invalid" | "unreachable">("invalid");
  const [next, setNext] = useState(requested);

  // All hooks run on every render; verifying starts the session, then a 3-second
  // confirmation precedes the redirect (docs/06 A9).
  useEffect(() => {
    if (!token) return;
    let live = true;
    let timer: number | undefined;
    redeem(token, requested).then((outcome) => {
      if (!live) return;
      if (!outcome.ok) {
        setProblem(outcome.problem);
        setState("invalid");
        return;
      }
      setNext(outcome.next);
      setState("success");
      timer = window.setTimeout(() => navigate(outcome.next, { replace: true }), 3000);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [token, requested, navigate]);

  if (state === "validating") {
    return (
      <AuthLayout
        head={
          <p role="status" className="pt-24 text-center text-15 text-muted-foreground">
            Checking your link…
          </p>
        }
      />
    );
  }

  if (state === "success") {
    return (
      <AuthLayout
        head={
          <div role="status">
            <PageHeader label="Signed in" title="You're in." more={`Taking you to ${next === "/pass" ? "your pass" : next}…`} />
          </div>
        }
      />
    );
  }

  // Expired and invalid links read differently (copy from contracts, docs/02 §7).
  const copy = !token ? { title: "This link is incomplete", message: "The sign-in link is missing its code. Request a new one." } : ERROR_COPY[problem === "expired" ? "LINK_EXPIRED" : problem === "unreachable" ? "INTERNAL" : "LINK_INVALID"];

  return (
    <AuthLayout
      head={
        <PageHeader
          label="Sign in"
          title={copy.title}
          aside={
            <Link to="/sign-in" className={buttonClass("primary", "md")}>
              Email me a new link
            </Link>
          }
        >
          <p role="alert">{copy.message}</p>
        </PageHeader>
      }
    />
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
    <AuthLayout
      head={
        <PageHeader
          label="Signed in"
          title={`Signed in as ${session.name}.`}
          aside={
          <button
            onClick={() => {
              signOut();
              window.location.href = "/";
            }}
            className={buttonClass("secondary", "md")}
          >
            Sign out
          </button>
          }
        >
          You are currently signed in. If you&apos;d like to switch accounts, sign out first.
        </PageHeader>
      }
    />
  );
}

export default function Auth() {
  const location = useLocation();
  const session = getSession();

  // Check if already signed in for sign-in and verify routes
  if (location.pathname === "/sign-in" && session) {
    return <AlreadySignedInScreen />;
  }

  // /auth/verify is where the API's emailed link points (ATTENDEE_APP_ORIGIN + /auth/verify#token=…).
  if (location.pathname === "/verify" || location.pathname === "/auth/verify") {
    return <VerifyScreen />;
  }

  // Default to sign-in
  return <SignInScreen />;
}
