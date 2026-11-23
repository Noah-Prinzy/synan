import { Link, useLocation } from "react-router-dom";
import { useTyping } from "@synan/ui/mobile";
import { useSession } from "../data/auth";

/**
 * Sticky bottom bar on phones offering My pass to anyone signed in (docs/06 §1).
 * Hidden on the pass screens themselves and from md up, where the nav shows it.
 */
export function usePassBarVisible(): boolean {
  const session = useSession();
  const { pathname } = useLocation();
  return Boolean(session) && !pathname.startsWith("/pass");
}

export default function PassBar() {
  // While a field has focus the on-screen keyboard is up: the bar steps aside so it never
  // sits over the field being typed in or the form's button.
  const typing = useTyping();
  if (!usePassBarVisible() || typing) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <Link
        to="/pass"
        className="pressable flex min-h-14 items-center justify-between px-4 text-17 font-medium sm:px-6"
      >
        My pass
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
