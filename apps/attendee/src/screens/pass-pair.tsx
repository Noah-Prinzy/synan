import { pageTitle } from "@synan/ui/brand";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../data/auth";
import { bindBand, bindTappedBand, boundBand, devCodeHint, type BindResult } from "../data/pair";
import { useDataVersion } from "../data/live";
import { PageHeader, PageShell, Panel } from "../components/page";
import { buttonClass, RewardMoment } from "@synan/ui/components";
import { fieldClass } from "../components/form-styles";

type NdefReader = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: "reading", listener: (event: { serialNumber: string }) => void) => void;
};

const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

/** Active tab: foreground text and the accent rule beneath (blue is the rule, never the text). */
const tabClass = (active: boolean) =>
  `relative flex min-h-11 items-center text-15 font-medium transition-colors duration-120 ease-standard motion-reduce:transition-none ${
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
  }`;

export default function PassPair() {
  useEffect(() => {
    document.title = pageTitle("Bind band");
  }, []);

  useSession();
  useDataVersion();
  const bound = boundBand();
  const [activeTab, setActiveTab] = useState<"tap" | "code">(nfcSupported ? "tap" : "code");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "listening" | "success" | "error" | "denied">("idle");
  const [result, setResult] = useState<BindResult | null>(null);
  const [emptyError, setEmptyError] = useState(false);

  function finish(outcome: BindResult) {
    setResult(outcome);
    setState(outcome.ok ? "success" : "error");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (state === "loading") return;
    if (code.trim().length !== 6) {
      setEmptyError(true);
      document.getElementById("code")?.focus();
      return;
    }
    setState("loading");
    await new Promise((resolve) => setTimeout(resolve, 400));
    finish(await bindBand(code));
  }

  async function startTap() {
    try {
      const Reader = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader;
      const reader = new Reader();
      setState("listening");
      await reader.scan();
      reader.addEventListener("reading", ({ serialNumber }) => {
        const uid = serialNumber.replace(/:/g, "").toUpperCase();
        void Promise.resolve(bindTappedBand(uid)).then(finish);
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
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="enter px-4 py-10 sm:px-6 md:px-10 lg:py-12">
      <div className="max-w-md">
        {!bound ? <h2 className="font-display text-28 leading-tight">{activeTab === "tap" ? "Tap your band" : "Enter the desk code"}</h2> : null}

        {bound ? (
          <Panel className="mt-6">
            <p className="text-13 font-medium text-muted-foreground">Already bound</p>
            <p className="mt-2 text-15 text-muted-foreground">
              Band {bound.hint} is bound to your pass. If it is lost, report it in Account first.
            </p>
            <Link to="/pass" className={buttonClass("secondary", "sm", "mt-4")}>
              Back to my pass
            </Link>
          </Panel>
        ) : (
          <>
            {nfcSupported ? (
            <div className="mt-6 border-b border-border">
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
                <p className="max-w-[46ch] text-15 text-muted-foreground">
                  {nfcSupported
                    ? "Enter the 6-character code the desk gave you."
                    : "This device can't read wristbands, so use the 6-character code the desk gives you with your band."}
                </p>
                {import.meta.env.DEV && devCodeHint ? (
                  <p className="mt-1 text-13 text-muted-foreground">
                    Mock build: try <span className="font-mono">{devCodeHint}</span>
                  </p>
                ) : null}

                <form noValidate onSubmit={handleSubmit} className="mt-6 max-w-sm">
                  <label htmlFor="code" className="text-13 font-medium text-muted-foreground">
                    Desk code
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      setEmptyError(false);
                    }}
                    maxLength={6}
                    aria-invalid={state === "error" || emptyError ? true : undefined}
                    aria-describedby={state === "error" || emptyError ? "code-error" : undefined}
                    className={`mt-2 ${fieldClass} font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case`}
                    placeholder="6 letters and numbers"
                    disabled={state === "loading"}
                  />

                  {emptyError ? (
                    <p id="code-error" role="alert" className="mt-3 text-15 text-destructive">
                      <span aria-hidden="true" className="mr-1.5 font-mono">✕</span>
                      Enter all 6 characters of the code from the desk.
                    </p>
                  ) : null}
                  {state === "error" && result && !result.ok && !emptyError ? (
                    <div id="code-error" role="alert" className="mt-4">
                      {result.reason === "already_bound" ? (
                        <p className="text-15 text-destructive">
                          Already bound to another attendee.{" "}
                          <Link to="/account" className="underline underline-offset-4">
                            Get help
                          </Link>
                        </p>
                      ) : result.reason === "failed" ? (
                        <p className="text-15 text-destructive">{result.message}</p>
                      ) : (
                        <p className="text-15 text-destructive">Unknown band. Check the code and try again.</p>
                      )}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    className={buttonClass("primary", "md", "mt-6 w-full")}
                    aria-busy={state === "loading" || undefined}
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
      <aside aria-label="How binding works" className="border-t border-border px-4 py-10 sm:px-6 md:px-10 lg:border-t-0 lg:border-l lg:py-12">
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
