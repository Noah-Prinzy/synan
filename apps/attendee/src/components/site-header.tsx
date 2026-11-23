import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { BRAND, Wordmark } from "@synan/ui/brand";
import { useSession } from "../data/auth";

const navItems = [
  { to: "/", label: "Events" },
  { to: "/agenda", label: "Agenda" },
  { to: "/notifications", label: "Updates" },
  { to: "/pass", label: "My pass" },
];

/** The logotype reveal plays once: when the app first loads on the home page, nowhere else. */
const revealOnLoad = typeof window !== "undefined" && window.location.pathname === "/";
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

/** Keep Tab focus inside `container` while it is open. */
function useFocusTrap(container: React.RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const node = container.current;
    if (!node) return;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [active, container, onEscape]);
}

export default function SiteHeader() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = useRef(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }).current;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useFocusTrap(sheetRef, open, close);

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
          className="fade-in fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t border-border bg-background md:hidden"
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
                      `flex min-h-16 items-center justify-between px-4 font-display text-28 sm:px-6 ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    {item.label}
                    <span aria-hidden="true" className="text-17">→</span>
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
