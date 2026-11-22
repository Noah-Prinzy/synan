import { Route, Routes, Navigate } from "react-router-dom";
import Discover from "./screens/discover";
import EventDetail from "./screens/event-detail";
import Register from "./screens/register";
import Pass from "./screens/pass";
import NotFound from "./screens/not-found";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Discover />} />
      <Route path="/events/:slug" element={<EventDetail />} />
      <Route path="/events/:slug/register" element={<Navigate to="/events/:slug/register/identity" replace />} />
      <Route path="/events/:slug/register/identity" element={<Register step="identity" />} />
      <Route path="/events/:slug/register/profile" element={<Register step="profile" />} />
      <Route path="/events/:slug/register/confirm" element={<Register step="confirm" />} />
      <Route path="/pass" element={<Pass />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
