import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SiteHeader from "../components/site-header";
import {
  clearDraft,
  findEvent,
  isDuplicateEmail,
  loadDraft,
  profileFor,
  saveDraft,
  validateIdentity,
  validateProfile,
  type ProfileField,
  type RegistrationDraft,
} from "../data/registration";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute top-0 -left-[9999px] focus:left-4 focus:top-4 focus:z-50 focus:block focus:border focus:border-brand focus:bg-background focus:px-3 focus:py-2 focus:font-mono focus:text-[0.6875rem] focus:tracking-[0.12em] focus:text-brand focus:uppercase focus:underline focus:underline-offset-2"
    >
      Skip to content
    </a>
  );
}

export type Step = "identity" | "profile" | "confirm";

const steps: { id: Step; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "profile", label: "Profile" },
  { id: "confirm", label: "Confirm" },
];

const fieldClass =
  "w-full border border-border bg-transparent px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand aria-[invalid=true]:border-destructive motion-reduce:transition-none";

const primaryButton =
  "inline-flex items-center justify-center bg-foreground px-5 py-2.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-background transition-opacity hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none";

const secondaryButton =
  "inline-flex items-center justify-center border border-border px-5 py-2.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors hover:border-brand hover:text-brand motion-reduce:transition-none";

const checkboxClass =
  "mt-0.5 size-4 shrink-0 appearance-none border border-border bg-transparent transition-colors checked:border-brand checked:bg-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-reduce:transition-none";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {error && (
        <p
          id={`${id}-error`}
          className="font-mono text-[0.625rem] tracking-[0.08em] text-destructive uppercase"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function formatAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  return value && value.trim() !== "" ? value : "—";
}

export default function Register({ step }: { step: Step }) {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const event = findEvent(slug);
  const fields = profileFor(slug);
  const isIdentityStep = step === "identity";
  const isProfileStep = step === "profile";

  useEffect(() => {
    document.title = "Register · Connexia";
  }, []);

  const [draft, setDraft] = useState<RegistrationDraft>(() => loadDraft(slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    saveDraft(slug, draft);
  }, [slug, draft]);

  const activeIndex = steps.findIndex((item) => item.id === step);

  useEffect(() => {
    if (!event || step === "identity") return;

    const identityErrors = validateIdentity(draft);
    if (Object.keys(identityErrors).length > 0) {
      navigate(`/events/${slug}/register/identity`, { replace: true });
      return;
    }

    if (step === "confirm") {
      const profileErrors = validateProfile(fields, draft.answers);
      if (Object.keys(profileErrors).length > 0) {
        navigate(`/events/${slug}/register/profile`, { replace: true });
      }
    }
  }, [draft, event, fields, navigate, slug, step]);

  function update(patch: Partial<RegistrationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateField(
    key: "name" | "email" | "phone",
    value: string,
  ) {
    update({ [key]: value });
    setDuplicate(false);
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setAnswer(id: string, value: string) {
    setDraft((current) => ({
      ...current,
      answers: { ...current.answers, [id]: value },
    }));
    setErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function toggleAnswer(id: string, option: string) {
    setDraft((current) => {
      const existing = current.answers[id];
      const list = Array.isArray(existing) ? existing : [];
      const next = list.includes(option)
        ? list.filter((item) => item !== option)
        : [...list, option];
      return { ...current, answers: { ...current.answers, [id]: next } };
    });
    setErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function submitIdentity(formEvent: FormEvent) {
    formEvent.preventDefault();
    const next = validateIdentity(draft);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Focus first invalid field
      const firstErrorKey = Object.keys(next)[0];
      if (firstErrorKey) {
        const el = document.getElementById(firstErrorKey);
        el?.focus();
      }
      return;
    }

    if (isDuplicateEmail(draft.email)) {
      setDuplicate(true);
      return;
    }

    navigate(`/events/${slug}/register/profile`);
  }

  function submitProfile(formEvent: FormEvent) {
    formEvent.preventDefault();
    const next = validateProfile(fields, draft.answers);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Focus first invalid field
      const firstErrorKey = Object.keys(next)[0];
      if (firstErrorKey) {
        const el = document.getElementById(firstErrorKey);
        el?.focus();
      }
      return;
    }
    navigate(`/events/${slug}/register/confirm`);
  }

  function submitConfirm(formEvent: FormEvent) {
    formEvent.preventDefault();
    setSending(true);
    window.setTimeout(() => {
      clearDraft(slug);
      setSending(false);
      setSent(true);
    }, 700);
  }

  if (!event) {
    return (
      <main className="bg-background text-foreground flex min-h-dvh flex-col">
        <SkipLink />
        <SiteHeader />
        <div id="content" className="mx-auto w-full max-w-[1600px] px-6 py-20 md:px-10 xl:px-16">
          <h1 className="font-serif text-3xl">Registration unavailable.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This event does not exist, or registration has not opened.
          </p>
          <Link to="/" className={`${secondaryButton} mt-8`}>
            Browse events
          </Link>
        </div>
      </main>
    );
  }

  const dateLine = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: event.timezone,
  }).format(new Date(event.startsAt));

  const summaryRows: { label: string; value: string }[] = [
    { label: "Name", value: draft.name },
    { label: "Email", value: draft.email },
    ...(draft.phone.trim() !== "" ? [{ label: "Phone", value: draft.phone }] : []),
    ...fields.map((field) => ({
      label: field.label,
      value: formatAnswer(draft.answers[field.id]),
    })),
    { label: "Zone presence", value: draft.zoneConsent ? "Allowed" : "Declined" },
  ];

  return (
    <main className="bg-background text-foreground min-h-dvh">
      <SkipLink />
      <SiteHeader />

      <div id="content" className="mx-auto w-full max-w-[1600px] px-6 pt-10 pb-24 md:px-10 xl:px-16">
        <p className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
          {dateLine} · {event.city}
        </p>
        <h1 className="mt-3 font-serif text-3xl leading-tight">{event.title}</h1>

        <ol
          aria-label="Registration steps"
          className="border-border mt-8 grid grid-cols-3 border-b"
        >
          {steps.map((item, index) => {
            const state =
              index < activeIndex ? "done" : index === activeIndex ? "current" : "todo";
            const body = (
              <span
                className={`flex items-center gap-2 px-1 py-3 font-mono text-[0.625rem] tracking-[0.12em] uppercase ${
                  state === "todo" ? "text-muted-foreground/60" : "text-foreground"
                }`}
              >
                <span className={state === "done" ? "text-muted-foreground" : ""}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.label}
              </span>
            );

            return (
              <li
                key={item.id}
                className={`relative -mb-px border-b-2 ${
                  state === "current" ? "border-brand" : "border-transparent"
                }`}
              >
                {state === "done" ? (
                  <Link
                    to={`/events/${slug}/register/${item.id}`}
                    className="block transition-colors hover:bg-card/50"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ol>

        {sent ? (
          <section className="pt-10">
            <p className="font-mono text-[0.625rem] tracking-[0.12em] text-success uppercase">
              Registered
            </p>
            <h2 className="mt-3 font-serif text-3xl">You&rsquo;re in.</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Your pass is ready. Bring it to the gate — the QR still works if the venue network
              drops.
            </p>
            <p className="mt-6 font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase">
              Credential · READY
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/pass" className={primaryButton}>
                Open my pass
              </Link>
              <Link to={`/events/${slug}`} className={secondaryButton}>
                Back to event
              </Link>
            </div>
          </section>
        ) : step === "identity" ? (
          duplicate ? (
            <section className="pt-8">
              <h2 className="font-serif text-2xl">This email already has a pass.</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                Sign in with {draft.email.trim()} and we&rsquo;ll take you straight to it.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to={`/sign-in?email=${encodeURIComponent(draft.email.trim())}`}
                  className={primaryButton}
                >
                  Sign in
                </Link>
                <button
                  type="button"
                  onClick={() => setDuplicate(false)}
                  className={secondaryButton}
                >
                  Use another email
                </button>
              </div>
            </section>
          ) : (
            <form noValidate onSubmit={submitIdentity} className="flex flex-col gap-6 pt-8">
              <div className="grid gap-8 md:grid-cols-2">
                <Field id="name" label="Full name" error={errors.name}>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={draft.name}
                    onChange={(inputEvent) => updateField("name", inputEvent.target.value)}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "name-error" : undefined}
                    className={fieldClass}
                  />
                </Field>

                <Field id="email" label="Email" error={errors.email}>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={draft.email}
                    onChange={(inputEvent) => updateField("email", inputEvent.target.value)}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    className={fieldClass}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Field
                    id="phone"
                    label="Phone (optional)"
                    hint="Only used at the desk if the gate needs to reach you."
                    error={errors.phone}
                  >
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      value={draft.phone}
                      onChange={(inputEvent) => updateField("phone", inputEvent.target.value)}
                      aria-invalid={errors.phone ? true : undefined}
                      aria-describedby={errors.phone ? "phone-error" : undefined}
                      className={fieldClass}
                    />
                  </Field>
                </div>
              </div>

              <div className="border-border flex items-center justify-between gap-4 border-t pt-6">
                <Link
                  to={`/events/${slug}`}
                  className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-brand motion-reduce:transition-none"
                >
                  Cancel
                </Link>
                <button type="submit" className={primaryButton}>
                  Continue
                </button>
              </div>
            </form>
          )
        ) : step === "profile" ? (
          <form noValidate onSubmit={submitProfile} className="flex flex-col gap-6 pt-8">
            <div className="grid gap-8 md:grid-cols-2">
              {fields.map((field: ProfileField) => {
                if (field.kind === "multi") {
                  const value = draft.answers[field.id];
                  const selected = Array.isArray(value) ? value : [];
                  return (
                    <fieldset key={field.id} className="flex flex-col gap-3 border-0 p-0 md:col-span-2">
                      <legend className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
                        {field.label}
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {field.options.map((option) => (
                          <label key={option} className="flex cursor-pointer items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              checked={selected.includes(option)}
                              onChange={() => toggleAnswer(field.id, option)}
                              className={checkboxClass}
                            />
                            {option}
                          </label>
                        ))}
                      </div>
                      {field.hint && !errors[field.id] && (
                        <p className="text-xs leading-relaxed text-muted-foreground">{field.hint}</p>
                      )}
                      {errors[field.id] && (
                        <p className="font-mono text-[0.625rem] tracking-[0.08em] text-destructive uppercase">
                          {errors[field.id]}
                        </p>
                      )}
                    </fieldset>
                  );
                }

                const value = draft.answers[field.id];
                const current = typeof value === "string" ? value : "";

                if (field.kind === "select") {
                  return (
                    <Field
                      key={field.id}
                      id={field.id}
                      label={field.label}
                      error={errors[field.id]}
                    >
                      <select
                        id={field.id}
                        value={current}
                        onChange={(changeEvent) => setAnswer(field.id, changeEvent.target.value)}
                        aria-invalid={errors[field.id] ? true : undefined}
                        aria-describedby={errors[field.id] ? `${field.id}-error` : undefined}
                        className={`${fieldClass} bg-background`}
                      >
                        <option value="" disabled>
                          Select
                        </option>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                }

                return (
                  <Field
                    key={field.id}
                    id={field.id}
                    label={field.label}
                    hint={field.hint}
                    error={errors[field.id]}
                  >
                    <input
                      id={field.id}
                      type="text"
                      value={current}
                      placeholder={field.placeholder}
                      onChange={(inputEvent) => setAnswer(field.id, inputEvent.target.value)}
                      aria-invalid={errors[field.id] ? true : undefined}
                      aria-describedby={errors[field.id] ? `${field.id}-error` : undefined}
                      className={fieldClass}
                    />
                  </Field>
                );
              })}
            </div>

            <div className="border-border border-t pt-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={draft.zoneConsent}
                  onChange={(changeEvent) => update({ zoneConsent: changeEvent.target.checked })}
                  className={checkboxClass}
                />
                <span className="flex flex-col gap-1.5">
                  <span className="text-sm text-foreground">Zone presence reporting</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    Let organizers see which zones I enter during the event, for capacity and
                    safety. Optional, and separate from my registration.
                  </span>
                </span>
              </label>
              <details className="mt-3 pl-7">
                <summary className="cursor-pointer font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-brand motion-reduce:transition-none">
                  What we store
                </summary>
                <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                  The zone you entered, when you entered and left, and the credential that admitted
                  you. No precise coordinates are recorded. Raw events are kept for 30 days;
                  aggregates continue without identifiers. You can withdraw consent at any time in
                  Account.
                </p>
              </details>
            </div>

            <div className="border-border flex items-center justify-between gap-4 border-t pt-6">
              <Link
                to={`/events/${slug}/register/identity`}
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-brand motion-reduce:transition-none"
              >
                Back
              </Link>
              <button type="submit" className={primaryButton}>
                Continue
              </button>
            </div>
          </form>
        ) : (
          <form noValidate onSubmit={submitConfirm} className="flex flex-col gap-8 pt-8">
            <dl className="border-border divide-border divide-y border-y">
              {summaryRows.map((row) => (
                <div key={row.label} className="grid grid-cols-[12rem_1fr] gap-4 py-3">
                  <dt className="font-mono text-[0.625rem] tracking-[0.08em] text-muted-foreground uppercase">
                    {row.label}
                  </dt>
                  <dd className="text-sm break-words">{row.value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <Link
                to={`/events/${slug}/register/profile`}
                className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase transition-colors hover:text-brand motion-reduce:transition-none"
              >
                Back
              </Link>
              <button type="submit" disabled={sending} className={primaryButton}>
                {sending ? "Sending…" : "Send my pass"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
