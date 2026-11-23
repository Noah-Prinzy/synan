import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerServiceWorker } from "@synan/ui/mobile";
import App from "./App";
import { applyDevParams } from "./data/mock";
import "./index.css";

applyDevParams(window.location.search);

// The static frame in index.html stays until the app's own header is in the DOM, then goes
// in the same frame (a MutationObserver callback runs before the next paint).
const boot = document.getElementById("boot");
const root = document.getElementById("root")!;
if (boot) {
  const observer = new MutationObserver(() => {
    if (!root.querySelector("header")) return;
    boot.remove();
    observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
}

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
