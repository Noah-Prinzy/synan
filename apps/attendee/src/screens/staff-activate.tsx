/**
 * `/staff/activate#token=…`: where staff invitations sent before the fix pointed (they now open the
 * role's own app). Kept so those links still work: it forwards at once to the Admin Command's
 * activation page with the fragment unchanged — that page checks the link and sends gate staff on
 * to the Gate Scanner. The token never leaves the fragment, is not read or stored here, and the
 * target is a build-time constant (no open redirect).
 *
 * Build time: VITE_ADMIN_URL (origin and base path); by default the dev server, or `/admin` on the
 * same origin in a production build (01 §2 route roots).
 */
import { useEffect } from "react";
import { pageTitle } from "@synan/ui/brand";
import { PageShell } from "../components/page";

const env = import.meta.env.VITE_ADMIN_URL as string | undefined;
const ADMIN_URL = (env?.trim() || (import.meta.env.DEV ? "http://localhost:5174/admin" : "/admin")).replace(/\/+$/, "");
const target = () => `${ADMIN_URL}/activate${window.location.hash}`;

export default function StaffActivate() {
  useEffect(() => {
    document.title = pageTitle("Staff account");
    window.location.replace(target());
  }, []);
  return (
    <PageShell>
      <div className="flex flex-col items-start gap-4 py-10">
        <h1 className="font-display text-40">Opening your staff account…</h1>
        <p className="text-17 text-muted-foreground">
          Staff accounts are set up in the Admin Command.{" "}
          <button type="button" className="underline underline-offset-4" onClick={() => window.location.replace(target())}>
            Continue
          </button>{" "}
          if nothing happens.
        </p>
      </div>
    </PageShell>
  );
}
