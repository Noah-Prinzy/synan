import { pageTitle } from "@synan/ui/brand";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { COLUMN, PANEL, PageShell } from "../components/page";
import { ErrorState, SkeletonCells } from "../components/states";
import { useOnline } from "../components/use-online";
import {
  currentCode,
  emailPassCopy,
  getCodes,
  initialCodes,
  passChoices,
  selectPass,
  tierLabel,
  usePass,
  watchPass,
  type CredentialState,
  type Pass,
  type PassChoice,
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

/** The screen's one statement (D-37): who it is for, then what to do with it, muted. */
function statementFor(pass: Pass): [string, string] {
  const first = pass.holder.split(/\s+/)[0] || pass.holder;
  if (pass.state === "UNDER REVIEW") return ["Your pass is on hold.", "Go to the nearest desk."];
  if (pass.state === "REVOKED") return ["This pass was cancelled.", "Ask at the desk for a replacement."];
  if (pass.state === "REPLACED") return ["This pass was replaced.", "Your wristband is your key now."];
  if (pass.state === "READY" && pass.band) return [`Your pass, ${first}.`, "Your wristband opens every door."];
  return [`Your pass, ${first}.`, descriptionFor["NOT YET BOUND"]];
}

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
  // One CSS animation per code drains the track; it is created when the code changes,
  // not on every one-second tick. Reduced motion: the track steps once a second.
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
    <div className="mt-4 w-full">
      <div className="h-0.5 w-full bg-qr-ink/12" aria-hidden="true">
        <div key={codeKey} className="h-full origin-left bg-qr-ink" style={style} />
      </div>
      <p className="mt-2 flex justify-between text-13 text-qr-ink/70">
        <span>The code changes every minute</span>
        <span className="font-mono" aria-hidden="true">
          0:{String(seconds).padStart(2, "0")}
        </span>
      </p>
    </div>
  );
}

/** The holder and tier, under the code. */
function Holder({ pass }: { pass: Pass }) {
  return (
    <div className="mt-5 flex w-full items-center justify-between gap-4">
      <p className="min-w-0 font-display text-21 leading-tight font-medium wrap-break-word sm:text-28">{pass.holder}</p>
      <p className="shrink-0 bg-qr-ink/6 px-2.5 py-1.5 text-13 font-medium">{tierLabel[pass.tier]}</p>
    </div>
  );
}

/** The code's card: opaque white in both themes (the QR is black on white, always), so the field never shows through. */
const codeCard = "w-full bg-qr-field p-5 text-qr-ink shadow-depth sm:p-7";
const codeSize = "w-full short-landscape:max-w-[min(18.75rem,calc(100dvh-11rem))]";

function QrBlock({ pass, online }: { pass: Pass; online: boolean }) {
  const { code, leftMs, ttlMs, exhausted, waiting } = useRotatingCode(online);

  if (waiting) {
    // The first codes are on their way: the empty card holds the QR's place.
    return (
      <div aria-busy="true" className={codeCard}>
        <div className={`aspect-square ${codeSize}`} />
        <Holder pass={pass} />
      </div>
    );
  }

  if (exhausted || !code) {
    return (
      <div role="status" className={`${PANEL} flex w-full flex-col items-center gap-3 px-6 py-12 text-center`}>
        <p className="text-17 font-medium text-warning">
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
    <div className={codeCard}>
      <div className={codeSize}>
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
          title={`Arrival code for ${pass.holder}`}
          role="img"
        />
      </div>
      <Holder pass={pass} />
      <NextCodeRule leftMs={leftMs} ttlMs={ttlMs} codeKey={code.code} />
    </div>
  );
}

function BandRow({ band, bandLost, nearestDesk }: { band: Pass["band"]; bandLost: boolean; nearestDesk: string }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <p className="min-w-0 flex-1 text-15">
        <span className="sr-only">Wristband: </span>
        {band ? (
          <>
            <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-success" />
            <span className="font-medium">Bound</span> <span className="font-mono text-muted-foreground">{band.hint}</span>
          </>
        ) : bandLost ? (
          <>
            <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-warning" />
            <span className="font-medium">Reported lost</span>
            <span className="text-muted-foreground"> — it no longer opens doors. Collect a new one at {nearestDesk}</span>
          </>
        ) : (
          <>
            <span className="font-medium">Not bound yet</span>
            <span className="text-muted-foreground"> — collect it at {nearestDesk}</span>
          </>
        )}
      </p>
      {!band ? (
        <Link to="/pass/pair" className={buttonClass("secondary", "sm", "shrink-0")}>
          {bandLost ? "Bind a new band" : "Bind a band"}
        </Link>
      ) : null}
    </div>
  );
}

