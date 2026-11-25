/**
 * Development only: preview the console as any role in one click (D-23). The mock signs in as
 * that role's persona at once; the choice is kept across reloads (`?as=<role>` also works).
 * Loaded lazily behind DEV_TOOLS, so none of it ships in a production build.
 */
import { useNavigate } from "react-router-dom";
import { cn } from "@synan/ui/components";
import { CONSOLE_ROLES, ROLE_LABEL, ROLE_CAPABILITIES } from "../access/capabilities";
import { useSession } from "../access/session";

export function RolePicker({ onPicked }: { onPicked?: () => void }) {
  const { role, preview } = useSession();
  const navigate = useNavigate();
  if (!preview) return null;
  return (
    <div role="group" aria-label="View the console as" className="grid grid-cols-2 gap-1">
      {CONSOLE_ROLES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === role}
          onClick={() => {
            void preview(option).then(() => {
              navigate("/");
              onPicked?.();
            });
          }}
          className={cn(
            "border px-2 py-1 text-left text-11 transition-colors duration-120 hover:border-foreground/50 pointer-coarse:py-2.5",
            option === role ? "border-brand text-foreground" : "border-transparent bg-surface-2 text-muted-foreground",
          )}
        >
          <span className="block">{ROLE_LABEL[option]}</span>
          <span className="block font-mono text-muted-foreground">
            {ROLE_CAPABILITIES[option].length === 0
              ? "no console"
              : `${ROLE_CAPABILITIES[option].length} ${ROLE_CAPABILITIES[option].length === 1 ? "capability" : "capabilities"}`}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A small dock for the pages outside the shell (no console, signed out), so a preview can always switch back. */
export default function RoleDock() {
  return (
    <details className="fixed right-2 bottom-2 z-50 w-72 border border-dashed border-foreground/30 bg-popover text-12 text-foreground">
      <summary className="cursor-pointer px-2 py-1 font-mono text-11 tracking-[0.12em] text-muted-foreground hover:text-foreground">
        DEV · view as
      </summary>
      <div className="p-2">
        <RolePicker />
      </div>
    </details>
  );
}
