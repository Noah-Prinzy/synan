import { Wordmark, pageTitle } from "@synan/ui/brand";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { PageShell } from "../components/page";
import { ErrorState, SkeletonCells } from "../components/states";
import { useOnline } from "../components/use-online";
import {
  currentCode,
  emailPassCopy,
  getCodes,
  initialCodes,
  tierLabel,
  usePass,
  watchPass,
  type CredentialState,
  type Pass,
  type PortalCodeBatch,
} from "../data/pass";
import { formatDay, formatTime } from "../data/format";
import { useNow } from "../data/live";
import { ActionButton, Badge, DrawnCheck, buttonClass, type BadgeTone } from "@synan/ui/components";
import { useDevicePreference, useWakeLock } from "@synan/ui/mobile";


/** Real API only, and rare: someone signed in with no pass issued. */
const NoPass = lazy(() => import("./no-pass"));

const toneFor: Record<CredentialState, BadgeTone> = {
  READY: "success",
  "NOT YET BOUND": "neutral",
  "UNDER REVIEW": "warning",
  REVOKED: "destructive",
  REPLACED: "neutral",
};

const descriptionFor: Record<CredentialState, string> = {
  READY: "Your wristband is your key inside the venue. Tap it at every door.",
  "NOT YET BOUND": "Show this when you arrive to collect your wristband.",
  "UNDER REVIEW":
    "Your pass is on hold while staff check a recent scan. Go to the nearest desk; doors will not open for this pass until it is cleared.",
  REVOKED: "This pass was cancelled. Ask at the desk for a replacement.",
  REPLACED: "This pass was replaced. Your access now lives on the wristband issued at the desk.",
};

/**
 * The rotating signed codes (D-05, D-12). A batch covers the next 15 minutes, so the
 * QR keeps rotating offline; it is refreshed while online when fewer than five remain.
 * Against the real API the first batch may still be on its way (`waiting`).
 */
