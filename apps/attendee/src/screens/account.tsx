import { pageTitle } from "@synan/ui/brand";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession, signOut } from "../data/auth";
import { getPass, reportLostBand, tierLabel } from "../data/pass";
import { usePortalVersion } from "../data/mock";
import { PageShell, Eyebrow, Panel } from "../components/page";
import { buttonClass } from "@synan/ui/components";

const sectionTitle = "mb-4 text-13 font-medium text-muted-foreground";
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
      className="m-auto max-w-[28rem] border border-border bg-background p-6 text-foreground backdrop:bg-scrim"
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

  // RequireSession guards this route; this keeps the type narrow.
  if (!session) return null;

  const pass = getPass();

  return (
    <PageShell>
      <div className="max-w-[36rem] pb-6">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-2 font-display text-40 leading-tight">Account</h1>

        <section aria-labelledby="profile-title" className="mt-10 border-t border-border pt-8">
          <h2 id="profile-title" className={sectionTitle}>Profile</h2>
          <Panel>
            <div className="space-y-4">
              <div>
                <p className={label}>Email</p>
                <p className="mt-1 text-15">{session.email}</p>
              </div>
              <div>
                <label htmlFor="name" className={label}>Name</label>
                <input
                  id="name"
                  type="text"
                  defaultValue={session.name}
                  className="mt-1 w-full max-w-[20rem] border border-input bg-background min-h-12 px-3 py-2 text-17 disabled:opacity-60"
                  disabled
                />
              </div>
              <p className="text-13 text-muted-foreground">Profile editing is not available in the mock build.</p>
            </div>
          </Panel>
        </section>

        <section aria-labelledby="credential-title" className="mt-8 border-t border-border pt-8">
          <h2 id="credential-title" className={sectionTitle}>Credential</h2>
          <Panel>
            <div className="space-y-4">
              <div className="flex gap-10">
                <div>
                  <p className={label}>State</p>
                  <p className="mt-1 text-15 font-medium">{pass.state}</p>
                </div>
                <div>
                  <p className={label}>Tier</p>
                  <p className="mt-1 text-15">{tierLabel[pass.tier]}</p>
                </div>
              </div>
              <div>
                <p className={label}>Wristband</p>
                {pass.band ? (
                  <p className="mt-1 flex items-center gap-2 text-17">
                    <span className="size-1.5 bg-success" aria-hidden />
                    Bound · uid {pass.band.hint}
                  </p>
                ) : (
                  <p className="mt-1 text-15">
                    Not bound —{" "}
                    <Link to="/pass/pair" className="underline underline-offset-4">
                      bind at the desk
                    </Link>
                  </p>
                )}
              </div>
              {pass.band ? (
                <button type="button" onClick={() => setConfirmLost(true)} className={buttonClass("danger", "md", "w-full")}>
                  Report lost band
                </button>
              ) : null}
            </div>
          </Panel>
        </section>

        <section id="privacy" aria-labelledby="privacy-title" className="mt-8 border-t border-border pt-8">
          <h2 id="privacy-title" className={sectionTitle}>Privacy</h2>
          <Panel>
            <div className="space-y-4">
              <p className="text-15 leading-relaxed text-muted-foreground">
                We store your name, email and registration. If you allowed zone presence, we record
                which zones your pass entered — never where you stood. Movement records are deleted
                when the event closes and its grace period ends; only counts without your identity
                are kept.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRequested("We will email you a copy of your data.")}
                  className={buttonClass("secondary", "sm")}
                >
                  Export my data
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmErase(true)}
                  className={buttonClass("danger", "sm")}
                >
                  Delete my data
                </button>
              </div>
              <p role="status" className="min-h-4 text-13 text-muted-foreground">{requested}</p>
            </div>
          </Panel>
        </section>

        <section className="mt-8 border-t border-border py-8">
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate("/", { replace: true });
            }}
            className={buttonClass("secondary", "md", "w-full max-w-[20rem]")}
          >
            Sign out
          </button>
        </section>

        {confirmLost ? (
          <ConfirmDialog
            title="Mark your band as lost?"
            confirmLabel="Mark band lost"
            onConfirm={reportLostBand}
            onClose={() => setConfirmLost(false)}
          >
            The band stops working at every door immediately. Your pass stays valid: collect a
            replacement band at the desk, or bind one here with the desk code.
          </ConfirmDialog>
        ) : null}
        {confirmErase ? (
          <ConfirmDialog
            title="Delete your data?"
            confirmLabel="Delete my data"
            onConfirm={() => setRequested("Erasure requested. We'll email you when it's done.")}
            onClose={() => setConfirmErase(false)}
          >
            We'll delete your profile, registrations and pass. This can't be undone, and you won't be
            able to enter events you're registered for. Counts that don't identify you are kept.
          </ConfirmDialog>
        ) : null}
      </div>
    </PageShell>
  );
}
