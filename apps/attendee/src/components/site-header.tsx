import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { BRAND, Wordmark } from "@synan/ui/brand";
import { useSession } from "../data/auth";
import { useModal } from "@synan/ui/mobile";

const navItems = [
  { to: "/", label: "Events" },
  { to: "/agenda", label: "Agenda" },
  { to: "/notifications", label: "Updates" },
  { to: "/pass", label: "My pass" },
];

/** The logotype reveal plays once: when the app first loads on the home page, nowhere else. */
// Off (owner, 2026-11-23: less animation; the reveal explained nothing). To restore:
// typeof window !== "undefined" && window.location.pathname === "/"
const revealOnLoad = false;
let revealConsumed = false;

const cell =
  "relative flex items-center border-l border-border px-5 text-15 transition-colors duration-120 ease-standard motion-reduce:transition-none";

/** Active cell: foreground text and a 1px brand rule along the bottom edge (an "active rule"). */
function NavCell({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `${cell} ${isActive ? "text-foreground" : "text-muted-foreground hover:bg-card/40 hover:text-foreground"}`
      }
    >
      {({ isActive }) => (
        <>
          {label}
          <span
            aria-hidden="true"
            className={`absolute inset-x-0 -bottom-px h-px origin-left bg-brand transition-transform duration-180 ease-standard motion-reduce:transition-none ${
              isActive ? "scale-x-100" : "scale-x-0"
            }`}
          />
        </>
      )}
    </NavLink>
  );
}

export default function SiteHeader() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = useRef(() => {
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  }).current;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Focus moves into the menu, Tab cycles through it and the Close button, Escape closes
  // and returns focus to the button, and the page behind does not scroll.
  useModal(sheetRef, open, close, { also: [toggleRef] });

  // Rotating or resizing past the phone breakpoint closes the menu (it is hidden there).
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 48rem)");
    const onChange = () => wide.matches && setOpen(false);
    onChange();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const [reveal] = useState(() => revealOnLoad && !revealConsumed);
  useEffect(() => {
    revealConsumed = true;
  }, []);

  const account = session ? { to: "/account", label: "Account" } : { to: "/sign-in", label: "Sign in" };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="flex h-14 items-stretch md:h-16">
        <Link
          to="/"
          aria-label={`${BRAND.name} home`}
          className="flex items-center px-4 text-21 sm:px-6 md:px-8 md:text-28"
        >
          <Wordmark small reveal={reveal} />
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-stretch md:flex">
          {navItems.map((item) => (
            <NavCell key={item.to} to={item.to} label={item.label} />
          ))}
          <NavCell to={account.to} label={account.label} />
        </nav>

        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto flex min-w-14 items-center justify-center gap-2 border-l border-border px-4 text-15 md:hidden"
        >
          <span aria-hidden="true" className="flex w-4 flex-col gap-1">
            <span className={`h-px w-full bg-current transition-transform duration-180 ease-standard motion-reduce:transition-none ${open ? "translate-y-[2.5px] rotate-45" : ""}`} />
            <span className={`h-px w-full bg-current transition-transform duration-180 ease-standard motion-reduce:transition-none ${open ? "translate-y-[-2.5px] -rotate-45" : ""}`} />
          </span>
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open ? (
        <div
          ref={sheetRef}
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fade-in fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto overscroll-contain border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <nav aria-label="Main">
            <ul>
              {[...navItems, account].map((item, index) => (
                <li key={item.to} className="enter border-b border-border" style={{ ["--i" as string]: index }}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `relative flex min-h-16 items-center justify-between px-4 font-display text-28 active:bg-card/40 sm:px-6 ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* Where you are: the 2px accent rule of an active list item (docs/05 §2.1). */}
                        {isActive ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
                        {item.label}
                        {isActive ? null : <span aria-hidden="true" className="text-17">→</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