function useRotatingCode(online: boolean) {
  const now = useNow();
  const [batch, setBatch] = useState<PortalCodeBatch | null>(() => initialCodes());
  const [failed, setFailed] = useState(false);
  const remaining = batch ? batch.codes.filter((code) => Date.parse(code.expires_at) > now).length : 0;

  useEffect(() => {
    if (!online || remaining >= 5) return;
    let live = true;
    Promise.resolve(getCodes()).then(
      (next) => {
        if (!live) return;
        setBatch(next);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [online, remaining]);

  const code = batch ? currentCode(batch, now) : null;
  const ttlMs = (batch?.rotate_every_s ?? 60) * 1000;
  const leftMs = code ? Date.parse(code.expires_at) - now : 0;
  return { code, leftMs, ttlMs, exhausted: code === null, waiting: batch === null && online && !failed };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function NextCodeRule({ leftMs, ttlMs, codeKey }: { leftMs: number; ttlMs: number; codeKey: string }) {
  const seconds = Math.max(0, Math.ceil(leftMs / 1000));
  const fraction = Math.min(1, leftMs / ttlMs);
  // One CSS animation per code drains the rule; it is created when the code changes,
  // not on every one-second tick. Reduced motion: the rule steps once a second.
  const animated = useMemo(
    () => ({
      transform: `scaleX(${fraction})`,
      animation: `drainX ${leftMs}ms linear forwards`,
      ["--drain-from" as string]: String(fraction),
    }),
    [codeKey],
  );
  const style = prefersReducedMotion() ? { transform: `scaleX(${fraction})` } : animated;
  return (
    <div className="mt-5 w-full max-w-75">
      <div className="h-px w-full bg-border" aria-hidden="true">
        <div key={codeKey} className="h-full origin-left bg-foreground" style={style} />
      </div>
      <p className="mt-2 flex justify-between text-13 text-muted-foreground">
        <span>The code changes every minute</span>
        <span className="font-mono" aria-hidden="true">
          0:{String(seconds).padStart(2, "0")}
        </span>
      </p>
    </div>
  );
}

function QrBlock({ holder, online }: { holder: string; online: boolean }) {
  const { code, leftMs, ttlMs, exhausted, waiting } = useRotatingCode(online);

  if (waiting) {
    // The first codes are on their way: the empty frame holds the QR's place.
    return (
      <div aria-busy="true" className="flex flex-col items-center px-6 pt-5 pb-6 sm:pt-8 sm:pb-8">
        <div className="aspect-square w-full max-w-75 border border-qr-ink bg-qr-field short-landscape:max-w-[min(18.75rem,calc(100dvh-11rem))]" />
      </div>
    );
  }

  if (exhausted || !code) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-15 font-medium text-warning">
          <span aria-hidden="true" className="mr-2 font-mono">!</span>
          Your pass needs a connection
        </p>
        <p className="max-w-md text-15 leading-relaxed text-muted-foreground">
          This phone has been offline too long to show a fresh code. Show the emailed copy at the
          entrance, or go to the desk with photo ID.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-6 pt-5 pb-6 sm:pt-8 sm:pb-8">
      <div className="w-full max-w-75 border border-qr-ink bg-qr-field p-3 short-landscape:max-w-[min(18.75rem,calc(100dvh-11rem))]">
        <QRCodeSVG
          key={code.code}
          value={code.code}
          size={300}
          marginSize={2}
          level="M"
          bgColor="#ffffff"
          fgColor="#0a0a0a"
          className="fade-in"
          style={{ width: "100%", height: "auto" }}
          title={`Arrival code for ${holder}`}
          role="img"
        />
      </div>
      <NextCodeRule leftMs={leftMs} ttlMs={ttlMs} codeKey={code.code} />
    </div>
  );
}

function BandRow({ band, nearestDesk }: { band: Pass["band"]; nearestDesk: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
      <div className="min-w-0">
        <p className="text-13 font-medium text-muted-foreground">Wristband</p>
        {band ? (
          <p className="mt-1 flex items-center gap-2 text-17">
            <span className="size-1.5 bg-success" aria-hidden />
            Bound <span className="font-mono text-15 text-muted-foreground">{band.hint}</span>
          </p>
        ) : (
          <>
            <p className="mt-1 text-17">Not bound yet</p>
            <p className="mt-0.5 text-15 text-muted-foreground">Collect it at {nearestDesk}</p>
          </>
        )}
      </div>
      {!band ? (
        <Link to="/pass/pair" className={buttonClass("secondary", "sm", "shrink-0")}>
          Bind a band
        </Link>
      ) : null}
    </div>
  );
}

/**
 * "Keep screen on" (docs/06 A4): a toggle, remembered on this device. The lock is taken
 * again whenever the page comes back into view, because browsers drop it when hidden.
 */
function KeepScreenOn({ onNotice }: { onNotice: (message: string) => void }) {
  const [wanted, setWanted] = useDevicePreference("synan.pass.keepScreenOn", false);
  const state = useWakeLock(wanted);
  const on = wanted && state === "on";
  useEffect(() => {
    if (!wanted) return;
    if (state === "unsupported") onNotice("This browser can't keep the screen on. Turn up the brightness instead.");
    if (state === "failed") onNotice("Couldn't keep the screen on. Your phone may be in battery saver.");
  }, [wanted, state, onNotice]);
  return (
    <button
      type="button"
      aria-pressed={wanted}
      onClick={() => setWanted(!wanted)}
      className={`pressable relative flex min-h-16 items-center justify-center gap-1.5 px-2 py-3 text-center text-13 font-medium transition-colors duration-120 ease-standard hover:bg-card/40 motion-reduce:transition-none ${on ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {on ? <DrawnCheck className="text-brand" /> : null}
      {on ? "Screen stays on" : "Keep screen on"}
    </button>
  );
}

/**
 * The pass as an object: a ticket with a header (the event), the holder at display
 * size, the tier set as type, a perforation, and the stub that does the work at the door.
 */
export function PassTicket({
  pass,
  online = true,
  liveChange = false,
  onNotice,
}: {
  pass: Pass;
  online?: boolean;
  liveChange?: boolean;
  onNotice?: (message: string) => void;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const tier = tierLabel[pass.tier];
  const usable = pass.state === "READY" || pass.state === "NOT YET BOUND";
  const bandFirst = pass.state === "READY" && pass.band !== null;
  const notify = (message: string) => onNotice?.(message);

  // Keyed by event: a different pass (several held) starts from its own codes.
  const qr = <QrBlock key={pass.eventId} holder={pass.holder} online={online} />;

  return (
    <article
      aria-label={`Pass for ${pass.event.title}`}
      className={`mx-auto flex w-full max-w-130 flex-col border bg-background ${pass.state === "REVOKED" ? "border-destructive" : "border-border"}`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          {/* The site header shows the logo right above on phones; the pass repeats it only where there is room. */}
          <p className="mb-4 hidden text-17 md:block">
            <Wordmark small />
          </p>
          <p className="font-display text-21 leading-tight">{pass.event.title}</p>
          <p className="mt-1 text-15 text-muted-foreground">
            <span className="font-mono">{formatDay(pass.event.startsAt, pass.event.timezone)}</span> · doors{" "}
            <span className="font-mono">{formatTime(pass.event.startsAt, pass.event.timezone)}</span> · {pass.event.venue}
          </p>
        </div>
        <Badge tone={toneFor[pass.state]} dot className="shrink-0">
          {pass.state}
        </Badge>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-border">
        <div className="px-5 py-4 sm:px-6 sm:py-6">
          <p className="text-13 font-medium text-muted-foreground">Guest</p>
          <p className="mt-1 font-display text-28 leading-none wrap-break-word sm:text-40">{pass.holder}</p>
        </div>
        <div className="flex flex-col justify-end border-l border-border px-5 py-4 sm:px-6 sm:py-6">
          <p className="text-13 font-medium text-muted-foreground">Tier</p>
          <p className="mt-1 text-21 font-medium">{tier}</p>
        </div>
      </div>

      {bandFirst ? (
        <div className="border-b border-border">
          <BandRow band={pass.band} nearestDesk={pass.nearestDesk} />
          <p className="px-5 pb-5 text-15 text-muted-foreground sm:px-6">{descriptionFor.READY}</p>
        </div>
      ) : null}

      {/* Perforation: the stub below is what you show at the door. */}
      <div aria-hidden="true" className="h-0 border-t border-dashed border-border" />

      {pass.state === "REVOKED" || pass.state === "REPLACED" || pass.state === "UNDER REVIEW" ? (
        <div role="status" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p
            className={`text-15 font-medium ${
              pass.state === "REVOKED" ? "text-destructive" : pass.state === "UNDER REVIEW" ? "text-warning" : "text-muted-foreground"
            }`}
          >
            <span aria-hidden="true" className="mr-2 font-mono">
              {pass.state === "REVOKED" ? "✕" : pass.state === "UNDER REVIEW" ? "!" : "·"}
            </span>
            {pass.state === "REVOKED" && liveChange ? "Revoked just now" : pass.state === "UNDER REVIEW" ? "On hold" : pass.state === "REVOKED" ? "Revoked" : "Replaced"}
          </p>
          <p className="max-w-md text-15 leading-relaxed">{descriptionFor[pass.state]}</p>
          {pass.state !== "REPLACED" ? <p className="text-15 text-muted-foreground">{pass.nearestDesk}</p> : null}
        </div>
      ) : bandFirst ? (
        <>
          <button
            type="button"
            aria-expanded={qrOpen}
            aria-controls="arrival-qr"
            onClick={() => setQrOpen((open) => !open)}
            className="flex min-h-14 w-full items-center justify-between px-5 text-15 text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none sm:px-6"
          >
            Arrival code, for the entrance and desk
            <span aria-hidden="true" className="font-mono">{qrOpen ? "−" : "+"}</span>
          </button>
          {qrOpen ? (
            <div id="arrival-qr" className="fade-in border-t border-border">
              {qr}
            </div>
          ) : null}
        </>
      ) : (
        <div className="short-landscape:order-first short-landscape:border-b short-landscape:border-border">
          <p className="px-6 pt-5 text-center text-17 sm:pt-6 short-landscape:sr-only">{descriptionFor["NOT YET BOUND"]}</p>
          {qr}
        </div>
      )}

      {usable ? (
        <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
          <ActionButton
            variant="plain"
            doneLabel="Sent to your email"
            failedLabel="Couldn't send. Try again"
            action={async () => {
              await emailPassCopy();
              notify("A copy is in your inbox. The emailed code works once, at the first entrance where it's scanned.");
            }}
            className="min-h-16 w-full px-2 text-13 text-muted-foreground hover:bg-card/40 hover:text-foreground"
          >
            Email me a copy
          </ActionButton>
          <KeepScreenOn onNotice={notify} />
        </div>
      ) : null}

      {!bandFirst ? (
        <div className="border-t border-border">
          <BandRow band={pass.band} nearestDesk={pass.nearestDesk} />
        </div>
      ) : null}
    </article>
  );
}

export default function Pass() {
  useEffect(() => {
    document.title = pageTitle("My pass");
  }, []);

  const [params] = useSearchParams();
  const resource = usePass(params.get("state"));
  const pass = resource.status === "ready" ? resource.data : null;
  const online = useOnline();
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = useCallback((message: string) => setNotice(message), []);

  // stream/me: a revocation or hold lands here while the screen is open (P-16).
  const [announcement, setAnnouncement] = useState("");
  const firstState = useRef<CredentialState | null>(null);
  if (pass && firstState.current === null) firstState.current = pass.state;
  useEffect(() => {
    return watchPass((state) => {
      if (state === "revoked") setAnnouncement("Your pass was revoked.");
      if (state === "suspended_review") setAnnouncement("Your pass is on hold for review.");
    });
  }, []);

  if (!pass) {
    // Real API only: the mock always has the pass. Nothing kept on this device yet, or no pass issued.
    return (
      <PageShell bleed>
        <h1 className="sr-only">My pass</h1>
        {resource.status === "loading" ? (
          <SkeletonCells count={1} />
        ) : resource.status === "none" ? (
          <Suspense fallback={null}>
            <NoPass />
          </Suspense>
        ) : (
          <ErrorState what="your pass" onRetry={resource.retry} />
        )}
      </PageShell>
    );
  }

  return (
    <PageShell bleed>
      <div className="px-4 py-4 sm:px-6 sm:py-10 md:px-10 md:py-14 short-landscape:py-4">
      <h1 className="sr-only">My pass</h1>
      <p role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </p>
      <div className="enter">
        <PassTicket pass={pass} online={online} liveChange={pass.state !== firstState.current} onNotice={showNotice} />
      </div>
      <p role="status" className="mx-auto mt-3 min-h-5 w-full max-w-130 text-15 text-muted-foreground">
        {notice}
      </p>
      {!online ? (
        <p className="mx-auto mt-4 flex w-full max-w-130 items-center gap-2 border border-border px-4 py-3 text-15">
          <span className="size-1.5 bg-warning" aria-hidden />
          Offline — your pass still works.
        </p>
      ) : null}
      </div>
    </PageShell>
  );
}
