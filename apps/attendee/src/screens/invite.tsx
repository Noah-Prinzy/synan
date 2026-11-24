/**
 * A10 · Invitation `/invite#token=…` (the link the API emails) and `/invite/:token`.
 *
 * A Private Invitation is answered once (03 §2): accepting or declining spends the link. The page
 * first reads the invitation (POST /invitations/read): the event, who invites, the reply-by time
 * and the event's questions; a link that no longer works says so before anything is typed. The
 * reply needs the address the invitation was sent to (the link is bound to it); accepting also
 * takes the name for the pass, the event's questions and the separate, unticked consent row
 * (03 §5), then the pass is emailed. Declining asks for nothing more than the address. The API
 * does not sign the guest in, so "what happens next" says how to reach the pass.
 */
import { pageTitle } from "@synan/ui/brand";
import { RewardMoment, buttonClass } from "@synan/ui/components";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { fieldClass } from "../components/form-styles";
import { PageHeader, PageShell, Panel } from "../components/page";
import { ConsentRow, describedBy, Field, ProfileFieldList } from "../components/registration-fields";
import { ErrorState, OfflineState, SkeletonCells } from "../components/states";
import { signOut, useSession, type Session } from "../data/auth";
import { formatDay, formatLongDay, formatTime, zoneLabel } from "../data/format";
import {
  devInvitedEmail,
  fingerprint,
  isWellFormedToken,
  readInvitation,
  repliedBefore,
  sendReply,
  validateReply,
  type InvitationPreview,
  type Replied,
  type RsvpOutcome,
} from "../data/invitation";
import { clearDraft, loadDraft, saveDraft, validateProfile, type ProfileField, type RegistrationDraft } from "../data/registration";
import { useResource } from "../data/resource";

type Stage = "reply" | "details" | "decline";
type Failure = Extract<RsvpOutcome, { ok: false }>["reason"];
type Finished = "accepted" | "declined" | "expired" | "registered";

const noFields: ProfileField[] = [];

const primaryButton = buttonClass("primary", "md");
const secondaryButton = buttonClass("secondary", "md");
const backLink =
  "inline-flex min-h-11 items-center text-15 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none";
const inlineLink = "text-foreground underline underline-offset-4 hover:text-brand";

function sameAddress(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function signInPath(email: string): string {
  return `/sign-in?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/pass")}`;
}

/** "Mon 23 Nov · Kampala": the label line under every invitation heading. */
function labelFor(prefix: string, preview: InvitationPreview | null): string {
  if (!preview) return prefix;
  const { event } = preview;
  return [prefix, event.startsAt ? formatDay(event.startsAt, event.timezone) : null, event.city].filter(Boolean).join(" · ");
}

/**
 * Who to ask for a new invitation: the organiser contact the event names, else "the person who
 * invited you".
 */
function Inviter({ contact }: { contact: InvitationPreview["contact"] | undefined }) {
  if (contact?.email) {
    return (
      <>
        {contact.name ?? "the organiser"} at{" "}
        <a href={`mailto:${contact.email}`} className={inlineLink}>
          {contact.email}
        </a>
      </>
    );
  }
  if (contact?.name) return <>{contact.name}</>;
  return <>the person who invited you</>;
}

/** The busy rule inside a working button (the same as registration's Send my pass). */
function BusyRule() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
      <span className="busy-rule absolute inset-y-0 left-0 w-1/3 bg-brand" />
    </span>
  );
}

/**
 * The right-hand cell: the event when it is known, and what happens after the reply. A private
 * event is not listed anywhere, so this is the only place the guest sees it.
 */
