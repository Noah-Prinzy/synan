import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { lockPortraitOnPhones, registerServiceWorker } from "@synan/ui/mobile";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installed and offline-capable in production builds; nothing in development.
registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`, import.meta.env.BASE_URL, import.meta.env.PROD);
lockPortraitOnPhones();
