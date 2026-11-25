/** DEVELOPMENT ONLY — /dev/directions: the attendee gallery and its compare view. */
import { useParams, useSearchParams } from "react-router-dom";
import { CompareCurrentView, CompareView, GalleryView, parseMode, type DirectionId, type DxMode } from "@synan/ui/mockups";
import { BASE, screenHref } from "./frame";
import { SCREENS } from "./registry";

const hrefFor = (screen: string, d: DirectionId, m: DxMode, extra = "") => screenHref(screen, d, m, true, extra);

/** The admin's gallery on its own dev server (5174 next to 5173). */
export function adminGalleryHref(m: DxMode) {
  const port = window.location.port === "5173" ? "5174" : window.location.port;
  return `${window.location.protocol}//${window.location.hostname}${port ? `:${port}` : ""}/admin/dev/directions?m=${m}`;
}

export function Gallery() {
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  return (
    <GalleryView
      app="attendee"
      mode={mode}
      screens={SCREENS}
      hrefFor={hrefFor}
      compareHref={(screen, m) => `${BASE}/compare/${screen}?m=${m}`}
      compareScreens={[
        { id: "showcase", label: "Event showcase" },
        { id: "event", label: "Event page" },
      ]}
      modeHref={(m) => `${BASE}?m=${m}`}
      other={{ label: "Admin console mock-ups", href: adminGalleryHref(mode) }}
      currents={CURRENT.map((c) => ({ id: c.id, label: c.label, href: `${BASE}/current/${c.id}?m=${mode}` }))}
    />
  );
}

export function Compare() {
  const { screen = "showcase" } = useParams();
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  const photo = params.get("photo") !== "0";
  const width = params.get("w") === "phone" ? "phone" : "desktop";
  const spec = SCREENS.find((s) => s.id === screen) ?? SCREENS[0]!;
  return (
    <CompareView
      app="attendee"
      screen={spec.id}
      label={spec.label}
      mode={mode}
      photo={spec.photo ? photo : undefined}
      width={width}
      hrefFor={hrefFor}
      backHref={`${BASE}?m=${mode}`}
      selfHref={(next) => {
        const m = next.m ?? mode;
        const p = next.photo ?? photo;
        const w = next.width ?? width;
        return `${BASE}/compare/${spec.id}?m=${m}${p ? "" : "&photo=0"}${w === "phone" ? "&w=phone" : ""}`;
      }}
    />
  );
}

/** The real screens on this dev server, for "Chosen vs current site". */
const CURRENT = [
  { id: "showcase", label: "Event showcase", path: "/", note: "The current home, live from this dev server." },
  { id: "event", label: "Event page", path: "/events/nexus-summit-2026", note: "The current event page for the same event." },
  { id: "pass", label: "Pass", path: "/pass", note: "The current pass needs a signed-in (mock) session: if it shows sign-in, sign in inside this frame." },
] as const;

export function CompareCurrent() {
  const { screen = "showcase" } = useParams();
  const [params] = useSearchParams();
  const mode = parseMode(params.get("m"));
  const width = params.get("w") === "phone" ? "phone" : "desktop";
  const spec = CURRENT.find((c) => c.id === screen) ?? CURRENT[0];
  return (
    <CompareCurrentView
      app="attendee"
      label={spec.label}
      mode={mode}
      width={width}
      chosenSrc={screenHref(spec.id, 4, mode, true, "&bare=1")}
      openChosen={screenHref(spec.id, 4, mode)}
      currentSrc={spec.path}
      currentNote={`${spec.note} It shows in this device's own theme setting, which this page does not change.`}
      backHref={`${BASE}?m=${mode}`}
      selfHref={(next) => `${BASE}/current/${spec.id}?m=${next.m ?? mode}${(next.width ?? width) === "phone" ? "&w=phone" : ""}`}
    />
  );
}
