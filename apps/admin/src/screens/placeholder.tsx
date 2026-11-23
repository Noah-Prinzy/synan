/**
 * An honest placeholder: which screen this is, that it is not built, what it will do,
 * and what it will read. No mock data dressed up as a screen.
 */
import { Link, useParams, useSearchParams } from "react-router-dom";
import { SCREENS, type ScreenId } from "../routes";

export function ScreenHeader({ code, title, children }: { code: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 border-b border-border px-6 pt-6 pb-4">
      <div>
        <p className="font-mono text-11 text-muted-foreground">{code}</p>
        <h1 className="mt-1 font-display text-28 leading-tight tracking-tight">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Placeholder({ id }: { id: ScreenId }) {
  const screen = SCREENS[id];
  const params = useParams();
  const [search] = useSearchParams();
  const context = [
    ...Object.entries(params).filter(([, value]) => value),
    ...[...search.entries()],
  ];
  return (
    <div className="min-h-full">
      <ScreenHeader code={screen.code} title={screen.title} />
      <div className="grid max-w-240 grid-cols-[10rem_minmax(0,1fr)] border-b border-border">
        <Row label="Status">
          <span className="inline-flex items-center gap-2">
            <svg viewBox="0 0 8 8" aria-hidden="true" className="size-2 text-muted-foreground">
              <rect x="1.5" y="1.5" width="5" height="5" fill="none" stroke="currentColor" />
            </svg>
            Not built yet. This route exists so links and handovers resolve; the screen comes in a later phase.
          </span>
        </Row>
        <Row label="Will do">{screen.purpose}</Row>
        <Row label="Reads">
          <span className="font-mono text-12">{screen.data}</span>
        </Row>
        {context.length > 0 ? (
          <Row label="Opened with">
            <span className="font-mono text-12">
              {context.map(([key, value]) => `${key} = ${value}`).join(" · ")}
            </span>
          </Row>
        ) : null}
        <Row label="Spec">docs/06-screens.md §2.3, {screen.code}</Row>
      </div>
      <p className="px-6 py-4 text-13 text-muted-foreground">
        <Link to="/" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Back to the Command Center
        </Link>
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="border-t border-border px-6 py-3 text-12 text-muted-foreground first:border-t-0">{label}</div>
      <div className="border-t border-border border-l px-4 py-3 text-13">{children}</div>
    </>
  );
}

export function NotFound() {
  return (
    <div className="min-h-full">
      <ScreenHeader code="404" title="No such screen" />
      <p className="px-6 py-4 text-13 text-muted-foreground">
        This address is not an Admin Command route.{" "}
        <Link to="/" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Go to the Command Center
        </Link>
        .
      </p>
    </div>
  );
}

/** Outside the shell: sign-in and first run have no chrome. */
export function Standalone({ id }: { id: ScreenId }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-13 text-foreground">
      <div className="w-full max-w-120 border border-border">
        <Placeholder id={id} />
      </div>
    </div>
  );
}
