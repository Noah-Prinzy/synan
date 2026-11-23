import { pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { hint } from "@synan/mock";
import { useSession } from "../data/auth";
import { bindBand, devCodeHint, type BindResult } from "../data/pair";
import { portal, usePortalVersion } from "../data/mock";
import { PageHeader, PageShell, Panel } from "../components/page";
import { buttonClass, RewardMoment } from "@synan/ui/components";

type NdefReader = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: "reading", listener: (event: { serialNumber: string }) => void) => void;
};

const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

const tabClass = (active: boolean) =>
  `relative pb-3 text-13 font-medium transition-colors duration-120 ease-standard motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
    active ? "text-brand" : "text-muted-foreground hover:text-foreground"
  }`;

export default function PassPair() {
  useEffect(() => {
    document.title = pageTitle("Bind band");
  }, []);

  useSession();
  usePortalVersion();
  const boundUid = portal.bandUid();
  const [activeTab, setActiveTab] = useState<"tap" | "code">(nfcSupported ? "tap" : "code");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "listening" | "success" | "error" | "denied">("idle");
  const [result, setResult] = useState<BindResult | null>(null);

  function finish(outcome: BindResult) {
    setResult(outcome);
    setState(outcome.ok ? "success" : "error");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || state === "loading") return;
    setState("loading");
    await new Promise((resolve) => setTimeout(resolve, 400));
    finish(bindBand(code));
  }

  async function startTap() {
    try {
      const Reader = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader;
      const reader = new Reader();
      setState("listening");
      await reader.scan();
      reader.addEventListener("reading", ({ serialNumber }) => {
        const uid = serialNumber.replace(/:/g, "").toUpperCase();
        const outcome = portal.bind({ via: "nfc", uid });
        finish(
          outcome.ok
            ? { ok: true, band: { uid: outcome.uid } }
            : { ok: false, reason: outcome.code === "CONFLICT" ? "already_bound" : "unknown_band" },
        );
      });
    } catch (error) {
      // NotAllowedError: the person (or Chrome's settings) refused NFC permission.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setState("denied");
        return;
      }
      setState("idle");
      setActiveTab("code");
    }
  }

  function changeTab(tab: "tap" | "code") {
    if (tab === "tap" && !nfcSupported) return;
    setActiveTab(tab);
    setState("idle");
    setResult(null);
  }

  if (state === "success" && result?.ok) {
    return (
      <PageShell bleed>
        <PageHeader label="Bind band" title="Band bound">This band is now you. Tap it at every door inside the venue.</PageHeader>
        <div className="enter px-4 py-10 sm:px-6 md:px-10">
          <p className="mb-6 text-15 font-medium">
            <RewardMoment>Bound to your pass</RewardMoment>
          </p>
          <Panel className="max-w-md">
            <p className="text-13 font-medium text-muted-foreground">Band UID</p>
            <p className="mt-2 font-mono text-17 tracking-wider uppercase">{result.band.uid}</p>
          </Panel>
          <div className="mt-8">
            <Link to="/pass" className={buttonClass("primary", "md")}>
              View my pass
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell bleed>
      <PageHeader label="My pass" title="Bind your band">
        Link a wristband to your pass. From then on, the band is your key inside the venue.
      </PageHeader>
      <div className="grid md:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="enter px-4 py-10 sm:px-6 md:px-10">
      <div className="max-w-md">

        {boundUid ? (
          <Panel className="mt-6">
            <p className="text-13 font-medium text-muted-foreground">Already bound</p>
            <p className="mt-2 text-15 text-muted-foreground">
              Band {hint(boundUid)} is bound to your pass. If it is lost, report it in Account first.
            </p>
            <Link to="/pass" className={buttonClass("secondary", "sm", "mt-4")}>
              Back to my pass
            </Link>
          </Panel>
        ) : (
          <>
            <div className="mt-8 border-b border-border">
              <div role="tablist" aria-label="Binding method" className="flex gap-6">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "tap"}
                  disabled={!nfcSupported}
                  onClick={() => changeTab("tap")}
                  className={tabClass(activeTab === "tap")}
                >
                  Tap
                  {activeTab === "tap" ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-px bg-brand" /> : null}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "code"}
                  onClick={() => changeTab("code")}
                  className={tabClass(activeTab === "code")}
                >
                  Desk code
                  {activeTab === "code" ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-px bg-brand" /> : null}
                </button>
              </div>
            </div>

            {!nfcSupported ? (
              <p className="mt-4 text-13 text-muted-foreground">
                NFC is not available on this device — use the code from the desk.
              </p>
            ) : null}

            {activeTab === "tap" ? (
              <div className="mt-6 flex flex-col items-center justify-center gap-6 py-10">
                <div className="flex aspect-square w-full max-w-60 items-center justify-center border border-border">
                  <span className="text-13 font-medium tracking-wider text-muted-foreground">
                    {state === "listening" ? "Hold the band to the back of the phone" : "Tap band here"}
                  </span>
                </div>
                {state === "denied" ? (
                  <div role="alert" className="w-full max-w-sm text-center">
                    <p className="text-15 font-medium text-warning">
                      <span aria-hidden="true" className="mr-2 font-mono">!</span>
                      NFC permission was refused
                    </p>
                    <p className="mt-2 text-15 text-muted-foreground">
                      Allow NFC for this site in Chrome's site settings and try again, or use the code from the desk.
                    </p>
                    <button type="button" onClick={() => changeTab("code")} className={buttonClass("secondary", "sm", "mt-4")}>
                      Use a desk code
                    </button>
                  </div>
                ) : null}
                {state !== "listening" ? (
                  <button type="button" onClick={startTap} className={buttonClass("secondary", "md")}>
                    Start reading
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-6">
                <p className="text-15 text-muted-foreground">Enter the 6-character code the desk gave you.</p>
                <p className="mt-1 text-13 font-medium tracking-wider text-muted-foreground">
                  Mock build · try {devCodeHint}
                </p>

                <form onSubmit={handleSubmit} className="mt-6 max-w-xs">
                  <label htmlFor="code" className="text-13 font-medium text-muted-foreground">
                    Desk code
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    maxLength={6}
                    aria-invalid={state === "error" ? true : undefined}
                    aria-describedby={state === "error" ? "code-error" : undefined}
                    className="mt-2 w-full border border-input bg-background px-3 py-2.5 font-mono text-17 tracking-wider uppercase focus:border-brand"
                    placeholder="K4M2PZ"
                    disabled={state === "loading"}
                  />

                  {state === "error" && result && !result.ok ? (
                    <div id="code-error" role="alert" className="mt-4">
                      {result.reason === "already_bound" ? (
                        <p className="text-15 text-destructive">
                          Already bound to another attendee.{" "}
                          <Link to="/account" className="underline underline-offset-4">
                            Get help
                          </Link>
                        </p>
                      ) : (
                        <p className="text-15 text-destructive">Unknown band. Check the code and try again.</p>
                      )}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    className={buttonClass("primary", "md", "mt-6 w-full")}
                    disabled={!code.trim() || state === "loading"}
                  >
                    {state === "loading" ? "Checking…" : "Bind band"}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
      </div>
      <aside aria-label="How binding works" className="border-t border-border px-4 py-10 sm:px-6 md:border-t-0 md:border-l md:px-10">
        <h2 className="font-display text-21">How it works</h2>
        <ol className="mt-4 space-y-4 text-15 text-muted-foreground">
          <li>
            <span className="mr-2 font-mono text-foreground">01</span>
            Collect a wristband at the desk — show the arrival code on your pass.
          </li>
          <li>
            <span className="mr-2 font-mono text-foreground">02</span>
            Tap the band to an Android phone, or type the six-character code the desk gives you.
          </li>
          <li>
            <span className="mr-2 font-mono text-foreground">03</span>
            The band is now your key. If you lose it, report it in Account and it stops working at once.
          </li>
        </ol>
      </aside>
      </div>
    </PageShell>
  );
}
