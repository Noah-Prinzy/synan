/**
 * BRAND BOARD — dev-only, throwaway. Three identity options for Synan, side by side
 * and in use. Route: /brand (development builds only).
 *
 *   /brand                       the board
 *   /brand?preview=<option-id>   one option applied to the real shell, Discover hero,
 *                                event cards and the pass (loaded in the board's frames)
 *
 * Delete this file, the two BrandBoard lines in App.tsx and
 * packages/ui/src/brand/options/ once the owner has picked.
 */
import { useLayoutEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import "@synan/ui/brand/options/fonts.css";
import {
  OPTIONS,
  RULE_CHANGE_TEXT,
  applyIdentity,
  contrast,
  optionById,
  over,
  type IdentityOption,
} from "@synan/ui/brand/options";
import { BrandProvider } from "@synan/ui/brand";
import { PageShell } from "../components/page";
import { EventCard, Featured } from "./discover";
import { PassTicket } from "./pass";
import { getEvents } from "../data/events";
import { getPass } from "../data/pass";

const svgUrls = import.meta.glob("../../../../packages/ui/src/brand/options/*/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function svgUrl(option: IdentityOption, file: "icon" | "mark-on-dark" | "mark-on-light"): string {
  const key = Object.keys(svgUrls).find((path) => path.endsWith(`/${option.id}/${file}.svg`));
  return key ? (svgUrls[key] as string) : "";
}

/* ------------------------------------------------------------------- preview */

function Preview({ option }: { option: IdentityOption }) {
  useLayoutEffect(() => {
    applyIdentity(option);
    document.title = `Preview · ${option.name}`;
  }, [option]);

  const events = getEvents();
  const featured = events.find((event) => event.state === "live") ?? events[0];
  const upcoming = events.find((event) => event.state === "upcoming");
  const live = events.find((event) => event.state === "live" && event !== featured);

  return (
    <BrandProvider wordmark={option.Wordmark}>
      <PageShell bleed>
        {featured ? <Featured event={featured} /> : null}
        <section aria-label="Event cards" className="border-b border-border">
          <ul className="grid sm:grid-cols-2 [&>li]:border-b [&>li]:border-border sm:[&>li:nth-child(odd)]:border-r">
            {live ? <EventCard event={live} index={0} /> : null}
            {upcoming ? <EventCard event={upcoming} index={1} /> : null}
          </ul>
        </section>
        <section aria-label="Pass" className="px-4 py-10 sm:px-6 md:px-10">
          <PassTicket pass={getPass()} />
        </section>
      </PageShell>
    </BrandProvider>
  );
}

/* --------------------------------------------------------------------- board */

function hue(hex: string): number {
  const [r, g, b] = over(hex, hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function Ratio({ fg, bg, min = 4.5, label }: { fg: string; bg: string; min?: number; label: string }) {
  const value = contrast(fg, bg);
  const pass = value >= min;
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border py-2 text-13">
      <span className="flex items-center gap-2">
        <span className="size-3 border border-border" style={{ background: fg }} aria-hidden="true" />
        {label}
      </span>
      <span className="font-mono">
        {value.toFixed(1)}:1 <span className={pass ? "text-success" : "text-destructive"}>{pass ? "✓ AA" : "✕ below AA"}</span>
      </span>
    </li>
  );
}

function Tile({ ground, ink, accent, children, label }: { ground: string; ink: string; accent: string; children: React.ReactNode; label: string }) {
  return (
    <div
      className="flex min-h-40 flex-col justify-between border border-border p-5"
      style={{ background: ground, color: ink, ["--brand" as string]: accent }}
    >
      <p className="font-mono text-12 opacity-70">{label}</p>
      <div className="flex flex-1 items-center justify-center py-4">{children}</div>
    </div>
  );
}

const DARK = "#0A0A0A";
const LIGHT = "#F7F5F0";

function OptionColumn({ option }: { option: IdentityOption }) {
  const { Mark, Wordmark, palette: p } = option;
  const font = (stack: string) => ({ fontFamily: stack });
  const accentHue = hue(p.accent);
  return (
    <article className="flex min-w-0 flex-col gap-8 border-b border-border p-6 lg:border-r lg:border-b-0 [&:last-child]:border-r-0">
      <header>
        <p className="font-mono text-13 text-muted-foreground">Option {option.number}</p>
        <h2 className="mt-1 text-28 font-semibold">{option.name}</h2>
        <p className="mt-2 text-15 leading-relaxed">{option.idea}</p>
        <p className="mt-2 text-15 leading-relaxed text-muted-foreground">{option.says}</p>
        <p className={`mt-4 text-13 font-medium ${option.ruleChanges.length ? "text-warning" : "text-success"}`}>
          {option.ruleChanges.length ? "Needs owner approval:" : "✓ Inside today's rules — no changes needed"}
        </p>
        {option.ruleChanges.length ? (
          <ul className="mt-1 text-13 text-warning">
            {option.ruleChanges.map((change) => (
              <li key={change}>! {RULE_CHANGE_TEXT[change]}</li>
            ))}
          </ul>
        ) : null}
      </header>

      <section aria-label="Wordmark">
        <h3 className="text-15 font-medium">Wordmark</h3>
        <div className="mt-3 grid gap-3">
          <Tile ground={DARK} ink="#FAFAFA" accent={option.markAccent.dark} label="on dark">
            <span className="text-56">
              <Wordmark />
            </span>
          </Tile>
          <Tile ground={LIGHT} ink="#1C1B18" accent={option.markAccent.light} label="on light">
            <span className="text-56">
              <Wordmark />
            </span>
          </Tile>
          <div className="flex items-stretch border border-border" style={{ background: p.ground, color: p.text, ["--brand" as string]: p.accent }}>
            <span className="flex items-center border-r px-4 py-3" style={{ fontSize: 16, borderColor: p.hairline }}>
              <Wordmark />
            </span>
            <span className="flex items-center px-4 text-13" style={{ color: p.muted }}>
              16px in a nav cell
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Mark">
        <h3 className="text-15 font-medium">Mark</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Tile ground={DARK} ink="#FAFAFA" accent={option.markAccent.dark} label="on dark">
            <Mark className="size-32" />
          </Tile>
          <Tile ground={LIGHT} ink="#1C1B18" accent={option.markAccent.light} label="on light">
            <Mark className="size-32" />
          </Tile>
        </div>
        <p className="mt-4 text-13 text-muted-foreground">App icon file at real pixel sizes:</p>
        <div className="mt-2 flex items-end gap-4">
          {[16, 32, 180].map((size) => (
            <figure key={size} className="flex flex-col items-center gap-1">
              <img src={svgUrl(option, "icon")} width={size} height={size} alt="" />
              <figcaption className="font-mono text-12 text-muted-foreground">{size}</figcaption>
            </figure>
          ))}
          <figure className="flex flex-col items-center gap-1">
            <img src={svgUrl(option, "icon")} width={128} height={128} alt="" />
            <figcaption className="font-mono text-12 text-muted-foreground">512 (at 25%)</figcaption>
          </figure>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-13">
          {(["mark-on-dark", "mark-on-light", "icon"] as const).map((file) => (
            <a key={file} href={svgUrl(option, file)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {file}.svg
            </a>
          ))}
        </p>
      </section>

      <section aria-label="Colour">
        <h3 className="text-15 font-medium">
          Colour {option.ruleChanges.includes("paper-theme") ? "(paper)" : option.ruleChanges.includes("warm-ground") ? "(warm dark)" : "(neutral dark)"}
        </h3>
        <div className="mt-3 grid grid-cols-3 border border-border">
          {[
            ["Ground", p.ground],
            ["Surface", p.surface],
            ["Text", p.text],
            ["Muted", p.muted],
            ["Hairline", p.hairline],
            [option.accentName, p.accent],
          ].map(([name, value]) => (
            <div key={name} className="min-w-0">
              <div className="h-14 border-b border-border" style={{ background: value?.startsWith("rgba") ? `linear-gradient(${value},${value}), ${p.ground}` : value }} />
              <p className="truncate px-1.5 pt-1.5 text-12">{name}</p>
              <p className="truncate px-1.5 pb-1.5 font-mono text-12 text-muted-foreground">{value?.startsWith("#") ? value : "rgba"}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3">
          <Ratio label="Text on ground" fg={p.text} bg={p.ground} />
          <Ratio label="Muted on ground" fg={p.muted} bg={p.ground} />
          <Ratio label="Accent on ground (rules, focus)" fg={p.accent} bg={p.ground} min={3} />
          {p.onAccent ? <Ratio label="Label on accent fill" fg={p.onAccent} bg={p.accent} /> : null}
          <Ratio label="Success on ground" fg={p.success} bg={p.ground} min={3} />
          <Ratio label="Warning on ground" fg={p.warning} bg={p.ground} min={3} />
          <Ratio label="Destructive on ground" fg={p.destructive} bg={p.ground} min={3} />
        </ul>
        <div className="mt-4 border border-border p-3" style={{ background: p.ground, color: p.text }}>
          <p className="text-12" style={{ color: p.muted }}>
            Accent beside the three signals — the accent is never a state
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2 text-12">
            {[
              [option.accentName, p.accent, "brand"],
              ["Success", p.success, "✓"],
              ["Warning", p.warning, "!"],
              ["Destructive", p.destructive, "✕"],
            ].map(([name, value, glyph]) => (
              <div key={name}>
                <div className="h-8" style={{ background: value }} />
                <p className="mt-1">
                  <span className="font-mono">{glyph}</span> {name}
                </p>
                <p className="font-mono" style={{ color: p.muted }}>
                  hue {hue(value as string)}°
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-12" style={{ color: p.muted }}>
            Accent hue {accentHue}° sits {Math.min(...[p.success, p.warning, p.destructive].map((s) => {
              const d = Math.abs(hue(s) - accentHue) % 360;
              return Math.min(d, 360 - d);
            }))}° from the nearest signal. States also carry a glyph and a word.
          </p>
        </div>
      </section>

      <section aria-label="Type">
        <h3 className="text-15 font-medium">Type</h3>
        <div className="mt-3 border border-border p-4" style={{ background: p.ground, color: p.text }}>
          <p className="text-12" style={{ color: p.muted }}>
            Display · {option.type.display.family}
          </p>
          <p className="mt-1 text-40 leading-[1.05]" style={font(option.type.display.stack)}>
            Nexus Summit 2026
          </p>
          <p className="mt-4 text-12" style={{ color: p.muted }}>
            UI · {option.type.ui.family}
          </p>
          <p className="mt-1 text-17 leading-relaxed" style={font(option.type.ui.stack)}>
            Show this when you arrive to collect your wristband. Your band opens every door inside.
          </p>
          <p className="mt-4 text-12" style={{ color: p.muted }}>
            Data · {option.type.data.family}
          </p>
          <p className="mt-1 text-15" style={font(option.type.data.stack)}>
            Sun 22 Nov · 09:00 · 864 / 1,200 · 04A2…E2
          </p>
        </div>
        <p className="mt-2 font-mono text-12 text-muted-foreground">
          {option.type.display.pkg} · {option.type.ui.pkg} · {option.type.data.pkg}
        </p>
      </section>

      <section aria-label="Instruments">
        <h3 className="text-15 font-medium">Admin and Scanner (instruments)</h3>
        <p className="mt-1 text-13 text-muted-foreground">Stay neutral dark and dense; only accent and type change.</p>
        <div className="mt-3 border border-white/10 text-13" style={{ background: "#0A0A0A", color: "#FAFAFA", fontFamily: option.type.ui.stack }}>
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="relative">
              Command
              <span className="absolute inset-x-0 -bottom-2 h-px" style={{ background: option.instrumentAccent }} />
            </span>
            <span style={{ fontFamily: option.type.data.stack }}>● LIVE 4 Hz</span>
          </div>
          {[
            ["18:44:12", "Gate 2 · North", "✓ ADMITTED", "#43C07A"],
            ["18:44:07", "Gate 2 · North", "! ALREADY INSIDE", "#E7B643"],
            ["18:43:58", "Door 4 · Workshop A", "✕ NOT PERMITTED", "#FF6467"],
          ].map(([time, gate, result, colour]) => (
            <div key={time} className="grid grid-cols-[4.5rem_1fr_auto] gap-2 border-b border-white/10 px-3 py-1.5 last:border-b-0">
              <span style={{ fontFamily: option.type.data.stack, color: "#A1A1A1" }}>{time}</span>
              <span>{gate}</span>
              <span style={{ fontFamily: option.type.data.stack, color: colour }}>{result}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Sources">
        <h3 className="text-15 font-medium">Where it came from</h3>
        <ul className="mt-2 list-disc pl-5 text-13 leading-relaxed text-muted-foreground">
          {option.sources.map((source) => (
            <li key={source}>{source}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Frame({ option, width, height, scale, label }: { option: IdentityOption; width: number; height: number; scale: number; label: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-13 text-muted-foreground">
        {label} <span className="font-mono">· {width}px</span>
      </figcaption>
      <div className="overflow-hidden border border-border" style={{ width: width * scale, height: height * scale }}>
        <iframe
          title={`${option.name} at ${width}px`}
          src={`/brand?preview=${option.id}`}
          loading="lazy"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
        />
      </div>
    </figure>
  );
}

function Board() {
  useLayoutEffect(() => {
    document.title = "Brand board · Synan";
  }, []);
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-6 py-10">
        <p className="font-mono text-13 text-muted-foreground">Development only · /brand</p>
        <h1 className="mt-2 text-40 font-semibold">Synan — three identity options</h1>
        <p className="mt-3 max-w-[70ch] text-17 leading-relaxed text-muted-foreground">
          Each option is complete: wordmark, mark, palette, type, and the real Attendee Portal shell wearing it.
          Rules kept by all three: square corners, hairlines not shadows, cubic-bezier motion with reduced-motion paths,
          WCAG AA, colour never the only carrier of state. Admin Command and Gate Scanner stay dark instruments in every
          option. Pick one; the rest of this board is deleted.
        </p>
      </header>

      <div className="grid lg:grid-cols-3">
        {OPTIONS.map((option) => (
          <OptionColumn key={option.id} option={option} />
        ))}
      </div>

      <section aria-labelledby="in-use" className="border-t border-border">
        <h2 id="in-use" className="px-6 pt-10 text-28 font-semibold">
          In use — the real shell, Discover hero, event cards and pass
        </h2>
        <p className="px-6 pt-2 text-15 text-muted-foreground">Scroll inside each frame. Frames are the live app, re-skinned by the option's tokens.</p>
        {OPTIONS.map((option) => (
          <div key={option.id} className="border-b border-border px-6 py-8">
            <h3 className="text-21 font-semibold">
              <span className="font-mono text-15 text-muted-foreground">{option.number}</span> {option.name}
            </h3>
            <div className="mt-4 flex flex-wrap items-start gap-6">
              <Frame option={option} width={1280} height={1000} scale={0.6} label="Desktop" />
              <Frame option={option} width={390} height={844} scale={0.72} label="Phone" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function BrandBoard() {
  const [params] = useSearchParams();
  const preview = useMemo(() => optionById(params.get("preview")), [params]);
  return preview ? <Preview option={preview} /> : <Board />;
}
