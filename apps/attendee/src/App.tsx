import { Mark } from "./brand/mark";
import { Wordmark } from "./brand/wordmark";

const tileSizes = [
  { label: "96", className: "size-24", mark: "size-14" },
  { label: "48", className: "size-12", mark: "size-7" },
  { label: "32", className: "size-8", mark: "size-[18px]" },
];

export default function App() {
  return (
    <main className="bg-background text-foreground min-h-dvh">
      <header className="border-border flex items-center justify-between border-b px-6 py-4 md:px-10">
        <Wordmark className="text-foreground h-6 w-auto" />
        <span className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
          Event operations
        </span>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-14 md:px-10 md:py-20">
        <p className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
          Identity — locked
        </p>

        <Wordmark className="text-foreground mt-8 h-16 w-auto md:h-20" />

        <p className="text-muted-foreground mt-8 max-w-lg text-sm leading-relaxed">
          One wordmark, one mark. The mark is the X, isolated for the app icon, favicon and the scanner
          splash. Teal occurs only where the X does — the rest of the identity is the neutral ground.
        </p>

        <section className="border-border mt-14 border-t pt-8">
          <p className="text-muted-foreground mb-6 font-mono text-[0.625rem] tracking-[0.14em] uppercase">
            Mark
          </p>
          <div className="flex flex-wrap items-end gap-10">
            {tileSizes.map((tile) => (
              <div key={tile.label} className="flex flex-col items-center gap-3">
                <div
                  className={`bg-card border-border text-foreground flex ${tile.className} items-center justify-center border`}
                >
                  <Mark className={tile.mark} />
                </div>
                <span className="text-muted-foreground font-mono text-[0.625rem]">{tile.label}</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-3">
              <Mark className="text-foreground size-16" />
              <span className="text-muted-foreground font-mono text-[0.625rem]">bare</span>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="bg-foreground text-background flex size-16 items-center justify-center">
                <Mark className="size-10" />
              </div>
              <span className="text-muted-foreground font-mono text-[0.625rem]">inverse</span>
            </div>
          </div>
        </section>

        <section className="border-border mt-14 border-t pt-8">
          <p className="text-muted-foreground mb-6 font-mono text-[0.625rem] tracking-[0.14em] uppercase">
            In chrome
          </p>
          <div className="border-border flex items-center justify-between border px-5 py-3">
            <Wordmark className="text-foreground h-5 w-auto" />
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.14em] uppercase">
              Nexus Hall · Live
            </span>
          </div>
          <div className="border-border mt-4 flex items-center gap-3 border px-5 py-3">
            <div className="bg-card border-border flex size-8 items-center justify-center border">
              <Mark className="text-foreground size-[18px]" />
            </div>
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.14em] uppercase">
              Scanner PWA
            </span>
            <span className="text-muted-foreground ml-auto font-mono text-[0.625rem]">installed</span>
          </div>
        </section>
      </div>
    </main>
  );
}
