import { pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buttonClass } from "@synan/ui/components";
import { PageHeader, PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";
import { useResource } from "../data/mock";
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

export type Step = "identity" | "profile" | "confirm";

const steps: { id: Step; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "profile", label: "Profile" },
  { id: "confirm", label: "Confirm" },
];

const fieldClass =
  "min-h-12 w-full border border-border bg-transparent px-3 py-2.5 text-17 text-foreground outline-none transition-colors duration-120 ease-standard placeholder:text-muted-foreground focus:border-brand aria-[invalid=true]:border-destructive motion-reduce:transition-none";

const primaryButton = buttonClass("primary", "md");

const secondaryButton = buttonClass("secondary", "md");

const checkboxClass =
  "mt-0.5 size-5 shrink-0 appearance-none border border-border bg-transparent transition-colors checked:border-brand checked:bg-brand focus-visible:outline focus-visible:outline-brand motion-reduce:transition-none";

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
        className="text-13 font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-13 leading-relaxed text-muted-foreground">{hint}</p>}
      {error && (
        <p
          id={`${id}-error`}
          className="text-13 font-medium text-destructive"
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
    document.title = pageTitle("Register");
  }, []);

  const [draft, setDraft] = useState<RegistrationDraft>(() => loadDraft(slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<null | "offline" | "error">(null);
  // GET /events/:slug/profile-schema — the form waits for it (loading / error / offline).
  const schema = useResource(`register:${slug}`, () => fields.length);

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
    setFailed(null);
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      // Mock: an address containing "+fail@" simulates a server failure.
      if (!navigator.onLine) return setFailed("offline");
      if (draft.email.includes("+fail@")) return setFailed("error");
      clearDraft(slug);
      setSent(true);
    }, 700);
  }

  if (schema.status !== "ready") {
    return (
      <PageShell bleed>
        {schema.status === "loading" ? (
          <SkeletonCells count={2} />
        ) : schema.status === "offline" ? (
          <OfflineState what="Registration" onRetry={schema.retry} />
        ) : (
          <ErrorState what="the registration form" onRetry={schema.retry} />
        )}
      </PageShell>
    );
  }

  if (!event) {
    return (
      <PageShell bleed>
        <StateBlock
          glyph="·"
          title="Registration isn't open for this event."
          action={
            <Link to="/" className={secondaryButton}>
              Browse events
            </Link>
          }
        >
          It may not exist, or registration hasn't opened yet.
        </StateBlock>
      </PageShell>
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
    <PageShell bleed>
        <PageHeader label={`Register · ${dateLine} · ${event.city}`} title={event.title} />

        <ol aria-label="Registration steps" className="grid grid-cols-3 border-b border-border">
          {steps.map((item, index) => {
            const state =
              index < activeIndex ? "done" : index === activeIndex ? "current" : "todo";
            const body = (
              <span
                className={`flex min-h-12 items-center gap-2 px-1 py-3 text-15 ${
                  state === "todo" ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                <span className={`font-mono text-13 ${state === "done" ? "text-muted-foreground" : ""}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.label}
              </span>
            );

            return (
              <li
                key={item.id}
                aria-current={state === "current" ? "step" : undefined}
                className={`relative border-r border-border px-4 last:border-r-0 sm:px-6 md:px-10 ${
                  state === "current" ? "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand" : ""
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

        <div className="px-4 pb-14 sm:px-6 md:px-10">

        {sent ? (
          <section className="pt-10">
            <p className="text-13 font-medium text-success">
              Registered
            </p>
            <h2 className="mt-3 font-serif text-40">You&rsquo;re in.</h2>
            <p className="mt-3 max-w-md text-15 leading-relaxed text-muted-foreground">
              Your pass is ready, and a copy is on its way to your email. Show the pass when you
              arrive to collect your wristband — it works even if the venue network drops.
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
              <h2 className="font-serif text-28">This email already has a pass.</h2>
              <p className="mt-3 max-w-md text-15 leading-relaxed text-muted-foreground">
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
                  className="inline-flex min-h-11 items-center text-15 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
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
                      <legend className="text-13 font-medium text-muted-foreground">
                        {field.label}
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {field.options.map((option) => (
                          <label key={option} className="flex cursor-pointer items-start gap-3 text-15">
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
                        <p className="text-13 leading-relaxed text-muted-foreground">{field.hint}</p>
                      )}
                      {errors[field.id] && (
                        <p className="text-13 font-medium text-destructive">
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
                  <span className="text-15 text-foreground">Zone presence reporting</span>
                  <span className="text-15 leading-relaxed text-muted-foreground">
                    Let organizers see which zones I enter during the event, for capacity and
                    safety. Optional, and separate from my registration.
                  </span>
                </span>
              </label>
              <details className="mt-3 pl-7">
                <summary className="cursor-pointer text-13 font-medium text-muted-foreground  transition-colors hover:text-brand motion-reduce:transition-none">
                  What we store
                </summary>
                <p className="mt-2 max-w-prose text-13 leading-relaxed text-muted-foreground">
                  The zone you entered, when you entered and left, and the credential that admitted
                  you. No precise coordinates are recorded. These records are deleted when the
                  event closes and its grace period ends; only counts without your identity are
                  kept. You can withdraw consent at any time in Account.
                </p>
              </details>
            </div>

            <div className="border-border flex items-center justify-between gap-4 border-t pt-6">
              <Link
                to={`/events/${slug}/register/identity`}
                className="inline-flex min-h-11 items-center text-15 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
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
                <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-13 font-medium text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="text-15 wrap-break-word">{row.value}</dd>
                </div>
              ))}
            </dl>

            {failed ? (
              <div role="alert" className="border border-destructive/60 p-4">
                <p className="text-15 font-medium text-destructive">
                  <span aria-hidden="true" className="mr-2 font-mono">✕</span>
                  {failed === "offline" ? "You're offline, so we couldn't send your pass." : "We couldn't send your pass."}
                </p>
                <p className="mt-1 text-15 text-muted-foreground">
                  Your answers are saved on this device. Try again{failed === "offline" ? " when you're back online" : ""}.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <Link
                to={`/events/${slug}/register/profile`}
                className="inline-flex min-h-11 items-center text-15 text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
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
    </PageShell>
  );
}
