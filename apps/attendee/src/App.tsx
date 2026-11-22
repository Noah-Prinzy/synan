import { Route, Routes } from "react-router-dom";
import Discover from "./screens/discover";
import EventDetail from "./screens/event-detail";
import NotFound from "./screens/not-found";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Discover />} />
      <Route path="/events/:slug" element={<EventDetail />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
