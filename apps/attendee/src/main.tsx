import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerServiceWorker } from "../../../packages/ui/src/components/mobile";
import App from "./App";
import { applyDevParams } from "./data/mock";
import "./index.css";

applyDevParams(window.location.search);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Production builds only: the app shell and the pass are kept on the phone, so the pass
// opens with no connection and repeat visits paint at once (docs/06 A4, docs/02 §9).
registerServiceWorker("/sw.js", "/", import.meta.env.PROD);
