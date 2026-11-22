import { useState, useSyncExternalStore, useEffect } from "react";
import { Link, NavLink, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import SiteHeader from "../components/site-header"
import { Wordmark } from "../brand/wordmark";
import { passVariant, shortUid, type CredentialState } from "../data/pass";

function SkipLink() {
  return (
    <a
      href="#content"
      className="focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:block focus:bg-background focus:p-2 focus:text-brand focus:underline focus:underline-offset-2"
      style={{ position: "absolute", left: "-9999px", top: 0 }}
    >
      Skip to content
    </a>
  );
}

type ScreenWakeLock = { request: (type: "screen") => Promise<unknown> };

async function holdAwake(): Promise<boolean> {
  const api = (navigator as Navigator & { wakeLock?: ScreenWakeLock }).wakeLock;
  if (!api) return false;
  await api.request("screen");
  return true;
}

function formatDate(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: timezone,
  }).format(new Date(startsAt));
}

function ToneDot({ state }: { state: CredentialState }) {
  const toneClass: Record<CredentialState, string> = {
    READY: "bg-success",
    "NOT YET BOUND": "bg-warning",
    REVOKED: "bg-destructive",
    REPLACED: "bg-muted-foreground",
  };
  return <span className={`size-1.5 ${toneClass[state]}`} aria-hidden />;
}

function StateLabel({ state }: { state: CredentialState }) {
  const labels: Record<CredentialState, string> = {
    READY: "READY",
    "NOT YET BOUND": "NOT YET BOUND",
    REVOKED: "REVOKED",
    REPLACED: "REPLACED",
  };
  return <span className="font-mono text-[0.625rem] tracking-[0.18em] uppercase">{labels[state]}</span>;
}

function StateDescription({ state }: { state: CredentialState }) {
  const descriptions: Record<CredentialState, string> = {
    READY: "This credential is active and ready for use.",
    "NOT YET BOUND": "This credential needs to be bound to a wristband at the desk.",
    REVOKED: "This credential was revoked. Ask staff at the desk for a replacement.",
    REPLACED: "This pass was replaced. Your credential now lives on the band issued at the desk.",
  };
  return <p className="max-w-[16rem] text-sm leading-relaxed">{descriptions[state]}</p>;
}

function SiteNav() {
  return (
    <nav aria-label="Main navigation" className="flex items-center gap-6 sm:gap-8">
      <NavLink
        to="/"
        className={({ isActive }) => `focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand px-2 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none ${
            isActive
              ? "text-brand border-b border-brand"
              : "text-muted-foreground hover:text-foreground"
          }`
        }
      >
        Events
      </NavLink>
      <NavLink
        to="/pass"
        className={({ isActive }) => `focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand px-2 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none ${
            isActive
              ? "text-brand border-b border-brand"
              : "text-muted-foreground hover:text-foreground"
          }`
        }
      >
        My pass
      </NavLink>
    </nav>
  );
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export default function Pass() {
  useEffect(() => {
    document.title = "My pass · Connexia";
  }, []);

  const [params] = useSearchParams();
  const pass = passVariant(params.get("state"), params.get("band"));
  const online = useOnline();
  const [notice, setNotice] = useState<string | null>(null);

  const qrVisible = pass.state === "READY" || pass.state === "NOT YET BOUND";
  const showRevoked = pass.state === "REVOKED";
  const showReplaced = pass.state === "REPLACED";

  const actions: { label: string; run: () => void }[] = [
    {
      label: "Add to Wallet",
      run: () => setNotice("Wallet passes arrive from the emailed copy in this build."),
    },
    {
      label: "Email me a copy",
      run: () => setNotice(`A copy is on its way to ${pass.holder.split(" ")[0]}'s email.`),
    },
    {
      label: "Brightness up",
      run: () => {
        holdAwake()
          .then((held) =>
            setNotice(
              held
                ? "Screen stays on until you leave this page."
                : "This browser cannot hold the screen awake.",
            ),
          )
          .catch(() => setNotice("Could not keep the screen awake."));
      },
    },
  ];

  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-border border-b">
        <div className="mx-auto w-full max-w-[1600px] flex items-center justify-between gap-4 px-6 py-5 md:px-10 xl:px-16">
          <Link to="/" aria-label="Connexia home">
            <Wordmark className="h-6 w-auto" />
          </Link>
          <SiteHeader />
        </div>
      </header>

      <div id="content" className="mx-auto w-full max-w-[1600px] flex-1 px-6 pb-16 md:px-10 xl:px-16">
        <div className="mx-auto w-full max-w-[420px] pt-10">
          <p className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
            {formatDate(pass.event.startsAt, pass.event.timezone)} · {pass.event.venue}
          </p>
          <h1 className="mt-2 font-serif text-2xl leading-tight">{pass.event.title}</h1>

          <p className="mt-8 flex items-center gap-2 font-mono text-[0.625rem] tracking-[0.18em] uppercase">
            <ToneDot state={pass.state} />
            <StateLabel state={pass.state} />
          </p>

          {showRevoked ? (
            <div className="border-destructive bg-destructive/10 mt-6 flex flex-col items-center justify-center gap-3 border px-6 py-16 text-center">
              <span className="font-mono text-[0.625rem] tracking-[0.18em] text-destructive uppercase">
                Revoked
              </span>
              <StateDescription state={pass.state} />
            </div>
          ) : showReplaced ? (
            <div className="border-border mt-6 flex flex-col items-center justify-center gap-3 border px-6 py-16 text-center">
              <span className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
                Replaced
              </span>
              <StateDescription state={pass.state} />
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center">
              <div className="w-full max-w-[280px] border border-[#0a0a0a] bg-white">
                <QRCodeSVG
                  value={pass.token}
                  size={280}
                  marginSize={2}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                  style={{ width: "100%", height: "auto" }}
                  title={`Pass for ${pass.holder}`}
                  role="img"
                />
              </div>
              <p className="mt-4 text-center font-mono text-[0.6875rem] tracking-[0.12em] uppercase">
                {pass.holder} · {pass.tier}
              </p>
            </div>
          )}

          <div className="border-border mt-10 flex items-start justify-between gap-4 border-t pt-4">
            <div className="min-w-0">
              <p className="font-mono text-[0.625rem] tracking-[0.12em] text-muted-foreground uppercase">
                Wristband
              </p>
              {pass.band ? (
                <p className="mt-1.5 flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
                  <span className="bg-success size-1.5" aria-hidden />
                  Bound · uid {shortUid(pass.band.uid)}
                </p>
              ) : (
                <>
                  <p className="mt-1.5 text-sm">Not bound — bind at the desk</p>
                  <p className="mt-1 text-xs text-muted-foreground">{pass.nearestDesk}</p>
                </>
              )}
            </div>
            {!pass.band && (
              <Link
                to="/pass/pair"
                className="border-border hover:border-brand hover:text-brand shrink-0 border px-3 py-2 font-mono text-[0.625rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none"
              >
                Bind
              </Link>
            )}
          </div>

          {qrVisible && (
            <>
              <div className="border-border mt-8 border-y">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.run}
                    className="border-border hover:bg-card/50 w-full border-b py-3.5 text-left font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none last:border-b-0"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              <p
                role="status"
                className="mt-3 min-h-4 font-mono text-[0.625rem] tracking-[0.08em] text-muted-foreground uppercase"
              >
                {notice}
              </p>
            </>
          )}

          {!online && (
            <p className="border-border mt-8 flex items-center gap-2 border px-3 py-2.5 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
              <span className="bg-warning size-1.5" aria-hidden />
              Offline — pass remains valid
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
