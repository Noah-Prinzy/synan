import { pageTitle } from "@synan/ui/brand";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession, signOut } from "../data/auth";
import { loadPass, passChoices, reportLostBand, tierLabel, usePass, type Pass } from "../data/pass";
import { loadProfile, requestDataExport, requestErasure, updateProfile, type Profile } from "../data/account";
import { failureCopy } from "../data/failure-copy";
import { isPhone } from "../data/registration";
import { primeResource, useResource } from "../data/resource";
import { PageHeader, PageShell, RuledRow } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells } from "../components/states";
import { ActionButton, Badge, buttonClass } from "@synan/ui/components";
import { fieldClass } from "../components/form-styles";

const label = "text-13 font-medium text-muted-foreground";

/** The pass (for the credential block) and GET /me (for the profile), together. */
async function loadAccount(): Promise<Profile> {
  const [, profile] = await Promise.all([loadPass(), loadProfile()]);
  return profile;
}

/** "Report lost band": what happened, in words, with the way to a new band. */
type LostReport = { status: "sending" } | { status: "done"; markedLost: boolean } | { status: "failed"; message: string };

/** A native modal dialog: focus is trapped and Escape closes it. */
function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-title"
      // A close that the dialog has already been reopened past (React's development double effect) is not the person's.
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      className="m-auto max-w-md border border-border bg-background p-6 text-foreground backdrop:bg-scrim"
    >
      <h2 id="confirm-title" className="font-display text-28">{title}</h2>
      <div className="mt-3 text-15 leading-relaxed text-muted-foreground">{children}</div>
      <div className="mt-6 flex gap-2 border-t border-border pt-4">
        <button type="button" onClick={onClose} className={buttonClass("quiet", "md", "flex-1")} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={buttonClass("danger", "md", "flex-1")}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export default function Account() {
  useEffect(() => {
    document.title = pageTitle("Account");
  }, []);

  const session = useSession();
  const navigate = useNavigate();
  const [confirmLost, setConfirmLost] = useState(false);
  const [lost, setLost] = useState<LostReport | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  // Load once for the screen's loading/error/offline states; then read live.
  const account = useResource("account", loadAccount);
  const live = usePass();
  const pass = live.status === "ready" ? live.data : null;

  // RequireSession guards this route; this keeps the type narrow.
  if (!session) return null;

  return (
    <PageShell bleed>
      <PageHeader label="Your details" title="Account">
        Signed in as <span className="text-foreground">{session.email}</span>.
      </PageHeader>

      {account.status === "loading" ? (
        <SkeletonCells count={2} />
      ) : account.status === "offline" ? (
        <OfflineState what="Your account" onRetry={account.retry} />
      ) : account.status === "error" ? (
        <ErrorState what="your account" onRetry={account.retry} />
      ) : (
        <AccountRows
          email={session.email}
          profile={account.data}
          pass={pass}
          lost={lost}
          onLost={() => setConfirmLost(true)}
          onExport={() => setRequested("We'll email you a copy of your data, usually within a day.")}
          onErase={() => setConfirmErase(true)}
          requested={requested}
          onSignOut={() => {
            signOut();
            navigate("/", { replace: true });
          }}
        />
      )}

      {confirmLost ? (
        <ConfirmDialog
          title="Mark your band as lost?"
          confirmLabel="Mark band lost"
          onConfirm={() => {
            setLost({ status: "sending" });
            reportLostBand().then(
              (outcome) => setLost({ status: "done", markedLost: outcome.markedLost }),
              (error: unknown) => setLost({ status: "failed", message: failureCopy(error).message }),
            );
          }}
          onClose={() => setConfirmLost(false)}
        >
          The band stops working at every door immediately. Your pass stays valid: collect a replacement band at the
          desk, or bind one here with the desk code.
        </ConfirmDialog>
      ) : null}
      {confirmErase ? (
        <ConfirmDialog
          title="Delete your data?"
          confirmLabel="Delete my data"
          onConfirm={() =>
            void requestErasure().then(
              () => setRequested("Erasure requested. We'll email you when it's done."),
              (error: unknown) => setRequested(failureCopy(error).message),
            )
          }
          onClose={() => setConfirmErase(false)}
        >
          We'll delete your profile, registrations and pass. This can't be undone, and you won't be able to enter
          events you're registered for. Counts that don't identify you are kept.
        </ConfirmDialog>
      ) : null}
    </PageShell>
  );
}

