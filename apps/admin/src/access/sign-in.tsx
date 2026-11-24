/**
 * Operator sign-in on the real API (06 §2, 03 §3): email and password, POST /auth/login. The
 * second factor is asked later, by the step-up prompt, when an action needs it.
 *
 * After signing in, a deep link the role may open stays where it is; anything else goes to
 * where the role starts (D-23: the Command Center, the desk, or Events).
 *
 * States: wrong email or password, too many attempts, offline, server not reachable, and the
 * reason the person is here at all (never signed in, signed out, the server ended the session,
 * another tab signed out). On the mock, guard.tsx keeps its one-button page instead.
 */
import { useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActionButton, Field, TextInput } from "@synan/ui/components";
import { errorCode, errorCopy, noAnswer, retryAfter, useDocumentTitle } from "../kit";
import { Notice } from "../kit/states";
import { mayOpen } from "../routes";
import { capabilitiesOf, landingPath } from "./capabilities";
import { useSession, type SignedOutReason } from "./session";

const INTRO: Record<SignedOutReason, { title: string; text: string }> = {
  fresh: {
    title: "Sign in",
    text: "Use the email and password of your operator account. Some actions also ask for a code from your authenticator app.",
  },
  "signed-out": {
    title: "You are signed out",
    text: "Sign in again to return to the console.",
  },
  expired: {
    title: "Your session has ended",
    text: "The server signed you out: the session ran its course, or it was ended from another device. Sign in again to carry on from here.",
  },
  elsewhere: {
    title: "You signed out in another tab",
    text: "Signing out ends the session in every tab on this device. Sign in again to carry on from here.",
  },
};

type Problem = { tone: "danger" | "warning"; text: string } | null;

function problemOf(error: unknown): Problem {
  const silent = noAnswer(error);
  if (silent === "offline") return { tone: "warning", text: "You are offline. Signing in needs a connection; try again when you are back online." };
  if (silent === "unreachable") return { tone: "warning", text: "The server did not answer. Check the connection, then try again." };
  switch (errorCode(error)) {
    case "INVALID_CREDENTIALS":
      return { tone: "danger", text: "That email and password do not match. Check both and try again." };
    case "RATE_LIMITED": {
      const wait = retryAfter(error);
      const when = wait ? `in about ${Math.max(1, Math.ceil(wait / 60))} ${Math.ceil(wait / 60) <= 1 ? "minute" : "minutes"}` : "in a few minutes";
      return { tone: "warning", text: `Too many attempts, so signing in is paused for a while. Try again ${when}.` };
    }
    default: {
      const copy = errorCopy(error);
      return { tone: "danger", text: `${copy.title}. ${copy.message}` };
    }
  }
}

export function SignInForm({ reason }: { reason: SignedOutReason }) {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const intro = INTRO[reason];
  useDocumentTitle(intro.title);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<{ email?: string; password?: string }>({});
  const [problem, setProblem] = useState<Problem>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setProblem(null);
    const missing = {
      email: email.trim() ? undefined : "Enter your email address.",
      password: password ? undefined : "Enter your password.",
    };
    setFields(missing);
    if (missing.email || missing.password) {
      (missing.email ? emailRef : passwordRef).current?.focus();
      throw new Error("VALIDATION_FAILED");
    }
    try {
      const user = await signIn({ email: email.trim(), password });
      const can = capabilitiesOf(user);
      if (!mayOpen(location.pathname, (c) => can.has(c))) navigate(landingPath(can), { replace: true });
    } catch (error) {
      if (errorCode(error) === "VALIDATION_FAILED" && errorCopy(error).fields.email) {
        setFields({ email: "Enter a full email address, like name@example.org." });
        emailRef.current?.focus();
      } else {
        setProblem(problemOf(error));
        if (errorCode(error) === "INVALID_CREDENTIALS") {
          setPassword("");
          passwordRef.current?.focus();
        }
      }
      throw error;
    }
  };

  return (
    <section aria-labelledby="sign-in" className="mt-10">
      <h1 id="sign-in" className="font-display text-40 leading-tight tracking-tight text-balance">
        {intro.title}
      </h1>
      <p className="mt-3 max-w-120 text-15 leading-relaxed text-muted-foreground">{intro.text}</p>
      <form
        noValidate
        onSubmit={(event: FormEvent) => event.preventDefault()}
        className="mt-8 grid max-w-96 gap-4"
        aria-describedby={problem ? "sign-in-problem" : undefined}
      >
        <Field label="Email" error={fields.email} required>
          <TextInput
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" error={fields.password} required>
          <TextInput
            ref={passwordRef}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {problem ? (
          <div id="sign-in-problem">
            <Notice tone={problem.tone}>{problem.text}</Notice>
          </div>
        ) : null}
        <div className="pt-1">
          <ActionButton type="submit" action={submit} doneLabel="Signed in" failedLabel="Try again" variant="primary" size="compact" keepDone>
            Sign in
          </ActionButton>
        </div>
      </form>
      <p className="mt-8 max-w-120 border-t border-border pt-3 text-12 text-muted-foreground">
        Forgotten your password, or new here without one? Ask an admin: they can send you a fresh activation link.
      </p>
    </section>
  );
}
