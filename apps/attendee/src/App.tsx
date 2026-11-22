import { Route, Routes, Navigate } from "react-router-dom";
import Discover from "./screens/discover";
import EventDetail from "./screens/event-detail";
import Register from "./screens/register";
import Pass from "./screens/pass";
import NotFound from "./screens/not-found";
import Auth from "./screens/auth";
import PassPair from "./screens/pass-pair";
import Agenda from "./screens/agenda";
import Notifications from "./screens/notifications";
import Account from "./screens/account";
import { RequireSession } from "./components/require-session";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Discover />} />
      <Route path="/events/:slug" element={<EventDetail />} />
      <Route path="/events/:slug/register" element={<Navigate to="identity" replace />} />
      <Route path="/events/:slug/register/identity" element={<Register step="identity" />} />
      <Route path="/events/:slug/register/profile" element={<Register step="profile" />} />
      <Route path="/events/:slug/register/confirm" element={<Register step="confirm" />} />
      <Route path="/pass" element={<Pass />} />
      <Route path="/pass/pair" element={<PassPair />} />
      <Route path="/agenda" element={<Agenda />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/account" element={<RequireSession><Account /></RequireSession>} />
      <Route path="/sign-in" element={<Auth />} />
      <Route path="/verify" element={<Auth />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