function InviteAside({ preview, done = false }: { preview: InvitationPreview | null; done?: boolean }) {
  const steps = [
    "Accept, and we email you a code for the entrance. Nothing to print.",
    "Sign in with the same address to keep your pass on your phone.",
    "At the entrance, show either to collect your wristband. From then on, the wristband opens every door you're allowed through.",
  ];
  return (
    <aside
      aria-label="About this invitation"
      className="border-t border-border px-4 py-10 sm:px-6 lg:border-t-0 lg:border-l lg:px-10 lg:py-12"
    >
      {preview ? (
        <>
          <p className="text-13 font-medium text-muted-foreground">{done ? "You're going to" : "You're invited to"}</p>
          <p className="mt-2 font-display text-21 leading-tight">{preview.event.title}</p>
          <p className="mt-2 text-15 text-muted-foreground">
            {preview.event.startsAt ? (
              <>
                {formatLongDay(preview.event.startsAt, preview.event.timezone)} · doors{" "}
                <span className="font-mono">{formatTime(preview.event.startsAt, preview.event.timezone)}</span>
                <br />
              </>
            ) : null}
            {preview.event.venue}
            {preview.event.venue && preview.event.city ? ", " : ""}
            {preview.event.city}
          </p>
        </>
      ) : null}
      <h2 className={`text-15 font-medium ${preview ? "mt-8 border-t border-border pt-6" : ""}`}>What happens next</h2>
      <ol className="mt-4 flex flex-col gap-4 text-15 text-muted-foreground">
        {(done ? steps.slice(1) : steps).map((line, index) => (
          <li key={line} className="grid grid-cols-[1.75rem_minmax(0,1fr)]">
            <span className="font-mono text-foreground">{String(index + 1).padStart(2, "0")}</span>
            {line}
          </li>
        ))}
      </ol>
      {done ? null : (
        <p className="mt-8 border-t border-border pt-6 text-13 leading-relaxed text-muted-foreground">
          This event is by invitation and isn&apos;t listed publicly. Your link works once, and only with the address
          it was sent to, so there&apos;s no need to forward it.
        </p>
      )}
      {preview ? (
        <p className="mt-4 text-13 text-muted-foreground">Times are {zoneLabel(preview.event.timezone, preview.event.startsAt ?? undefined)}.</p>
      ) : null}
    </aside>
  );
}

/** A finished or refused link: the heading says what happened, the line says what to do. */
function Outcome({
  label,
  title,
  children,
  actions,
  reward,
}: {
  label: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  reward?: ReactNode;
}) {
  return (
    <PageShell bleed>
      <PageHeader label={label} title={title}>
        {reward ? <p className="mb-4 text-15 font-medium text-success">{reward}</p> : null}
        <div className="max-w-[52ch] leading-relaxed">{children}</div>
        <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
      </PageHeader>
    </PageShell>
  );
}

/** Where the guest's pass is, given who (if anyone) is signed in on this device. */
function PassAction({ email, session, label = "Sign in to see your pass" }: { email: string; session: Session | null; label?: string }) {
  const navigate = useNavigate();
  if (sameAddress(session?.email, email)) {
    return (
      <Link to="/pass" className={primaryButton}>
        Open my pass
      </Link>
    );
  }
  if (session) {
    return (
      <button
        type="button"
        className={primaryButton}
        onClick={() => {
          signOut();
          navigate(signInPath(email));
        }}
      >
        Sign out and switch
      </button>
    );
  }
  return (
    <Link to={signInPath(email)} className={primaryButton}>
      {label}
    </Link>
  );
}

function AlreadyReplied({ replied, session }: { replied: Replied; session: Session | null }) {
  useEffect(() => {
    document.title = pageTitle("Invitation");
  }, []);
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(replied.at));
  const what = replied.title ? `the invitation to ${replied.title}` : "this invitation";
  const browse = (
    <Link to="/" className={secondaryButton}>
      Browse events
    </Link>
  );
  if (replied.reply === "declined") {
    return (
      <Outcome label="Private invitation · declined" title="You've already replied." actions={browse}>
        You declined {what} on <span className="font-mono">{when}</span>. The link works once, so to change your mind,
        ask the person who invited you for a new invitation.
      </Outcome>
    );
  }
  return (
    <Outcome
      label="Private invitation · accepted"
      title="You've already accepted."
      actions={
        <>
          <PassAction email={replied.email} session={session} />
          {browse}
        </>
      }
    >
      You accepted {what} on <span className="font-mono">{when}</span>, and your pass went to{" "}
      <span className="text-foreground">{replied.email}</span>.
      {session && !sameAddress(session.email, replied.email) ? (
        <> You&apos;re signed in as {session.email}, so sign out first to see it.</>
      ) : null}
    </Outcome>
  );
}

