/**
 * An honest placeholder: which screen this is, that it is not built, what it will do,
 * and what it will read. No mock data dressed up as a screen.
 */
import { Link, useParams, useSearchParams } from "react-router-dom";
import { GUTTER_X, PageHeader, linkClass } from "../kit";
import { SCREENS, type ScreenId } from "../routes";

/** The shared page header (kit PageHeader); `children` sit on the right as actions. */
export function ScreenHeader({ code, title, children }: { code: string; title: string; children?: React.ReactNode }) {
  return <PageHeader code={code} title={title} actions={children} />;
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
    <div className="min-h-full pb-8">
      <PageHeader
        code={screen.code}
        title={screen.title}
        meta={
          <span className="inline-flex items-baseline gap-2">
            <svg viewBox="0 0 8 8" aria-hidden="true" className="size-2 shrink-0 self-center text-muted-foreground">
              <rect x="1.5" y="1.5" width="5" height="5" fill="none" stroke="currentColor" />
            </svg>
            Not built yet. This route exists so links and handovers resolve; the screen comes in a later phase.
          </span>
        }
      />
      <div className={`py-6 ${GUTTER_X}`}>
        <dl className="grid max-w-240 grid-cols-[7rem_minmax(0,1fr)] border-y border-border text-13 sm:grid-cols-[10rem_minmax(0,1fr)]">
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
        </dl>
        <p className="mt-6 text-13">
          <Link to="/" className={linkClass}>
            Back to the Command Center
          </Link>
        </p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="border-t border-border py-3 pr-4 text-12 text-muted-foreground [&:first-child]:border-t-0">{label}</dt>
      <dd className="min-w-0 border-t border-border py-3 [dt:first-child+&]:border-t-0">{children}</dd>
    </>
  );
}

export function NotFound() {
  return (
    <div className="min-h-full">
      <PageHeader
        code="404"
        title="No such screen"
        meta={
          <>
            This address is not an Admin Command route.{" "}
            <Link to="/" className={linkClass}>
              Go to the Command Center
            </Link>
            .
          </>
        }
      />
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
