import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import CommandCenter from "./command/command-center";
import EventSummary from "./summary/event-summary";
import { LoadingState } from "./kit";
import { CommandProvider, useCommand } from "./live/context";
import { SCREENS, type ScreenId } from "./routes";
import { NotFound, Placeholder, Standalone } from "./screens/placeholder";
import { AdminShell } from "./shell/admin-shell";

/* Configure screens load on first visit: the Command Center stays the smallest first paint. */
const FirstRun = lazy(() => import("./setup/first-run"));
const VenueList = lazy(() => import("./venues/venue-list"));
const VenueNew = lazy(() => import("./venues/venue-new"));
const VenueEditor = lazy(() => import("./venues/editor/venue-editor"));
const EventList = lazy(() => import("./events/event-list"));
const EventWizard = lazy(() => import("./events/wizard/event-wizard"));
const EventWorkspace = lazy(() => import("./workspace/workspace-layout"));
const WorkspaceOverview = lazy(() => import("./workspace/overview"));
const WorkspaceSchedule = lazy(() => import("./workspace/schedule"));
const WorkspaceRoomsRules = lazy(() => import("./workspace/rooms-rules"));
const WorkspaceAttendees = lazy(() => import("./workspace/attendees"));
const WorkspaceCredentials = lazy(() => import("./workspace/credentials"));
const WorkspaceStaff = lazy(() => import("./workspace/staff"));
const WorkspaceReports = lazy(() => import("./workspace/reports"));
const WorkspaceSettings = lazy(() => import("./workspace/settings"));

/** Shell routes not built yet: honest placeholders (docs/06 §2.1). */
const PLACEHOLDERS: ScreenId[] = [
  "attendees",
  "credentials",
  "accessLog",
  "alerts",
  "staff",
  "gates",
  "gateDetail",
  "reports",
  "eventReport",
  "settings",
];

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}>{children}</Suspense>;
}

/** A closed event lands on its summary (D-21); any other on its overview. */
function EventLanding() {
  const { id } = useParams();
  const { events } = useCommand();
  const event = events?.find((e) => e.id === id);
  if (!events) return null;
  const closed = event && (event.state === "closed" || event.state === "archived");
  return <Navigate to={`/events/${id}/${closed ? "summary" : "overview"}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <CommandProvider>
        <Routes>
          <Route path={SCREENS.signIn.path} element={<Standalone id="signIn" />} />
          <Route
            path={SCREENS.setup.path}
            element={
              <Lazy>
                <FirstRun />
              </Lazy>
            }
          />
          <Route element={<AdminShell />}>
            <Route index element={<CommandCenter />} />
            <Route path={SCREENS.eventSummary.path} element={<EventSummary />} />

            <Route path={SCREENS.venues.path} element={<Lazy><VenueList /></Lazy>} />
            <Route path={SCREENS.venueNew.path} element={<Lazy><VenueNew /></Lazy>} />
            <Route path={SCREENS.venueEditor.path} element={<Lazy><VenueEditor /></Lazy>} />

            <Route path={SCREENS.events.path} element={<Lazy><EventList /></Lazy>} />
            <Route path={SCREENS.eventNew.path} element={<Lazy><EventWizard /></Lazy>} />

            <Route path="/events/:id" element={<Lazy><EventWorkspace /></Lazy>}>
              <Route index element={<EventLanding />} />
              <Route path="overview" element={<Lazy><WorkspaceOverview /></Lazy>} />
              <Route path="schedule" element={<Lazy><WorkspaceSchedule /></Lazy>} />
              <Route path="rooms" element={<Lazy><WorkspaceRoomsRules /></Lazy>} />
              <Route path="attendees" element={<Lazy><WorkspaceAttendees /></Lazy>} />
              <Route path="credentials" element={<Lazy><WorkspaceCredentials /></Lazy>} />
              <Route path="staff" element={<Lazy><WorkspaceStaff /></Lazy>} />
              <Route path="reports" element={<Lazy><WorkspaceReports /></Lazy>} />
              <Route path="settings" element={<Lazy><WorkspaceSettings /></Lazy>} />
            </Route>

            {PLACEHOLDERS.map((id) => (
              <Route key={id} path={SCREENS[id].path} element={<Placeholder id={id} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CommandProvider>
    </BrowserRouter>
  );
}
