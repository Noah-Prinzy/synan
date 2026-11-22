import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useSession, getSession } from "../data/auth";
import { bindBand, devCodeHint, getBand, type BindResult } from "../data/pair";
import { persistBandForSession } from "../data/pass";
import { PageShell, Eyebrow, Panel } from "../components/page";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute left-0 top-0 -translate-y-full bg-background px-4 py-3 text-sm text-foreground focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}

export default function PassPair() {
  useEffect(() => {
    document.title = "Bind band · Connexia";
  }, []);

  const session = useSession();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"tap" | "code">("tap");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorType, setErrorType] = useState<"already_bound" | "unknown_band" | null>(null);
  const [result, setResult] = useState<BindResult | null>(null);

  // Check if already has a band bound
  const [hasBand, setHasBand] = useState(false);

  useEffect(() => {
    if (session) {
      // Check if already has band
      const storedSession = getSession();
      if (storedSession) {
        try {
          const sessionData = localStorage.getItem("cnx.session");
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            setHasBand(!!parsed.bandUid);
          }
        } catch {
          // Storage not available
        }
      }
    }
  }, [session]);

  // If already has band bound, redirect to pass
  useEffect(() => {
    if (hasBand && session) {
      // Give a moment for the redirect
      const timer = setTimeout(() => {
        window.location.href = "/pass";
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [hasBand, session]);

  // Check if session exists
  if (!session) {
    return <Navigate to="/sign-in?next=/pass/pair" replace />;
  }

  // NFC availability check
  const nfcSupported = "NDEFReader" in window;
  
  // If NFC not supported, switch to code tab
  useEffect(() => {
    if (!nfcSupported && activeTab === "tap") {
      setActiveTab("code");
    }
  }, [activeTab, nfcSupported]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim() || state === "loading") return;

    setState("loading");
    setErrorType(null);

    // Small delay to show loading state
    await new Promise((resolve) => setTimeout(resolve, 400));

    const bindResult = bindBand(code.trim(), session.email);
    setResult(bindResult);

    if (bindResult.ok) {
      // Persist band to session
      persistBandForSession(bindResult.band.uid);
      setState("success");
    } else {
      setState("error");
      setErrorType(bindResult.reason);
    }
  };

  const handleTabChange = (tab: "tap" | "code") => {
    // Prevent switching to tap if NFC not available
    if (tab === "tap" && !nfcSupported) return;
    setActiveTab(tab);
    setState("idle");
    setErrorType(null);
  };

  // Handle success state
  if (state === "success" && result?.ok) {
    return (
      <PageShell>
        <SkipLink />
        <div className="pt-10 md:pt-14 xl:pt-16">
          <Eyebrow>Bind band</Eyebrow>
          <h1 className="mt-2 font-serif text-2xl leading-tight">Band bound</h1>
          <Panel className="mt-8">
            <p className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
              Band UID
            </p>
            <p className="mt-2 font-mono text-[0.875rem] tracking-wider uppercase">
              {result.band.uid}
            </p>
            <p className="mt-4 text-sm">This band is now you.</p>
          </Panel>
          <div className="mt-8">
            <Link
              to="/pass"
              className="bg-brand hover:bg-brand/90 border-border h-12 flex items-center justify-center px-8 text-white font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
            >
              View my pass
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>Bind band</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">Bind your band</h1>

        {hasBand && (
          <Panel className="mt-6 border-border bg-warning/10 border-warning">
            <p className="text-sm">{session.name}, you already have a band bound.</p>
          </Panel>
        )}

        <div className="border-border mt-8 border-b">
          <nav className="flex gap-8" aria-label="Binding method">
            <button
              onClick={() => handleTabChange("tap")}
              disabled={!nfcSupported}
              className={`border-border pb-3 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none ${
                activeTab === "tap"
                  ? "text-brand border-b border-brand"
                  : "text-muted-foreground hover:text-foreground"
              } ${!nfcSupported ? "opacity-50 cursor-not-allowed" : ""}`}
              type="button"
            >
              Tap
            </button>
            <button
              onClick={() => handleTabChange("code")}
              className={`border-border pb-3 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none ${
                activeTab === "code"
                  ? "text-brand border-b border-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              type="button"
            >
              Desk code
            </button>
          </nav>
        </div>

        {activeTab === "tap" ? (
          <div className="mt-6">
            {nfcSupported ? (
              <div className="flex flex-col items-center justify-center gap-8 py-16">
                <div className="border-border w-full max-w-[280px] aspect-square border flex items-center justify-center">
                  <span className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
                    Tap band here
                  </span>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Hold your NFC band near the reader
                </p>
              </div>
            ) : (
              <Panel className="mt-6 text-center">
                <p className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
                  NFC unavailable
                </p>
                <p className="mt-2 text-sm">
                  NFC is not available on this device.
                  <button
                    onClick={() => setActiveTab("code")}
                    className="text-brand ml-2 underline"
                  >
                    Use desk code
                  </button>
                </p>
              </Panel>
            )}
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">
              Enter the 6-character code from your wristband receipt.
            </p>
            <p className="mt-1 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
              Dev hint: {devCodeHint}
            </p>
            
            <form onSubmit={handleSubmit} className="mt-6 max-w-[20rem]">
              <label htmlFor="code" className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-muted-foreground">
                Desk code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="border-border bg-card mt-2 w-full border px-3 py-2.5 font-mono text-[1rem] tracking-wider uppercase focus:outline-brand"
                placeholder="K4M2PZ"
                disabled={state === "loading"}
                autoFocus
              />
              
              {state === "error" && errorType && (
                <div className="mt-3 min-h-4">
                  {errorType === "already_bound" ? (
                    <p className="text-sm text-destructive">
                      Already bound to another attendee.
                      <Link to="/account" className="ml-2 underline">Get help</Link>
                    </p>
                  ) : (
                    <p className="text-sm text-destructive">
                      Unknown band. Check the code and try again.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setState("idle");
                      setErrorType(null);
                      setCode("");
                    }}
                    className="mt-2 font-mono text-[0.6875rem] uppercase text-muted-foreground underline"
                  >
                    Clear & retry
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="bg-brand hover:bg-brand/90 border-border mt-6 h-12 w-full border text-white font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none disabled:opacity-50"
                disabled={!code.trim() || state === "loading"}
              >
                {state === "loading" ? "Checking..." : "Bind band"}
              </button>
            </form>
          </div>
        )}
      </div>
    </PageShell>
  );
}
