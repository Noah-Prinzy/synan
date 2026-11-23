import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import CommandCenter from "./command/command-center";
import EventSummary from "./summary/event-summary";
import { CommandProvider, useCommand } from "./live/context";
import { SCREENS, type ScreenId } from "./routes";
import { NotFound, Placeholder, Standalone } from "./screens/placeholder";
import { AdminShell } from "./shell/admin-shell";

/** Shell routes other than D1, all placeholders until built (docs/06 §2.1). */
const PLACEHOLDERS: ScreenId[] = [
  "venues",
  "venueNew",
  "venueEditor",
  "events",
  "eventNew",
  "eventOverview",
  "eventSchedule",
  "eventRooms",
  "eventAttendees",
  "eventCredentials",
  "eventStaff",
  "eventReports",
  "eventSettings",
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

/** A closed event lands on its summary (D-21); any other on its overview. */
function EventLanding() {
  const { id } = useParams();
  const { events } = useCommand();
  const event = events?.find((e) => e.id === id);
  if (!events) return null;
  return <Navigate to={event && (event.state === "closed" || event.state === "archived") ? "summary" : "overview"} replace />;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <CommandProvider>
        <Routes>
          <Route path={SCREENS.signIn.path} element={<Standalone id="signIn" />} />
          <Route path={SCREENS.setup.path} element={<Standalone id="setup" />} />
          <Route element={<AdminShell />}>
            <Route index element={<CommandCenter />} />
            <Route path={SCREENS.eventSummary.path} element={<EventSummary />} />
            <Route path="/events/:id" element={<EventLanding />} />
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