const tonal = "min-h-12 w-full px-3 text-15";

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
    <button type="button" aria-pressed={wanted} onClick={() => setWanted(!wanted)} className={buttonClass("secondary", "md", tonal)}>
      {on ? <DrawnCheck className="text-brand" /> : null}
      {on ? "Screen stays on" : "Keep screen on"}
    </button>
  );
}

/**
 * The pass (D-37): the statement, the code on its own opaque card with the holder and tier, then
 * the wristband and two quiet actions. Once a band is bound the band leads and the code folds
 * beneath it as the arrival code.
 */
export function PassTicket({
  pass,
  online = true,
  liveChange = false,
  onNotice,
  before,
}: {
  pass: Pass;
  online?: boolean;
  liveChange?: boolean;
  onNotice?: (message: string) => void;
  /** Above the code: the switch between several passes. */
  before?: ReactNode;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const usable = pass.state === "READY" || pass.state === "NOT YET BOUND";
  const bandFirst = pass.state === "READY" && pass.band !== null;
  const notify = (message: string) => onNotice?.(message);
  const [title, more] = statementFor(pass);
  const band = <BandRow band={pass.band} bandLost={pass.bandLost} nearestDesk={pass.nearestDesk} />;

  // Keyed by event: a different pass (several held) starts from its own codes.
  const qr = <QrBlock key={pass.eventId} pass={pass} online={online} />;

  return (
    <article aria-label={`Pass for ${pass.event.title}`} className="mx-auto flex w-full max-w-200 flex-col items-center gap-6">
      <p className="eyebrow flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
        <Badge tone={toneFor[pass.state]} dot>
          {pass.state}
        </Badge>
        <span>
          {pass.event.title}
          {pass.event.startsAt ? (
            <>
              {" · "}
              <span className="font-mono">{formatDay(pass.event.startsAt, pass.event.timezone)}</span> · doors{" "}
              <span className="font-mono">{formatTime(pass.event.startsAt, pass.event.timezone)}</span>
            </>
          ) : null}
        </span>
      </p>
      <h1 className="type-statement -mt-2 max-w-[14em] text-center max-md:text-28 short-landscape:sr-only">
        {title} <span className="text-muted-foreground">{more}</span>
      </h1>

      <div className="flex w-full max-w-110 flex-col items-center gap-6">
      {before}

      {pass.state === "REVOKED" || pass.state === "REPLACED" || pass.state === "UNDER REVIEW" ? (
        <div role="status" className={`${PANEL} flex w-full flex-col items-center gap-3 px-6 py-12 text-center`}>
          <p
            className={`text-21 font-medium ${
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
          <div className={`${PANEL} w-full p-5`}>
            {band}
            <p className="mt-3 text-15 text-muted-foreground">{descriptionFor.READY}</p>
          </div>
          <button
            type="button"
            aria-expanded={qrOpen}
            aria-controls="arrival-qr"
            onClick={() => setQrOpen((open) => !open)}
            className={buttonClass("secondary", "md", "w-full")}
          >
            <span className="flex w-full items-center justify-between gap-4">
              Arrival code, for the entrance and desk
              <span aria-hidden="true" className="font-mono">{qrOpen ? "−" : "+"}</span>
            </span>
          </button>
          {qrOpen ? (
            <div id="arrival-qr" className="fade-in w-full">
              {qr}
            </div>
          ) : null}
        </>
      ) : (
        qr
      )}

      {!bandFirst ? band : null}

      {usable ? (
        <div className="grid w-full grid-cols-2 gap-2">
          <ActionButton
            variant="quiet"
            doneLabel="Sent to your email"
            failedLabel="Couldn't send. Try again"
            action={async () => {
              await emailPassCopy();
              notify("A copy is in your inbox. The emailed code works once, at the first entrance where it's scanned.");
            }}
            className={tonal}
          >
            Email me a copy
          </ActionButton>
          <KeepScreenOn onNotice={notify} />
        </div>
      ) : null}
      </div>
    </article>
  );
}

/**
 * Someone holding passes for several events chooses which one to show: tonal chips above the
 * code, the current one ink (D-37). Absent for the usual single pass.
 */
function PassSwitch({ choices, current, onSelect }: { choices: PassChoice[]; current: string | null; onSelect: (eventId: string) => void }) {
  return (
    <div role="group" aria-label="Your passes" className="flex w-full gap-2 overflow-x-auto scrollbar-none">
      {choices.map((choice) => (
        <button
          key={choice.eventId}
          type="button"
          aria-pressed={choice.eventId === current}
          onClick={() => onSelect(choice.eventId)}
          className="flex min-h-12 min-w-36 flex-1 flex-col items-start justify-center px-3.5 py-2 text-left transition-colors duration-120 ease-standard not-aria-pressed:bg-surface-2 not-aria-pressed:hover:bg-surface-3 aria-pressed:bg-action aria-pressed:text-action-foreground motion-reduce:transition-none"
        >
          <span className="w-full truncate text-15 font-medium">{choice.title}</span>
          {choice.startsAt ? <span className="font-mono text-13 opacity-70">{formatDay(choice.startsAt, choice.timezone)}</span> : null}
        </button>
      ))}
    </div>
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
  const choices = passChoices();
  const [picked, setPicked] = useState<string | null>(null);
  const choose = (eventId: string) => {
    if (eventId === pass?.eventId) return;
    setPicked(eventId);
    setNotice(null);
    selectPass(eventId);
    resource.retry();
  };
  const passSwitch =
    choices.length > 1 ? <PassSwitch choices={choices} current={pass?.eventId ?? picked} onSelect={choose} /> : null;
  const showNotice = useCallback((message: string) => setNotice(message), []);

  // stream/me: a revocation or hold lands here while the screen is open (P-16).
  const [announcement, setAnnouncement] = useState("");
  // The state each pass first showed in this visit: a later change is news ("Revoked just now").
  const firstState = useRef(new Map<string, CredentialState>());
  if (pass && !firstState.current.has(pass.eventId)) firstState.current.set(pass.eventId, pass.state);
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
        {passSwitch ? <div className={`${COLUMN} max-w-120 pt-8`}>{passSwitch}</div> : null}
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
    <PageShell>
      <div className="pt-6 md:pt-10 short-landscape:pt-2">
        <p role="status" aria-live="assertive" className="sr-only">
          {announcement}
        </p>
        <div key={pass.eventId} className="enter">
          <PassTicket
            pass={pass}
            online={online}
            liveChange={pass.state !== firstState.current.get(pass.eventId)}
            onNotice={showNotice}
            before={passSwitch}
          />
        </div>
        <p role="status" className="mx-auto mt-3 min-h-5 w-full max-w-110 text-center text-15 text-muted-foreground">
          {notice}
        </p>
        {!online ? (
          <p className="mx-auto mt-2 flex w-full max-w-110 items-center justify-center gap-2 text-15">
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            Offline — your pass still works.
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
