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

/** RouteFallback: a quiet ground while a route's chunk loads; no spinner for short waits. */
function RouteFallback() {
  return <div className="min-h-dvh bg-background" aria-busy="true" />;
}

function Gate({ children }: { children: ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}

export default function App() {
  return (
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
