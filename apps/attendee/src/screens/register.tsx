import { pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buttonClass, RewardMoment } from "@synan/ui/components";
import { PageHeader, PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";
import { useSession } from "../data/auth";
import { formatLongDay, formatTime, zoneLabel } from "../data/format";
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
import type { EventSummary } from "../data/events";
import { checkboxClass, fieldClass, optionClass, selectClass } from "../components/form-styles";

export type Step = "identity" | "profile" | "confirm";

/** Step names say what the person does there, not what the system calls it. */
const steps: { id: Step; label: string }[] = [
  { id: "identity", label: "Your details" },
  { id: "profile", label: "A few questions" },
  { id: "confirm", label: "Check and send" },
];

const primaryButton = buttonClass("primary", "md");
const secondaryButton = buttonClass("secondary", "md");
const backLink =
  "inline-flex min-h-11 items-center text-15 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none";

function Field({
  id,
  label,
  optional = false,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-15 font-medium text-foreground">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-15 text-destructive">
          <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-13 leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hasHint?: unknown): string | undefined {
  return error ? `${id}-error` : hasHint ? `${id}-hint` : undefined;
}

function formatAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not answered";
  return value && value.trim() !== "" ? value : "Not answered";
}

/**
 * The step strip. On phones three named cells do not fit, and the step heading already
 * says "Step 2 of 3", so the strip becomes a thin three-part progress rule.
 */
function Stepper({ slug, activeIndex }: { slug: string; activeIndex: number }) {
  return (
    <>
    <div aria-hidden="true" className="grid grid-cols-3 gap-1 px-4 pt-6 sm:hidden">
      {steps.map((item, index) => (
        <span key={item.id} className={`h-0.5 ${index < activeIndex ? "bg-foreground" : index === activeIndex ? "bg-brand" : "bg-border"}`} />
      ))}
    </div>
    <ol aria-label="Registration steps" className="hidden grid-cols-3 border-b border-border sm:grid">
      {steps.map((item, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "todo";
        const body = (
          <span className={`flex min-h-12 items-center gap-2 py-3 text-15 ${state === "todo" ? "text-muted-foreground" : "text-foreground"}`}>
            <span className="font-mono text-13 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            <span>{item.label}</span>
            {state === "done" ? <span className="sr-only">(done, select to change)</span> : null}
          </span>
        );
        return (
          <li
            key={item.id}
            aria-current={state === "current" ? "step" : undefined}
            className={`relative min-w-0 border-r border-border px-4 last:border-r-0 sm:px-6 md:px-10 ${
              state === "current" ? "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand" : ""
            }`}
          >
            {state === "done" ? (
              <Link
                to={`/events/${slug}/register/${item.id}`}
                className="-mx-4 block px-4 transition-colors duration-120 ease-standard hover:bg-card/50 sm:-mx-6 sm:px-6 md:-mx-10 md:px-10 motion-reduce:transition-none"
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
    </>
  );
}

/** The right-hand cell: what you are registering for, and what happens after. */
function Aside({ event, done = false }: { event: EventSummary; done?: boolean }) {
  return (
    <aside
      aria-label="About this registration"
      className="border-t border-border px-4 py-10 sm:px-6 lg:border-t-0 lg:border-l lg:px-10 lg:py-12"
    >
      <p className="text-13 font-medium text-muted-foreground">{done ? "You're registered for" : "You're registering for"}</p>
      <p className="mt-2 font-display text-21 leading-tight">{event.title}</p>
      <p className="mt-2 text-15 text-muted-foreground">
        {formatLongDay(event.startsAt, event.timezone)} · doors{" "}
        <span className="font-mono">{formatTime(event.startsAt, event.timezone)}</span>
        <br />
        {event.venue}, {event.city}
      </p>
      <h2 className="mt-8 border-t border-border pt-6 text-15 font-medium">What happens next</h2>
      <ol className="mt-4 flex flex-col gap-4 text-15 text-muted-foreground">
        {[
          "We email you a link to your pass. Nothing to print.",
          "At the entrance, show the pass to collect your wristband.",
          "From then on, the wristband opens every door you're allowed through.",
        ].map((line, index) => (
          <li key={line} className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
            <span className="font-mono text-foreground">{String(index + 1).padStart(2, "0")}</span>
            {line}
          </li>
        ))}
      </ol>
      <p className="mt-8 text-13 text-muted-foreground">Times are {zoneLabel(event.timezone, event.startsAt)}.</p>
    </aside>
  );
}

export default function Register({ step }: { step: Step }) {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const event = findEvent(slug);
  const fields = profileFor(slug);

  const [draft, setDraft] = useState<RegistrationDraft>(() => loadDraft(slug));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<null | { email: string }>(null);
  const [failed, setFailed] = useState<null | "offline" | "error">(null);
  // GET /events/:slug/profile-schema — the form waits for it (loading / error / offline).
  const schema = useResource(`register:${slug}`, () => fields.length);

  const activeIndex = steps.findIndex((item) => item.id === step);

  useEffect(() => {
    document.title = pageTitle(sent ? "Registered" : `Register · ${steps[activeIndex]?.label ?? ""}`);
  }, [activeIndex, sent]);

  useEffect(() => {
    if (!sent) saveDraft(slug, draft);
  }, [slug, draft, sent]);

  // A later step cannot be reached with an earlier one incomplete (a pasted link, a refresh).
  useEffect(() => {
    if (!event || step === "identity" || sent) return;
    if (Object.keys(validateIdentity(draft)).length > 0) {
      navigate(`/events/${slug}/register/identity`, { replace: true });
      return;
    }
    if (step === "confirm" && Object.keys(validateProfile(fields, draft.answers)).length > 0) {
      navigate(`/events/${slug}/register/profile`, { replace: true });
    }
  }, [draft, event, fields, navigate, slug, step, sent]);

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateField(key: "name" | "email" | "phone", value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDuplicate(false);
    clearError(key);
  }

  /** Inline check when leaving a filled field: say it now, not after Continue. */
  function checkOnBlur(key: "name" | "email" | "phone") {
    if (draft[key].trim() === "") return;
    const message = validateIdentity(draft)[key];
    if (message) setErrors((current) => ({ ...current, [key]: message }));
  }

  function setAnswer(id: string, value: string) {
    setDraft((current) => ({ ...current, answers: { ...current.answers, [id]: value } }));
    clearError(id);
  }

  function toggleAnswer(id: string, option: string) {
    setDraft((current) => {
      const existing = current.answers[id];
      const list = Array.isArray(existing) ? existing : [];
      const next = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
      return { ...current, answers: { ...current.answers, [id]: next } };
    });
    clearError(id);
  }

  function focusFirst(next: Record<string, string>) {
    const first = Object.keys(next)[0];
    if (first) document.getElementById(first)?.focus();
  }

  function submitIdentity(formEvent: FormEvent) {
    formEvent.preventDefault();
    const next = validateIdentity(draft);
    setErrors(next);
    if (Object.keys(next).length > 0) return focusFirst(next);
    if (isDuplicateEmail(draft.email)) return setDuplicate(true);
    navigate(`/events/${slug}/register/profile`);
  }

  function submitProfile(formEvent: FormEvent) {
    formEvent.preventDefault();
    const next = validateProfile(fields, draft.answers);
    setErrors(next);
    if (Object.keys(next).length > 0) return focusFirst(next);
    navigate(`/events/${slug}/register/confirm`);
  }

  function submitConfirm(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (sending) return;
    setFailed(null);
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      // Mock: an address containing "+fail@" simulates a server failure.
      if (!navigator.onLine) return setFailed("offline");
      if (draft.email.includes("+fail@")) return setFailed("error");
      clearDraft(slug);
      setSent({ email: draft.email.trim() });
      window.scrollTo({ top: 0 });
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
            <Link to="/" className={buttonClass("secondary", "sm")}>
              Browse events
            </Link>
          }
        >
          It may have ended, or registration hasn't opened yet. Invitation-only events are joined from the link in
          your invitation.
        </StateBlock>
      </PageShell>
    );
  }

  const dateLine = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: event.timezone,
  }).format(new Date(event.startsAt));

  const detailRows: { label: string; value: string }[] = [
    { label: "Name", value: draft.name.trim() },
    { label: "Email", value: draft.email.trim() },
    ...(draft.phone.trim() !== "" ? [{ label: "Phone", value: draft.phone.trim() }] : []),
  ];
  const answerRows: { label: string; value: string }[] = [
    ...fields.map((field) => ({ label: field.label, value: formatAnswer(draft.answers[field.id]) })),
    { label: "Share the zones I enter", value: draft.zoneConsent ? "Yes" : "No" },
  ];

  if (sent) {
    // POST /users/register answers 202 and emails a link: the pass opens from that link,
    // which also signs the person in. Already signed in as that address → straight to it.
    const signedInAsThem = session?.email.toLowerCase() === sent.email.toLowerCase();
    const emailedLink = `/verify?token=syn-magic-${encodeURIComponent(sent.email)}&next=${encodeURIComponent("/pass")}`;
    return (
      <PageShell bleed>
        <PageHeader label={`Registered · ${dateLine} · ${event.city}`} title="You're in.">
          <p className="text-15 font-medium text-success">
            <RewardMoment>Registered for {event.title}</RewardMoment>
          </p>
        </PageHeader>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="px-4 py-10 sm:px-6 md:px-10 lg:py-12" aria-labelledby="sent-title">
            <h2 id="sent-title" className="font-display text-28 leading-tight">
              {signedInAsThem ? "Your pass is ready." : "Your pass is on its way."}
            </h2>
            <p className="mt-3 max-w-[52ch] text-17 leading-relaxed text-muted-foreground">
              {signedInAsThem ? (
                <>A copy is also on its way to {sent.email}. Show the pass when you arrive to collect your wristband.</>
              ) : (
                <>
                  We've emailed a link to <span className="text-foreground">{sent.email}</span>. Open it on your phone: it
                  signs you in and opens your pass, which is what you show at the entrance.
                </>
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signedInAsThem ? (
                <Link to="/pass" className={primaryButton}>
                  Open my pass
                </Link>
              ) : import.meta.env.DEV ? (
                <Link to={emailedLink} className={primaryButton}>
                  Open the emailed link
                </Link>
              ) : null}
              <Link to={`/events/${slug}`} className={secondaryButton}>
                Back to the event
              </Link>
            </div>
            {!signedInAsThem ? (
              <p className="mt-6 max-w-[52ch] text-15 text-muted-foreground">
                Nothing after a few minutes? Check your spam folder, or{" "}
                <Link
                  to={`/sign-in?email=${encodeURIComponent(sent.email)}`}
                  className="text-foreground underline underline-offset-4 hover:text-brand"
                >
                  send the link again
                </Link>
                .{import.meta.env.DEV ? " (Mock build: no email is sent; the button above stands in for the link.)" : ""}
              </p>
            ) : null}
          </section>
          <Aside event={event} done />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell bleed>
      <PageHeader label={`Register · ${dateLine} · ${event.city}`} title={event.title}>
        Three short steps. Your pass arrives by email when you're done.
      </PageHeader>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <Stepper slug={slug} activeIndex={activeIndex} />
          <div className="max-w-2xl px-4 pt-8 pb-14 sm:px-6 md:px-10 lg:pt-12">
            <p className="text-13 font-medium text-muted-foreground">
              Step <span className="font-mono">{activeIndex + 1}</span> of <span className="font-mono">3</span>
            </p>
            <h2 className="mt-1 font-display text-28 leading-tight">{steps[activeIndex]?.label}</h2>

            {step === "identity" ? (
              duplicate ? (
                <section className="mt-6" aria-live="polite">
                  <p className="text-17 font-medium">This email is already registered.</p>
                  <p className="mt-2 max-w-[52ch] text-15 leading-relaxed text-muted-foreground">
                    Sign in with {draft.email.trim()} and we'll take you straight to your pass. Nothing you entered
                    is lost if you'd rather use another address.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link to={`/sign-in?email=${encodeURIComponent(draft.email.trim())}`} className={primaryButton}>
                      Sign in instead
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setDuplicate(false);
                        window.setTimeout(() => document.getElementById("email")?.focus(), 0);
                      }}
                      className={secondaryButton}
                    >
                      Use another email
                    </button>
                  </div>
                </section>
              ) : (
                <form noValidate onSubmit={submitIdentity} className="mt-6 flex flex-col gap-6">
                  <Field id="name" label="Full name" hint="As it should appear on your pass." error={errors.name}>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      autoCapitalize="words"
                      enterKeyHint="next"
                      value={draft.name}
                      onChange={(inputEvent) => updateField("name", inputEvent.target.value)}
                      onBlur={() => checkOnBlur("name")}
                      aria-invalid={errors.name ? true : undefined}
                      aria-describedby={describedBy("name", errors.name, true)}
                      className={fieldClass}
                    />
                  </Field>

                  <Field id="email" label="Email" hint="We send your pass here." error={errors.email}>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="next"
                      value={draft.email}
                      onChange={(inputEvent) => updateField("email", inputEvent.target.value)}
                      onBlur={() => checkOnBlur("email")}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={describedBy("email", errors.email, true)}
                      className={fieldClass}
                    />
                  </Field>

                  <Field
                    id="phone"
                    label="Phone"
                    optional
                    hint="Only used if the desk needs to reach you on the day."
                    error={errors.phone}
                  >
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="done"
                      value={draft.phone}
                      onChange={(inputEvent) => updateField("phone", inputEvent.target.value)}
                      onBlur={() => checkOnBlur("phone")}
                      aria-invalid={errors.phone ? true : undefined}
                      aria-describedby={describedBy("phone", errors.phone, true)}
                      className={fieldClass}
                    />
                  </Field>

                  <div className="mt-2 flex flex-row-reverse items-center justify-between gap-4 border-t border-border pt-6">
                    <button type="submit" className={primaryButton}>
                      Continue
                    </button>
                    <Link to={`/events/${slug}`} className={backLink}>
                      Cancel
                    </Link>
                  </div>
                </form>
              )
            ) : step === "profile" ? (
              <form noValidate onSubmit={submitProfile} className="mt-6 flex flex-col gap-6">
                {fields.length > 0 ? (
                  <p className="-mt-2 max-w-[52ch] text-15 text-muted-foreground">
                    The organisers ask these to plan the day. Each one says why.
                  </p>
                ) : null}
                {fields.map((field: ProfileField) => {
                  if (field.kind === "multi") {
                    const value = draft.answers[field.id];
                    const selected = Array.isArray(value) ? value : [];
                    return (
                      <fieldset
                        key={field.id}
                        id={field.id}
                        tabIndex={-1}
                        aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
                        className="flex flex-col gap-3 border-0 p-0 outline-none"
                      >
                        <legend className="mb-2 text-15 font-medium">
                          {field.label}
                          {!field.required ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
                        </legend>
                        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {field.options.map((option) => (
                            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 text-15">
                              <input
                                type="checkbox"
                                checked={selected.includes(option)}
                                onChange={() => toggleAnswer(field.id, option)}
                                className={`${checkboxClass} mt-0`}
                              />
                              {option}
                            </label>
                          ))}
                        </div>
                        {errors[field.id] ? (
                          <p id={`${field.id}-error`} className="text-15 text-destructive">
                            <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
                            {errors[field.id]}
                          </p>
                        ) : field.hint ? (
                          <p id={`${field.id}-hint`} className="text-13 leading-relaxed text-muted-foreground">
                            {field.hint}
                          </p>
                        ) : null}
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
                        optional={!field.required}
                        hint={field.hint}
                        error={errors[field.id]}
                      >
                        <select
                          id={field.id}
                          value={current}
                          onChange={(changeEvent) => setAnswer(field.id, changeEvent.target.value)}
                          aria-invalid={errors[field.id] ? true : undefined}
                          aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
                          className={`${selectClass} ${current === "" ? "text-muted-foreground" : ""}`}
                        >
                          {/* The prompt is shown until a choice is made, and is never itself a choice. */}
                          <option value="" disabled hidden className={optionClass}>
                            Choose one
                          </option>
                          {field.options.map((option) => (
                            <option key={option} value={option} className={optionClass}>
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
                      optional={!field.required}
                      hint={field.hint}
                      error={errors[field.id]}
                    >
                      <input
                        id={field.id}
                        type="text"
                        value={current}
                        placeholder={field.placeholder}
                        enterKeyHint="next"
                        onChange={(inputEvent) => setAnswer(field.id, inputEvent.target.value)}
                        aria-invalid={errors[field.id] ? true : undefined}
                        aria-describedby={describedBy(field.id, errors[field.id], field.hint)}
                        className={fieldClass}
                      />
                    </Field>
                  );
                })}

                <div className="border-t border-border pt-6">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={draft.zoneConsent}
                      onChange={(changeEvent) => setDraft((current) => ({ ...current, zoneConsent: changeEvent.target.checked }))}
                      className={checkboxClass}
                    />
                    <span className="flex flex-col gap-1.5">
                      <span className="text-15 font-medium text-foreground">
                        Share which zones I enter <span className="font-normal text-muted-foreground">(optional)</span>
                      </span>
                      <span className="max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
                        Lets the organisers see which areas you enter during the event, for crowd safety. Your pass
                        works the same either way.
                      </span>
                    </span>
                  </label>
                  <details className="mt-3 pl-8">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-15 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none">
                      What we store
                    </summary>
                    <p className="mt-1 max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
                      The zone you entered, when you entered and left, and the pass that let you in. Never where you
                      stood. These records are deleted when the event closes and its grace period ends; only counts
                      without your name are kept. You can withdraw at any time in Account.
                    </p>
                  </details>
                </div>

                <div className="flex flex-row-reverse items-center justify-between gap-4 border-t border-border pt-6">
                  <button type="submit" className={primaryButton}>
                    Continue
                  </button>
                  <Link to={`/events/${slug}/register/identity`} className={backLink}>
                    Back
                  </Link>
                </div>
              </form>
            ) : (
              <form noValidate onSubmit={submitConfirm} className="mt-6 flex flex-col gap-8">
                {[
                  { title: "Your details", rows: detailRows, edit: "identity" as Step },
                  { title: "Your answers", rows: answerRows, edit: "profile" as Step },
                ].map((group) => (
                  <section key={group.title} aria-label={group.title}>
                    <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                      <h3 className="text-15 font-medium">{group.title}</h3>
                      <Link
                        to={`/events/${slug}/register/${group.edit}`}
                        className="inline-flex min-h-11 items-center text-15 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        Change<span className="sr-only"> {group.title.toLowerCase()}</span>
                      </Link>
                    </div>
                    <dl className="divide-y divide-border">
                      {group.rows.map((row) => (
                        <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
                          <dt className="text-15 text-muted-foreground">{row.label}</dt>
                          <dd className="text-15 wrap-break-word">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}

                {failed ? (
                  <div role="alert" className="border border-destructive/60 p-4">
                    <p className="text-15 font-medium text-destructive">
                      <span aria-hidden="true" className="mr-2 font-mono">✕</span>
                      {failed === "offline" ? "You're offline, so we couldn't send your pass." : "We couldn't send your pass."}
                    </p>
                    <p className="mt-1 text-15 text-muted-foreground">
                      Your answers are saved on this device. Press Send my pass again
                      {failed === "offline" ? " when you're back online" : " in a moment"}.
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                  <button type="submit" aria-busy={sending || undefined} className={`${primaryButton} ${sending ? "pointer-events-none" : ""}`}>
                    {sending ? "Sending your pass…" : "Send my pass"}
                    {sending ? (
                      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
                        <span className="busy-rule absolute inset-y-0 left-0 w-1/3 bg-brand" />
                      </span>
                    ) : null}
                  </button>
                  <Link to={`/events/${slug}/register/profile`} className={backLink}>
                    Back
                  </Link>
                </div>
              </form>
            )}
          </div>
        </div>
        <Aside event={event} />
      </div>
    </PageShell>
  );
}
