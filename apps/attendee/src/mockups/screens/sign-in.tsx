/**
 * DEVELOPMENT ONLY — (e) sign in: one statement, one email field, one action, a quiet way out.
 * Calm: centred, no surface, generous space. Stage: an editorial two-column layout, the form
 * on one soft surface. Field: Stage plus mono times on the link (sent at, valid until).
 * Press "Email me a link" with an address for the sent state (the reward tick).
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { CalmPage } from "../shell";
import { Arrow } from "../nav";
import { NOW, time } from "../data";
import "./forms.css";

const QUIET_WIDE = { x: 0.06, y: 0.1, w: 0.88, h: 0.74, floor: 0.2 };
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function SignIn() {
  const dx = useDx();
  const stage = dx.d !== 1;
  const mono = dx.d === 3;
  const uid = useId().replace(/:/g, "");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sends, setSends] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address and we’ll send the link there.");
      inputRef.current?.focus();
      return;
    }
    if (!looksLikeEmail(email)) {
      setError("That doesn’t look like an email address. Check for a missing @ or dot.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSent(email.trim());
    setSends((k) => k + 1);
  };

  const reset = () => {
    setSent(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const sentAt = time(new Date(NOW).toISOString());
  const validUntil = time(new Date(NOW + 15 * 60_000).toISOString());

  const head = (
    <div className="dxf-sign-head">
      {mono ? <p className="dx-eyebrow">Sign in · no password</p> : null}
      <h1 className="dx-display dxf-sign-statement">
        Welcome back. <span className="dx-tone2 dxf-break">Sign in with your email and we’ll send you a link.</span>
      </h1>
    </div>
  );

  const body = sent ? (
    <div className={`dxf-sign-body ${stage ? "dx-surface" : ""} is-sent`}>
      <p className="dxf-sent-title" tabIndex={-1} ref={sentRef}>
        <RewardTick key={sends} label="Sent" />
        <span>{"Check your inbox — the link works for 15 minutes."}</span>
      </p>
      <p className="dx-small dx-muted">
        We sent it to <span className="dxf-sent-email">{sent}</span>. Open it on this device to sign straight in.
      </p>
      {mono ? (
        <p className="dxf-mono-caps dx-muted dxf-sent-times">
          Sent {sentAt} · valid until {validUntil}
        </p>
      ) : null}
      <div className="dxf-sent-actions">
        <button type="button" className="dx-btn dxf-quiet" onClick={() => setSends((k) => k + 1)}>
          Send it again
        </button>
        <button type="button" className="dx-btn is-ghost dxf-quiet" onClick={reset}>
          Use a different email
        </button>
      </div>
    </div>
  ) : (
    <form className={`dxf-sign-body ${stage ? "dx-surface" : ""}`} noValidate onSubmit={onSubmit} aria-label="Sign in">
      <div>
        <label htmlFor={`${uid}-email`} className="dx-label dxf-label">
          Email
        </label>
        <input
          id={`${uid}-email`}
          ref={inputRef}
          className="dx-input dxf-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-error` : `${uid}-hint`}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id={`${uid}-error`} className="dx-error dxf-error">
            {error}
          </p>
        ) : (
          <p id={`${uid}-hint`} className="dxf-hint">
            No password needed. The link signs you in here.
          </p>
        )}
      </div>
      <button type="submit" className="dx-btn is-action dxf-primary dxf-wide">
        Email me a link <Arrow />
      </button>
      <p className="dx-small dx-muted dxf-alt">
        First time here?{" "}
        <Link to={dx.href({ screen: "showcase" })} className="dx-link">
          Register for an event
        </Link>
      </p>
    </form>
  );

  return (
    <CalmPage current="sign-in" quiet={stage ? QUIET_WIDE : undefined}>
      <div className={`dxf-sign ${stage ? "is-stage" : "is-calm"}`}>
        {head}
        {body}
      </div>
    </CalmPage>
  );
}