export default function Invite() {
  const { token: pathToken } = useParams();
  const { hash } = useLocation();
  const fragmentToken = new URLSearchParams(hash.slice(1)).get("token");

  // /invite/:token moves its token into the fragment, where the API's own link keeps it: a
  // fragment never reaches a server log or a Referer.
  if (pathToken) return <Navigate to={{ pathname: "/invite", hash: `token=${pathToken}` }} replace />;
  return <InviteScreen key={fragmentToken ?? ""} token={fragmentToken} />;
}

function InviteScreen({ token }: { token: string | null }) {
  const session = useSession();
  const [replied] = useState(() => (token ? repliedBefore(token) : null));

  if (replied) return <AlreadyReplied replied={replied} session={session} />;
  if (!isWellFormedToken(token)) {
    return <Incomplete />;
  }
  return <Reply token={token} session={session} />;
}

function Incomplete() {
  useEffect(() => {
    document.title = pageTitle("Invitation");
  }, []);
  return (
    <Outcome
      label="Private invitation"
      title="This invitation link is incomplete."
      actions={
        <Link to="/" className={secondaryButton}>
          Browse events
        </Link>
      }
    >
      Part of the link is missing. Open it again from your invitation email. If the link was split over two lines,
      copy all of it into the address bar.
    </Outcome>
  );
}

