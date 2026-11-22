import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession, getSession, signOut } from "../data/auth";
import { isBandBound } from "../data/pair";
import { PageShell, Eyebrow, Panel } from "../components/page";

export default function Account() {
  useEffect(() => {
    document.title = "Account · Connexia";
  }, []);

  const [confirmLost, setConfirmLost] = useState(false);
  const [showPopover, setShowPopover] = useState(false);

  const session = useSession();

  // Check if we need to redirect
  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  // Get band info
  let bandUid: string | null = null;
  let bandBound = false;
  
  // Try to get band from session
  try {
    const storedSession = localStorage.getItem("cnx.session");
    if (storedSession) {
      const parsed = JSON.parse(storedSession);
      bandUid = parsed.bandUid || null;
    }
  } catch {
    // Storage not available
  }

  if (bandUid) {
    bandBound = isBandBound(bandUid, session.email);
  }

  const handleReportLost = () => {
    // Just toggle confirmation
    setConfirmLost(!confirmLost);
  };

  const handleConfirmLost = () => {
    // In mock: clear band from session
    try {
      const storedSession = localStorage.getItem("cnx.session");
      if (storedSession) {
        const parsed = JSON.parse(storedSession);
        delete parsed.bandUid;
        localStorage.setItem("cnx.session", JSON.stringify(parsed));
      }
    } catch {
      // Storage not available
    }
    setConfirmLost(false);
    setShowPopover(false);
  };

  const handleSignOut = () => {
    signOut();
    window.location.href = "/";
  };

  return (
    <PageShell>
      <div className="max-w-[32rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-2 font-serif text-[1.75rem] leading-tight">Account</h1>

        {/* Profile Section */}
        <section className="border-border mt-10 border-t pt-8">
          <h2 className="font-mono text-[0.625rem] tracking-[0.18em] uppercase text-muted-foreground mb-4">
            Profile
          </h2>
          
          <Panel>
            <div className="space-y-4">
              <div>
                <label className="font-mono text-[0.625rem] tracking-[0.12em] uppercase text-muted-foreground">
                  Email
                </label>
                <p className="mt-1 font-mono text-[0.875rem]">{session.email}</p>
              </div>
              <div>
                <label htmlFor="name" className="font-mono text-[0.625rem] tracking-[0.12em] uppercase text-muted-foreground">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  defaultValue={session.name}
                  className="border-input bg-background mt-1 w-full max-w-[20rem] border px-3 py-2 font-mono text-[0.875rem] focus:outline-1 focus:outline-brand motion-reduce:transition-none"
                  disabled
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Profile editing is not available in the mock build.
              </p>
            </div>
          </Panel>
        </section>

        {/* Credential Section */}
        <section className="border-border mt-8 border-t pt-8">
          <h2 className="font-mono text-[0.625rem] tracking-[0.18em] uppercase text-muted-foreground mb-4">
            Credential
          </h2>
          
          <Panel>
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[0.625rem] tracking-[0.12em] uppercase text-muted-foreground">
                  State
                </p>
                <p className="mt-1 font-mono text-[0.875rem] tracking-wider uppercase">
                  READY
                </p>
              </div>
              <div>
                <p className="font-mono text-[0.625rem] tracking-[0.12em] uppercase text-muted-foreground">
                  Wristband
                </p>
                {bandBound && bandUid ? (
                  <>
                    <p className="mt-1 flex items-center gap-2 font-mono text-[0.875rem] uppercase tracking-wider">
                      <span className="bg-success size-1.5" aria-hidden />
                      Bound
                    </p>
                    <p className="mt-1 font-mono text-[0.625rem] text-muted-foreground uppercase">
                      UID: {bandUid}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm">
                    Not bound — 
                    <Link to="/pass/pair" className="underline">
                      bind at the desk
                    </Link>
                  </p>
                )}
              </div>
              
              <button
                type="button"
                onClick={() => setShowPopover(true)}
                className="border-border hover:text-destructive flex h-10 w-full items-center justify-center font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
              >
                Report lost band
              </button>
            </div>
          </Panel>
        </section>

        {/* Privacy Section */}
        <section className="border-border mt-8 border-t pt-8">
          <h2 className="font-mono text-[0.625rem] tracking-[0.18em] uppercase text-muted-foreground mb-4">
            Privacy
          </h2>
          
          <Panel>
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                We store your name, email, registration details and event access history for 30 days after the event ends, then delete.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="#"
                  className="border-border hover:bg-card/50 flex h-9 items-center px-3 font-mono text-[0.625rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
                >
                  Export my data
                </Link>
                <Link
                  to="#"
                  className="border-border hover:border-destructive hover:text-destructive flex h-9 items-center px-3 font-mono text-[0.625rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
                >
                  Delete my data
                </Link>
              </div>
            </div>
          </Panel>
        </section>

        {/* Sign Out */}
        <section className="border-border mt-8 border-t py-8">
          <button
            onClick={handleSignOut}
            className="border-border hover:text-destructive flex h-10 w-full max-w-[20rem] items-center justify-center font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
          >
            Sign out
          </button>
        </section>

        {/* Report Lost Band Confirmation Popover */}
        {showPopover && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowPopover(false)}
          >
            <Panel className="cursor-auto max-w-[24rem] bg-background">
              {confirmLost ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Are you sure? This will immediately invalidate the band it is bound to and revoke any existing credential.
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    You will need to collect a replacement at the desk.
                  </p>
                  <div className="border-border border-t mt-6 flex gap-2 pt-4">
                    <button
                      onClick={() => setConfirmLost(false)}
                      className="hover:bg-card/50 flex-1 font-mono text-[0.6875rem] uppercase tracking-wider py-2.5 transition-colors motion-reduce:transition-none"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmLost}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground flex-1 font-mono text-[0.6875rem] uppercase tracking-wider py-2.5 transition-colors motion-reduce:transition-none"
                    >
                      Confirm lost
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Confirmed bands can be replaced at the desk; you can bind a replacement band yourself and this one will stop working.
                  </p>
                  <div className="border-border border-t mt-6 flex gap-2 pt-4">
                    <button
                      onClick={() => setShowPopover(false)}
                      className="hover:bg-card/50 flex-1 font-mono text-[0.6875rem] uppercase tracking-wider py-2.5 transition-colors motion-reduce:transition-none"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReportLost}
                      className="hover:bg-card/50 flex-1 font-mono text-[0.6875rem] uppercase tracking-wider py-2.5 transition-colors motion-reduce:transition-none"
                    >
                      Mark my band lost
                    </button>
                  </div>
                </>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PageShell>
  );
}
