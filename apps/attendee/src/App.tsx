import { Ambient } from "./components/ambient";
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { RequireSession } from "./components/require-session";

// Route-split so the pass screen loads only its own code (docs/02 §9 budget).
const Discover = lazy(() => import("./screens/discover"));
const EventDetail = lazy(() => import("./screens/event-detail"));
const Register = lazy(() => import("./screens/register"));
const Pass = lazy(() => import("./screens/pass"));
const NotFound = lazy(() => import("./screens/not-found"));
const Auth = lazy(() => import("./screens/auth"));
const PassPair = lazy(() => import("./screens/pass-pair"));
const Agenda = lazy(() => import("./screens/agenda"));
const Notifications = lazy(() => import("./screens/notifications"));
const Account = lazy(() => import("./screens/account"));
const Invite = lazy(() => import("./screens/invite"));
/** Old staff invitation links: forwarded to the Admin Command's activation page. */
const StaffActivate = lazy(() => import("./screens/staff-activate"));
/** Development only: every control in every state (never in a production build). */
const DevControls = import.meta.env.DEV ? lazy(() => import("./screens/dev-controls")) : null;

/** RouteFallback: the bare ground while a route's chunk loads (the field shows through); no spinner for short waits. */
function RouteFallback() {
  return <div className="min-h-dvh" aria-busy="true" />;
}

function Gate({ children }: { children: ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}

export default function App() {
  return (
    <>
    <Ambient />
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Discover />} />
        <Route path="/events/:slug" element={<EventDetail />} />
        <Route path="/events/:slug/register" element={<Navigate to="identity" replace />} />
        <Route path="/events/:slug/register/identity" element={<Register step="identity" />} />
        <Route path="/events/:slug/register/profile" element={<Register step="profile" />} />
        <Route path="/events/:slug/register/confirm" element={<Register step="confirm" />} />
        <Route path="/pass" element={<Gate><Pass /></Gate>} />
        <Route path="/pass/pair" element={<Gate><PassPair /></Gate>} />
        <Route path="/agenda" element={<Gate><Agenda /></Gate>} />
        <Route path="/notifications" element={<Gate><Notifications /></Gate>} />
        <Route path="/account" element={<Gate><Account /></Gate>} />
        <Route path="/sign-in" element={<Auth />} />
        <Route path="/verify" element={<Auth />} />
        {/* Where the API's emailed sign-in link lands: /auth/verify#token=…&return_to=… */}
        <Route path="/auth/verify" element={<Auth />} />
        {/* A10. The API's emailed link is /invite#token=…; /invite/:token moves its token there. */}
        <Route path="/invite" element={<Invite />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/staff/activate" element={<StaffActivate />} />
        {DevControls ? <Route path="/dev/controls" element={<DevControls />} /> : null}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </>
  );
}
