import { pageTitle } from "@synan/ui/brand";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession, signOut } from "../data/auth";
import { getPass, reportLostBand, tierLabel } from "../data/pass";
import { usePortalVersion, useResource } from "../data/mock";
import { PageHeader, PageShell, RuledRow } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells } from "../components/states";
import { buttonClass } from "@synan/ui/components";

const label = "text-13 font-medium text-muted-foreground";

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
      onClose={onClose}
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

  usePortalVersion();
  const session = useSession();
  const navigate = useNavigate();
  const [confirmLost, setConfirmLost] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  // Load once for the screen's loading/error/offline states; then read live.
  const account = useResource("account", () => getPass());

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
          name={session.name}
          onLost={() => setConfirmLost(true)}
          onExport={() => setRequested("We'll email you a copy of your data.")}
          onErase={() => setConfirmErase(true)}
          requested={requested}
          onSignOut={() => {
            signOut();
            navigate("/", { replace: true });
          }}
        />
      )}

      {confirmLost ? (
        <ConfirmDialog title="Mark your band as lost?" confirmLabel="Mark band lost" onConfirm={reportLostBand} onClose={() => setConfirmLost(false)}>
          The band stops working at every door immediately. Your pass stays valid: collect a replacement band at the
          desk, or bind one here with the desk code.
        </ConfirmDialog>
      ) : null}
      {confirmErase ? (
        <ConfirmDialog
          title="Delete your data?"
          confirmLabel="Delete my data"
          onConfirm={() => setRequested("Erasure requested. We'll email you when it's done.")}
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
  name,
  onLost,
  onExport,
  onErase,
  requested,
  onSignOut,
}: {
  email: string;
  name: string;
  onLost: () => void;
  onExport: () => void;
  onErase: () => void;
  requested: string | null;
  onSignOut: () => void;
}) {
  const pass = getPass();
  return (
    <>
      <RuledRow label="Profile">
        <dl className="grid gap-5 sm:grid-cols-2">
          <div>
            <dt className={label}>Name</dt>
            <dd className="mt-1 text-17">{name}</dd>
          </div>
          <div>
            <dt className={label}>Email</dt>
            <dd className="mt-1 text-17 break-all">{email}</dd>
          </div>
        </dl>
        <p className="mt-5 text-15 text-muted-foreground">Editing your profile arrives with the real account service.</p>
      </RuledRow>

      <RuledRow label="Pass and wristband">
        <dl className="grid gap-5 sm:grid-cols-3">
          <div>
            <dt className={label}>Pass</dt>
            <dd className="mt-1 text-17 font-medium">{pass.state}</dd>
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
                <Link to="/pass/pair" className="underline underline-offset-4">
                  Not bound — bind one
                </Link>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/pass" className={buttonClass("secondary", "sm")}>
            Open my pass
          </Link>
          {pass.band ? (
            <button type="button" onClick={onLost} className={buttonClass("danger", "sm")}>
              Report lost band
            </button>
          ) : null}
        </div>
      </RuledRow>

      <RuledRow label="Privacy and your data" id="privacy">
        <p className="max-w-[62ch] text-17 leading-relaxed text-muted-foreground">
          We store your name, email and registration. If you allowed zone presence, we record which zones your pass
          entered — never where you stood. Movement records are deleted when the event closes and its grace period
          ends; only counts without your identity are kept.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onExport} className={buttonClass("secondary", "sm")}>
            Export my data
          </button>
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
