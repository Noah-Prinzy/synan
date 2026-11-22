import { BrowserRouter, Route, Routes } from "react-router-dom";
import Command from "./screens/command";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route path="/" element={<Command />} />
      </Routes>
    </BrowserRouter>
  );
}
