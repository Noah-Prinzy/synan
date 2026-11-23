import { useState, useSyncExternalStore, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { PageShell, Eyebrow } from "../components/page";
import { passVariant, shortUid, type CredentialState } from "../data/pass";
import { Badge, buttonClass, type BadgeTone } from "@connexia/ui/components";

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

const toneFor: Record<CredentialState, BadgeTone> = {
  READY: "success",
  "NOT YET BOUND": "warning",
  REVOKED: "destructive",
  REPLACED: "neutral",
};

const descriptionFor: Record<CredentialState, string> = {
  READY: "This credential is active and ready for use.",
  "NOT YET BOUND": "This credential needs to be bound to a wristband at the desk.",
  REVOKED: "This credential was revoked. Ask staff at the desk for a replacement.",
  REPLACED: "This pass was replaced. Your credential now lives on the band issued at the desk.",
};

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
    <PageShell>
      <div className="mx-auto w-full max-w-[600px] pb-20">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <Eyebrow>My pass</Eyebrow>
            <h1 className="mt-2 font-serif text-2xl leading-tight font-normal md:text-3xl">
              {pass.event.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatDate(pass.event.startsAt, pass.event.timezone)} · {pass.event.venue}
            </p>
          </div>
          <Badge
            tone={toneFor[pass.state]}
            dot
            pulse={pass.state === "READY"}
            className="shrink-0"
          >
            {pass.state}
          </Badge>
        </header>

        <section aria-label="Credential" className="mt-6 border border-border bg-card/40">
          {showRevoked ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-destructive">
                Revoked
              </span>
              <p className="max-w-[22rem] text-sm leading-relaxed">{descriptionFor[pass.state]}</p>
            </div>
          ) : showReplaced ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
                Replaced
              </span>
              <p className="max-w-[22rem] text-sm leading-relaxed">{descriptionFor[pass.state]}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 pt-10 pb-8">
              <div className="w-full max-w-[220px] border border-[#0a0a0a] bg-white p-2.5">
                <QRCodeSVG
                  value={pass.token}
                  size={220}
                  marginSize={2}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                  style={{ width: "100%", height: "auto" }}
                  title={`Pass for ${pass.holder}`}
                  role="img"
                />
              </div>
              <p className="mt-5 text-center font-mono text-[0.6875rem] uppercase tracking-[0.12em]">
                {pass.holder} · {pass.tier}
              </p>
              <p className="mt-2 max-w-[22rem] text-center text-sm leading-relaxed text-muted-foreground">
                {descriptionFor[pass.state]}
              </p>
            </div>
          )}

          {qrVisible ? (
            <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.run}
                  className="flex min-h-[4.5rem] items-center justify-center px-3 py-4 text-center font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand motion-reduce:transition-none"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {qrVisible ? (
          <p
            role="status"
            className="mt-3 min-h-4 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground"
          >
            {notice}
          </p>
        ) : null}

        <div className="mt-8 flex items-end justify-between gap-4 border-t border-border pt-5">
          <div className="min-w-0">
            <Eyebrow>Wristband</Eyebrow>
            {pass.band ? (
              <p className="mt-2 flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.08em]">
                <span className="size-1.5 bg-success" aria-hidden />
                Bound · uid {shortUid(pass.band.uid)}
              </p>
            ) : (
              <>
                <p className="mt-1.5 text-sm">Not bound — bind at the desk</p>
                <p className="mt-1 text-xs text-muted-foreground">{pass.nearestDesk}</p>
              </>
            )}
          </div>
          {!pass.band ? (
            <Link to="/pass/pair" className={buttonClass("secondary", "sm", "shrink-0")}>
              Bind
            </Link>
          ) : null}
        </div>

        {!online ? (
          <p className="mt-8 flex items-center gap-2 border border-border px-3 py-2.5 font-mono text-[0.625rem] uppercase tracking-[0.08em]">
            <span className="size-1.5 bg-warning" aria-hidden />
            Offline — pass remains valid
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
