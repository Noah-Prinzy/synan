import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireCapability, SessionGate } from "./access/guard";
import { SessionProvider, useSession } from "./access/session";
import CommandCenter from "./command/command-center";
import EventSummary from "./summary/event-summary";
import { LoadingState } from "./kit";
import { CommandProvider, useCommand } from "./live/context";
import { SCREENS, type ScreenId } from "./routes";
import { NotFound, Placeholder } from "./screens/placeholder";
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
const Desk = lazy(() => import("./desk/desk"));
const Alerts = lazy(() => import("./ops/alerts"));
const Gates = lazy(() => import("./ops/gates"));
const GateDetail = lazy(() => import("./ops/gate-detail"));
const AccessLog = lazy(() => import("./ops/access-log"));

/** Shell routes not built yet: honest placeholders (docs/06 §2.1). */
const PLACEHOLDERS: ScreenId[] = ["attendees", "staff", "reports", "eventReport", "settings"];

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}>{children}</Suspense>;
}

/** A route the signed-in role must be allowed to open (the screen's `need` in routes.ts). */
function Screen({ id, children }: { id: ScreenId; children: ReactNode }) {
  const need = (SCREENS[id] as { need?: Parameters<typeof RequireCapability>[0]["need"] }).need;
  const body = <Lazy>{children}</Lazy>;
  return need ? <RequireCapability need={need}>{body}</RequireCapability> : body;
}

/** `/`: the Command Center for a role that watches; anyone else goes to where their role starts. */
function Home() {
  const { can, landing } = useSession();
  if (!can("live.view")) return <Navigate to={landing} replace />;
  return <CommandCenter />;
}

/** A closed event lands on its summary (D-21); any other on its overview. */
function EventLanding() {
  const { id } = useParams();
  const { events } = useCommand();
  const { can } = useSession();
  const event = events?.find((e) => e.id === id);
  if (!events) return null;
  const closed = event && (event.state === "closed" || event.state === "archived");
  return <Navigate to={`/events/${id}/${closed && can("reports.view") ? "summary" : "overview"}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <SessionProvider>
        <CommandProvider>
          <Routes>
            {/* Signing in and out happens in the session gate; an old sign-in link lands home. */}
            <Route path={SCREENS.signIn.path} element={<Navigate to="/" replace />} />
            <Route
              path={SCREENS.setup.path}
              element={
                <SessionGate>
                  <Screen id="setup">
                    <FirstRun />
                  </Screen>
                </SessionGate>
              }
            />
            <Route
              element={
                <SessionGate>
                  <AdminShell />
                </SessionGate>
              }
            >
              <Route index element={<Home />} />
              <Route path={SCREENS.eventSummary.path} element={<Screen id="eventSummary"><EventSummary /></Screen>} />

              <Route path={SCREENS.venues.path} element={<Screen id="venues"><VenueList /></Screen>} />
              <Route path={SCREENS.venueNew.path} element={<Screen id="venueNew"><VenueNew /></Screen>} />
              <Route path={SCREENS.venueEditor.path} element={<Screen id="venueEditor"><VenueEditor /></Screen>} />

              <Route path={SCREENS.events.path} element={<Screen id="events"><EventList /></Screen>} />
              <Route path={SCREENS.eventNew.path} element={<Screen id="eventNew"><EventWizard /></Screen>} />

              <Route path="/events/:id" element={<Screen id="eventOverview"><EventWorkspace /></Screen>}>
                <Route index element={<EventLanding />} />
                <Route path="overview" element={<Screen id="eventOverview"><WorkspaceOverview /></Screen>} />
                <Route path="schedule" element={<Screen id="eventSchedule"><WorkspaceSchedule /></Screen>} />
                <Route path="rooms" element={<Screen id="eventRooms"><WorkspaceRoomsRules /></Screen>} />
                <Route path="attendees" element={<Screen id="eventAttendees"><WorkspaceAttendees /></Screen>} />
                <Route path="credentials" element={<Screen id="eventCredentials"><WorkspaceCredentials /></Screen>} />
                <Route path="staff" element={<Screen id="eventStaff"><WorkspaceStaff /></Screen>} />
                <Route path="reports" element={<Screen id="eventReports"><WorkspaceReports /></Screen>} />
                <Route path="settings" element={<Screen id="eventSettings"><WorkspaceSettings /></Screen>} />
              </Route>

              <Route path={SCREENS.desk.path} element={<Screen id="desk"><Desk /></Screen>} />
              <Route path="/credentials" element={<Navigate to={SCREENS.desk.path} replace />} />
              <Route path={SCREENS.alerts.path} element={<Screen id="alerts"><Alerts /></Screen>} />
              <Route path={SCREENS.gates.path} element={<Screen id="gates"><Gates /></Screen>} />
              <Route path={SCREENS.gateDetail.path} element={<Screen id="gateDetail"><GateDetail /></Screen>} />
              <Route path={SCREENS.accessLog.path} element={<Screen id="accessLog"><AccessLog /></Screen>} />

              {PLACEHOLDERS.map((id) => (
                <Route key={id} path={SCREENS[id].path} element={<Screen id={id}><Placeholder id={id} /></Screen>} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </CommandProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