function Reply({ token, session }: { token: string; session: Session | null }) {
  const draftKey = `invite.${fingerprint(token)}`;
  const invitation = useResource(`invite:${draftKey}`, () => readInvitation(token));
  const read = invitation.status === "ready" ? invitation.data : null;
  const preview = read?.ok ? read.preview : null;
  const fields = preview?.fields ?? noFields;
  const invitedHint = devInvitedEmail();

  const [draft, setDraft] = useState<RegistrationDraft>(() => {
    const saved = loadDraft(draftKey);
    return saved.email === "" && session ? { ...saved, email: session.email } : saved;
  });
  const [stage, setStage] = useState<Stage>("reply");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [sentTo, setSentTo] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const titles: Record<Finished, string> = {
      accepted: "Invitation accepted",
      declined: "Invitation declined",
      expired: "Invitation expired",
      registered: "Already registered",
    };
    document.title = pageTitle(finished ? titles[finished] : "Invitation");
  }, [finished]);

  useEffect(() => {
    if (!finished) saveDraft(draftKey, draft);
  }, [draftKey, draft, finished]);

  // A new stage is announced by moving focus to its heading (not on first load).
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    heading.current?.focus();
  }, [stage]);

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateField(key: "name" | "email", value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearError(key);
    if (key === "email") setFailure((current) => (current === "invalid" ? null : current));
  }

  function checkOnBlur(key: "name" | "email") {
    if (draft[key].trim() === "") return;
    const message = validateReply(draft.email, draft.name)[key];
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

  /** Both replies need the invited address; checked before either goes on. (The name is asked when accepting.) */
  function identityReady(): boolean {
    const next = validateReply(draft.email, draft.name, false);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirst(next);
      return false;
    }
    return true;
  }

  function goTo(next: Stage) {
    setFailure(null);
    setStage(next);
  }

  /** Back to the address, keeping the note beside it until the address changes. */
  function changeAddress() {
    setStage("reply");
    window.setTimeout(() => {
      const field = document.getElementById("email") as HTMLInputElement | null;
      field?.focus();
      field?.select();
    }, 0);
  }

  function submitReply(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!identityReady()) return;
    // Signed in as the invited address: the name on file is the likely answer.
    const known = session && sameAddress(session.email, draft.email) && !session.name.includes("@") ? session.name : "";
    if (draft.name.trim() === "" && known) setDraft((current) => ({ ...current, name: known }));
    goTo("details");
  }

  async function send(accept: boolean) {
    if (sending) return;
    setFailure(null);
    setSending(true);
    const outcome = await sendReply(
      token,
      { accept, email: draft.email, name: draft.name, answers: draft.answers, zoneConsent: draft.zoneConsent },
      preview?.event.title ?? null,
    );
    setSending(false);
    if (outcome.ok) {
      clearDraft(draftKey);
      setSentTo(draft.email.trim());
      setFinished(outcome.reply);
      window.scrollTo({ top: 0 });
      return;
    }
    if (outcome.reason === "expired" || outcome.reason === "registered") {
      setSentTo(draft.email.trim());
      setFinished(outcome.reason);
      window.scrollTo({ top: 0 });
      return;
    }
    setFailure(outcome.reason);
  }

  function submitDetails(formEvent: FormEvent) {
    formEvent.preventDefault();
    const named = validateReply(draft.email, draft.name).name;
    const next = { ...(named ? { name: named } : {}), ...validateProfile(fields, draft.answers) };
    setErrors(next);
    if (Object.keys(next).length > 0) return focusFirst(next);
    void send(true);
  }

  if (invitation.status !== "ready") {
    return (
      <PageShell bleed>
        {invitation.status === "loading" ? (
          <SkeletonCells count={2} />
        ) : invitation.status === "offline" ? (
          <OfflineState what="Your invitation" onRetry={invitation.retry} />
        ) : (
          <ErrorState what="your invitation" onRetry={invitation.retry} />
        )}
      </PageShell>
    );
  }

  const browse = (
    <Link to="/" className={secondaryButton}>
      Browse events
    </Link>
  );

  // POST /invitations/read refused the link: say so before anything is typed.
  if (read && !read.ok && read.reason === "invalid") {
    return (
      <Outcome
        label="Private invitation"
        title="This invitation link no longer works."
        actions={
          <>
            <Link to={session ? "/pass" : `/sign-in?next=${encodeURIComponent("/pass")}`} className={primaryButton}>
              {session ? "Open my pass" : "Sign in to see your pass"}
            </Link>
            {browse}
          </>
        }
      >
        Each invitation link works for one reply, so it may have been used already, declined, or withdrawn by the
        organiser. If you accepted it, your pass is in this app once you sign in. Otherwise, ask the person who
        invited you for a new invitation.
      </Outcome>
    );
  }

  if (finished === "accepted") {
    const signedInAsThem = sameAddress(session?.email, sentTo);
    return (
      <PageShell bleed>
        <PageHeader label={labelFor("Accepted", preview)} title="You're in.">
          <p className="text-15 font-medium text-success">
            <RewardMoment>Invitation accepted{preview ? ` · ${preview.event.title}` : ""}</RewardMoment>
          </p>
        </PageHeader>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="px-4 py-10 sm:px-6 md:px-10 lg:py-12" aria-labelledby="accepted-title">
            <h2 id="accepted-title" className="font-display text-28 leading-tight">
              {signedInAsThem ? "Your pass is ready." : "Your pass is on its way."}
            </h2>
            <p className="mt-3 max-w-[52ch] text-17 leading-relaxed text-muted-foreground">
              {signedInAsThem ? (
                <>It&apos;s in this app now, and a code for the entrance is on its way to {sentTo}.</>
              ) : (
                <>
                  We&apos;ve emailed <span className="text-foreground">{sentTo}</span> a code to show at the entrance. It
                  works once. Sign in with the same address to keep your pass on your phone: it keeps working after the
                  code is used.
                </>
              )}
            </p>
            {session && !signedInAsThem ? (
              <p className="mt-4 max-w-[52ch] text-15 leading-relaxed text-muted-foreground">
                <span aria-hidden="true" className="mr-2 font-mono text-foreground">·</span>
                You&apos;re signed in as {session.email}. This pass belongs to {sentTo}, so sign out first to see it.
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <PassAction email={sentTo} session={session} />
              {browse}
            </div>
            {!signedInAsThem ? (
              <p className="mt-6 max-w-[52ch] text-15 text-muted-foreground">
                Nothing after a few minutes? Check your spam folder.
              </p>
            ) : null}
          </section>
          <InviteAside preview={preview} done />
        </div>
      </PageShell>
    );
  }

  if (finished === "declined") {
    return (
      <Outcome label={labelFor("Declined", preview)} title="Thanks for letting us know." actions={browse}>
        We&apos;ve told the organisers you can&apos;t make it{preview ? ` to ${preview.event.title}` : ""}. There&apos;s
        nothing else to do. Changed your mind? The link worked once, so ask <Inviter contact={preview?.contact} /> for a
        new invitation.
      </Outcome>
    );
  }

  if (finished === "expired" || (read && !read.ok && read.reason === "expired")) {
    return (
      <Outcome label={labelFor("Private invitation", preview)} title="This invitation has expired." actions={browse}>
        Replies closed
        {preview ? (
          <>
            {" "}on <span className="font-mono">{formatDay(preview.expiresAt, preview.event.timezone)}</span>
          </>
        ) : null}
        , or the event is no longer taking guests. If you&apos;d still like to come, ask <Inviter contact={preview?.contact} />{" "}
        for a new invitation.
      </Outcome>
    );
  }

  if (finished === "registered") {
    return (
      <Outcome
        label={labelFor("Private invitation", preview)}
        title="You're already registered."
        actions={
          <>
            <PassAction email={sentTo} session={session} />
            {browse}
          </>
        }
      >
        <span className="text-foreground">{sentTo}</span> already has a pass for this event, so there&apos;s nothing to
        accept. Your pass is where it was: in this app once you sign in, and in the email we sent it with.
      </Outcome>
    );
  }

  const expiresLine = preview
    ? `Reply by ${formatDay(preview.expiresAt, preview.event.timezone)}, ${formatTime(preview.expiresAt, preview.event.timezone)}.`
    : null;
  const signedInHint = session ? (
    <>
      You&apos;re signed in as {session.email}. If the invitation went to another address, use that one.
    </>
  ) : (
    "The address this invitation was sent to."
  );

  const failureBlock = failure ? (
    <FailureNote
      failure={failure}
      email={draft.email.trim()}
      signedInAsTyped={sameAddress(session?.email, draft.email)}
      actionLabel={stage === "decline" ? "Decline invitation" : stage === "details" ? "Accept and send my pass" : "Accept"}
      onChangeAddress={changeAddress}
      contact={preview?.contact}
    />
  ) : null;

  return (
    <PageShell bleed>
      <PageHeader label={labelFor("Private invitation", preview)} title={preview ? preview.event.title : "You're invited."}>
        {preview ? (
          <>
            {preview.host ? `${preview.host} invited you. ` : "You're invited. "}
            {expiresLine}
          </>
        ) : (
          "The event and its details are in your invitation email. Reply here: the link works for one answer."
        )}
      </PageHeader>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <div className="max-w-2xl px-4 pt-8 pb-14 sm:px-6 md:px-10 lg:pt-12">
            {stage === "reply" ? (
              <>
                <p className="text-13 font-medium text-muted-foreground">
                  Step <span className="font-mono">1</span> of <span className="font-mono">2</span>
                </p>
                <h2 ref={heading} tabIndex={-1} className="mt-1 font-display text-28 leading-tight outline-none">
                  Will you join us?
                </h2>
                <p className="mt-2 max-w-[52ch] text-15 text-muted-foreground">
                  You can reply once. Use the address the invitation was sent to.
                </p>
                <form noValidate onSubmit={submitReply} className="mt-6 flex flex-col gap-6">
                  <Field id="email" label="Email" hint={signedInHint} error={errors.email}>
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

                  {invitedHint ? (
                    <Panel className="p-4">
                      <p className="text-13 font-medium text-muted-foreground">Mock build · the invited address</p>
                      <p className="mt-1 text-15">
                        <button
                          type="button"
                          className={`${inlineLink} inline-flex min-h-11 items-center font-mono text-15`}
                          onClick={() => updateField("email", invitedHint)}
                        >
                          {invitedHint}
                        </button>
                      </p>
                    </Panel>
                  ) : null}

                  {failureBlock}

                  <div className="mt-2 flex flex-row-reverse flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
                    <button type="submit" className={primaryButton}>
                      Accept
                    </button>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => {
                        if (identityReady()) goTo("decline");
                      }}
                    >
                      Decline
                    </button>
                  </div>
                </form>
              </>
            ) : stage === "details" ? (
              <>
                <p className="text-13 font-medium text-muted-foreground">
                  Step <span className="font-mono">2</span> of <span className="font-mono">2</span>
                </p>
                <h2 ref={heading} tabIndex={-1} className="mt-1 font-display text-28 leading-tight outline-none">
                  Your details
                </h2>
                <form noValidate onSubmit={submitDetails} className="mt-6 flex flex-col gap-6">
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
                  {fields.length > 0 ? (
                    <p className="max-w-[52ch] text-15 text-muted-foreground">
                      The organisers also ask these to plan the day. Each one says why.
                    </p>
                  ) : null}
                  <ProfileFieldList
                    fields={fields}
                    answers={draft.answers}
                    errors={errors}
                    onAnswer={setAnswer}
                    onToggle={toggleAnswer}
                  />

                  <ConsentRow
                    checked={draft.zoneConsent}
                    onChange={(checked) => setDraft((current) => ({ ...current, zoneConsent: checked }))}
                  />

                  {failureBlock}

                  <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                    <button type="submit" aria-busy={sending || undefined} className={`${primaryButton} ${sending ? "pointer-events-none" : ""}`}>
                      {sending ? "Accepting…" : "Accept and send my pass"}
                      {sending ? <BusyRule /> : null}
                    </button>
                    <button type="button" onClick={() => goTo("reply")} className={backLink}>
                      Back
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <section aria-labelledby="decline-title">
                <h2
                  id="decline-title"
                  ref={heading}
                  tabIndex={-1}
                  className="font-display text-28 leading-tight outline-none"
                >
                  Decline this invitation?
                </h2>
                <p className="mt-3 max-w-[52ch] text-15 leading-relaxed text-muted-foreground">
                  We&apos;ll let the organisers know you can&apos;t come. The link works once, so after this it can&apos;t
                  be used to accept.
                </p>
                {failureBlock ? <div className="mt-6">{failureBlock}</div> : null}
                <div className="mt-6 flex flex-row-reverse flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                  <button
                    type="button"
                    aria-busy={sending || undefined}
                    onClick={() => void send(false)}
                    className={`${secondaryButton} ${sending ? "pointer-events-none" : ""}`}
                  >
                    {sending ? "Sending your reply…" : "Decline invitation"}
                    {sending ? <BusyRule /> : null}
                  </button>
                  <button type="button" onClick={() => goTo("reply")} className={backLink}>
                    Go back
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
        <InviteAside preview={preview} />
      </div>
    </PageShell>
  );
}

/** A reply that did not go through, beside the action that sent it, in plain words. */
function FailureNote({
  failure,
  email,
  signedInAsTyped,
  actionLabel,
  onChangeAddress,
  contact,
}: {
  failure: Failure;
  email: string;
  signedInAsTyped: boolean;
  actionLabel: string;
  onChangeAddress: () => void;
  contact: InvitationPreview["contact"] | undefined;
}) {
  if (failure === "invalid") {
    return (
      <div role="alert" className="border border-destructive/60 p-4">
        <p className="text-15 font-medium text-destructive">
          <span aria-hidden="true" className="mr-2 font-mono">✕</span>
          This invitation doesn&apos;t open with {email}.
        </p>
        <p className="mt-1 max-w-[60ch] text-15 leading-relaxed text-muted-foreground">
          {signedInAsTyped ? <>That&apos;s the address you&apos;re signed in with, but the invitation may have gone to another of yours. </> : null}
          Check it&apos;s the address the invitation was sent to. If you&apos;ve already replied, or the organiser
          withdrew it, the link no longer works: ask <Inviter contact={contact} /> for a new one.
        </p>
        <button type="button" onClick={onChangeAddress} className={`${backLink} mt-1 text-foreground underline underline-offset-4`}>
          Use another address
        </button>
      </div>
    );
  }
  const copy: Record<Exclude<Failure, "invalid" | "expired" | "registered">, { title: string; line: string }> = {
    offline: {
      title: "You're offline, so your reply wasn't sent.",
      line: `Your answers are kept on this device. Press ${actionLabel} again when you're back online.`,
    },
    limited: { title: "Too many tries from here.", line: `Wait a minute, then press ${actionLabel} again.` },
    error: { title: "We couldn't send your reply.", line: `Your answers are kept on this device. Press ${actionLabel} again in a moment.` },
  };
  const entry = failure === "expired" || failure === "registered" ? copy.error : copy[failure];
  return (
    <div role="alert" className="border border-destructive/60 p-4">
      <p className="text-15 font-medium text-destructive">
        <span aria-hidden="true" className="mr-2 font-mono">✕</span>
        {entry.title}
      </p>
      <p className="mt-1 text-15 text-muted-foreground">{entry.line}</p>
    </div>
  );
}