function AccountRows({
  email,
  profile,
  pass,
  lost,
  onLost,
  onExport,
  onErase,
  requested,
  onSignOut,
}: {
  email: string;
  profile: Profile;
  /** Null only against the real API, for someone signed in with no pass issued. */
  pass: Pass | null;
  lost: LostReport | null;
  onLost: () => void;
  onExport: () => void;
  onErase: () => void;
  requested: string | null;
  onSignOut: () => void;
}) {
  // Several passes: say which one this block is about (the one the pass screen shows).
  const several = passChoices().length > 1;
  return (
    <>
      <RuledRow label="Profile">
        <ProfileBlock profile={profile} email={email} />
      </RuledRow>

      {pass ? (
      <RuledRow label="Pass and wristband">
        {several ? <p className="mb-5 text-15 text-muted-foreground">For {pass.event.title}</p> : null}
        <dl className="grid gap-5 sm:grid-cols-3">
          <div>
            <dt className={label}>Pass</dt>
            <dd className="mt-1.5">
              <Badge tone={pass.state === "READY" ? "success" : pass.state === "UNDER REVIEW" ? "warning" : pass.state === "REVOKED" ? "destructive" : "neutral"} dot>
                {pass.state}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className={label}>Tier</dt>
            <dd className="mt-1 text-17">{tierLabel[pass.tier]}</dd>
          </div>
          <div>
            <dt className={label}>Wristband</dt>
            <dd className="mt-1 text-17">
              {pass.band ? (
                <span className="flex items-center gap-2">
                  <span className="size-1.5 bg-success" aria-hidden />
                  Bound <span className="font-mono text-15 text-muted-foreground">{pass.band.hint}</span>
                </span>
              ) : (
                <>
                  {pass.bandLost ? (
                    <span className="flex items-center gap-2">
                      <span className="size-1.5 bg-warning" aria-hidden />
                      Reported lost
                    </span>
                  ) : null}
                  <Link to="/pass/pair" className="-my-3 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-brand">
                    {pass.bandLost ? "Bind a new one" : "Not bound yet — bind one"}
                  </Link>
                </>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/pass" className={buttonClass("secondary", "sm")}>
            Open my pass
          </Link>
          {pass.band && lost?.status !== "sending" ? (
            <button type="button" onClick={onLost} className={buttonClass("danger", "sm")}>
              Report lost band
            </button>
          ) : null}
        </div>
        <div role="status" className="mt-3 min-h-5 max-w-[62ch] text-15 leading-relaxed text-muted-foreground">
          {lost?.status === "sending" ? (
            "Marking your band lost…"
          ) : lost?.status === "failed" ? (
            <span className="text-destructive">
              <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
              {lost.message}
            </span>
          ) : lost?.status === "done" ? (
            <>
              <span className="text-foreground">
                {lost.markedLost ? "Your band is marked lost. It no longer opens any door." : "There was no working band on this pass to mark."}
              </span>{" "}
              Your pass still works. Show it at {pass.nearestDesk} to collect a new band, or bind one here with the code the
              desk gives you.
            </>
          ) : null}
        </div>
      </RuledRow>
      ) : null}

      <RuledRow label="Privacy and your data" id="privacy">
        <p className="max-w-[62ch] text-17 leading-relaxed text-muted-foreground">
          We store your name, email and registration. If you allowed zone presence, we record which zones your pass
          entered — never where you stood. Movement records are deleted when the event closes and its grace period
          ends; only counts without your identity are kept.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionButton
            keepDone
            doneLabel="Requested"
            failedLabel="Try again"
            action={async () => {
              await requestDataExport();
              onExport();
            }}
            className="min-h-11 px-4 text-13"
          >
            Export my data
          </ActionButton>
          <button type="button" onClick={onErase} className={buttonClass("danger", "sm")}>
            Delete my data
          </button>
        </div>
        <p role="status" className="mt-3 min-h-5 text-15 text-muted-foreground">
          {requested}
        </p>
      </RuledRow>

      <RuledRow label="Sign out">
        <p className="text-15 text-muted-foreground">Your pass stays on this device until you sign out.</p>
        <button type="button" onClick={onSignOut} className={buttonClass("secondary", "md", "mt-4")}>
          Sign out
        </button>
      </RuledRow>
    </>
  );
}

/**
 * Name and phone are editable (PATCH /me/profile); the email is the sign-in, so it is not. The
 * phone comes back masked, so the field starts blank: blank keeps the number on file.
 */
function ProfileBlock({ profile: initial, email }: { profile: Profile; email: string }) {
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: initial.name, phone: "" });
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saved, setSaved] = useState(false);
  const invalid = Boolean(errors.name || errors.phone);
  return (
    <>
      <dl className="grid gap-5 sm:grid-cols-3">
        <div>
          <dt className={label}>{editing ? <label htmlFor="profile-name">Name on your pass</label> : "Name on your pass"}</dt>
          <dd className="mt-1 text-17">
            {editing ? (
              <>
                <input
                  id="profile-name"
                  type="text"
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  value={draft.name}
                  onChange={(changeEvent) => {
                    setDraft((current) => ({ ...current, name: changeEvent.target.value }));
                    setErrors((current) => ({ ...current, name: undefined }));
                  }}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? "profile-name-error" : undefined}
                  className={fieldClass}
                />
                {errors.name ? (
                  <p id="profile-name-error" className="mt-2 text-15 text-destructive">
                    <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
                    {errors.name}
                  </p>
                ) : null}
              </>
            ) : (
              <span className="inline-flex items-center gap-2">
                {profile.name}
                {saved ? <span className="text-13 text-muted-foreground">Saved</span> : null}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className={label}>Email</dt>
          <dd className="mt-1 text-17 break-all">{email}</dd>
        </div>
        <div>
          <dt className={label}>{editing ? <label htmlFor="profile-phone">Phone</label> : "Phone"}</dt>
          <dd className="mt-1 text-17">
            {editing ? (
              <>
                <input
                  id="profile-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  value={draft.phone}
                  placeholder={profile.phoneMasked ?? "+256 700 000 000"}
                  onChange={(changeEvent) => {
                    setDraft((current) => ({ ...current, phone: changeEvent.target.value }));
                    setErrors((current) => ({ ...current, phone: undefined }));
                  }}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? "profile-phone-error" : "profile-phone-hint"}
                  className={fieldClass}
                />
                {errors.phone ? (
                  <p id="profile-phone-error" className="mt-2 text-15 text-destructive">
                    <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
                    {errors.phone}
                  </p>
                ) : (
                  <p id="profile-phone-hint" className="mt-2 text-13 text-muted-foreground">
                    {profile.phoneMasked ? "Leave it blank to keep the number on file." : "Optional."}
                  </p>
                )}
              </>
            ) : profile.phoneMasked ? (
              <span className="font-mono text-15">{profile.phoneMasked}</span>
            ) : (
              <span className="text-muted-foreground">Not given</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {editing ? (
          <>
            <ActionButton
              variant="primary"
              doneLabel="Saved"
              action={async () => {
                const problems: { name?: string; phone?: string } = {};
                if (draft.name.trim().length < 2) problems.name = "Enter your name as it should appear on your pass.";
                if (draft.phone.trim() !== "" && !isPhone(draft.phone)) {
                  problems.phone = "That number looks too short. Include the country code, or leave it blank.";
                }
                setErrors(problems);
                if (problems.name || problems.phone) throw new Error("invalid");
                const next = await updateProfile({
                  name: draft.name.trim() !== profile.name ? draft.name : undefined,
                  phone: draft.phone.trim() || undefined,
                });
                setProfile(next);
                primeResource("account", next);
                setSaved(true);
                window.setTimeout(() => setEditing(false), 700);
              }}
              failedLabel={invalid ? "Check the details" : "Couldn't save. Try again"}
              className="min-h-11 px-4 text-13"
            >
              Save details
            </ActionButton>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setErrors({});
              }}
              className={buttonClass("quiet", "sm")}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft({ name: profile.name, phone: "" });
              setErrors({});
              setSaved(false);
              setEditing(true);
            }}
            className={buttonClass("secondary", "sm")}
          >
            Edit details
          </button>
        )}
        <p className="text-15 text-muted-foreground">Your email is how you sign in, so it can't be changed here.</p>
      </div>
    </>
  );
}
