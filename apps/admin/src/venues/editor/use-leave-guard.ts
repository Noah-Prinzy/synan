/**
 * Warn before leaving the editor with an unpublished draft.
 *
 * The admin router is a <BrowserRouter> (App.tsx), and React Router's `useBlocker` only works
 * inside a data router, so this guards the two ways out it can see: in-app links (caught in the
 * capture phase, before React Router's Link handles the click) and closing or reloading the tab
 * (`beforeunload`). The browser's own Back button is not caught; that needs a data router.
 */
import { useCallback, useEffect, useState } from "react";
import { useHref, useNavigate } from "react-router-dom";

export function useLeaveGuard(active: boolean): {
  pending: string | null;
  stay: () => void;
  leave: () => void;
} {
  const navigate = useNavigate();
  const base = useHref("/").replace(/\/$/, "");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value set to show their prompt.
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      if (base && !url.pathname.startsWith(base)) return;
      event.preventDefault();
      setPending(`${url.pathname.slice(base.length) || "/"}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, base]);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const to = pending;
    setPending(null);
    if (to) navigate(to);
  }, [pending, navigate]);

  return { pending, stay, leave };
}
