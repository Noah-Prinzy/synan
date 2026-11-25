/** DEVELOPMENT ONLY — /admin/dev/directions: the admin gallery and its compare view. */
import { useParams, useSearchParams } from "react-router-dom";
import { CompareCurrentView, CompareView, GalleryView, parseMode, type DirectionId, type DxMode } from "@synan/ui/mockups";
import { BASE, ROOT, screenHref } from "./frame";
import { SCREENS } from "./registry";

/** Plain links and iframes: with the /admin basename. */
const hrefFor = (screen: string, d: DirectionId, m: DxMode, extra = "") => `${ROOT}${screenHref(screen, d, m, extra)}`;

/** The attendee gallery on its own dev server (5173 next to 5174). */
function attendeeGalleryHref(m: DxMode) {
  const port = window.location.port === "5174" ? "5173" : window.location.port;
  return `${window.location.protocol}//${window.location.hostname}${port ? `:${port}` : ""}/dev/directions?m=${m}`;
}

export function Gallery() {
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  return (
    <GalleryView
      app="admin"
      mode={mode}
      screens={SCREENS}
      hrefFor={hrefFor}
      compareHref={(screen, m) => `${ROOT}${BASE}/compare/${screen}?m=${m}`}
      compareScreens={[
        { id: "command", label: "Command Center" },
        { id: "command-alert", label: "Command Center alert" },
        { id: "events", label: "Events list" },
        { id: "desk", label: "Desk" },
      ]}
      modeHref={(m) => `${ROOT}${BASE}?m=${m}`}
      other={{ label: "Attendee portal mock-ups", href: attendeeGalleryHref(mode) }}
      currents={[{ id: "command", label: "Command Center", href: `${ROOT}${BASE}/current/command?m=${mode}` }]}
    />
  );
}

export function Compare() {
  const { screen = "command" } = useParams();
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  const width = params.get("w") === "phone" ? "phone" : "desktop";
  const spec = SCREENS.find((s) => s.id === screen) ?? SCREENS[0]!;
  return (
    <CompareView
      app="admin"
      screen={spec.id}
      label={spec.label}
      mode={mode}
      width={width}
      hrefFor={hrefFor}
      backHref={`${ROOT}${BASE}?m=${mode}`}
      selfHref={(next) => {
        const m = next.m ?? mode;
        const w = next.width ?? width;
        return `${ROOT}${BASE}/compare/${spec.id}?m=${m}${w === "phone" ? "&w=phone" : ""}`;
      }}
    />
  );
}

/** Chosen vs the current Command Center, live from this dev server. */
export function CompareCurrent() {
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  const width = params.get("w") === "phone" ? "phone" : "desktop";
  return (
    <CompareCurrentView
      app="admin"
      label="Command Center"
      mode={mode}
      width={width}
      chosenSrc={hrefFor("command", 4, mode, "&bare=1")}
      openChosen={hrefFor("command", 4, mode)}
      currentSrc={`${ROOT}/`}
      currentNote="The current Command Center, live from this dev server (mock session). It shows in this device's own theme setting, which this page does not change."
      backHref={`${ROOT}${BASE}?m=${mode}`}
      selfHref={(next) => `${ROOT}${BASE}/current/command?m=${next.m ?? mode}${(next.width ?? width) === "phone" ? "&w=phone" : ""}`}
    />
  );
}
