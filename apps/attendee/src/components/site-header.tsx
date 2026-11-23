import { useEffect, useRef, useState } from "react";
import { useSession } from "../data/auth";
import { NavLink, Link, useLocation } from "react-router-dom";
import { Wordmark } from "../brand/wordmark";
import { AnimatedUnderline } from "@connexia/ui/components";

export interface SiteHeaderProps {
  title?: string;
}

const navItems = [
  { to: "/", label: "Events" },
  { to: "/agenda", label: "Agenda" },
  { to: "/notifications", label: "Updates" },
  { to: "/pass", label: "My pass" },
];

const navText =
  "font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand";

function DesktopNavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={to === "/"} className={navText}>
      {({ isActive }) => (
        <span className={`relative inline-block px-1 py-2 ${isActive ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}>
          {children}
          <AnimatedUnderline active={isActive} />
        </span>
      )}
    </NavLink>
  );
}

function AuthNavLink({ onClick }: { onClick?: () => void }) {
  const session = useSession();

  if (session) {
    return (
      <NavLink
        to="/account"
        onClick={onClick}
        className={({ isActive }) =>
          `relative px-1 py-2 ${navText} ${isActive ? "text-brand" : "text-muted-foreground hover:text-foreground"}`
        }
      >
        Account
      </NavLink>
    );
  }
  return (
    <NavLink
      to="/sign-in"
      onClick={onClick}
      className={({ isActive }) =>
        `relative px-1 py-2 ${navText} ${isActive ? "text-brand" : "text-muted-foreground hover:text-foreground"}`
      }
    >
      Sign in
    </NavLink>
  );
}

export default function SiteHeader(_props: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;

    firstLinkRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-6 px-6 py-3.5 md:px-10 xl:px-16">
        <Link to="/" aria-label="Connexia home" className="shrink-0">
          <Wordmark className="h-6 w-auto md:h-7" />
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => (
            <DesktopNavItem key={item.to} to={item.to}>
              {item.label}
            </DesktopNavItem>
          ))}
          <span aria-hidden="true" className="h-3 w-px bg-border" />
          <AuthNavLink />
        </nav>

        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 border border-border px-3 py-2 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-foreground transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand md:hidden motion-reduce:transition-none"
        >
          <span aria-hidden="true" className="flex w-3.5 flex-col gap-[3px]">
            <span className="h-px w-full bg-current" />
            <span className="h-px w-full bg-current" />
            <span className="h-px w-full bg-current" />
          </span>
          Menu
        </button>
      </div>

      {open ? (
        <nav id="mobile-nav" aria-label="Main navigation" className="border-t border-border md:hidden">
          <ul className="flex flex-col">
            {navItems.map((item, index) => (
              <li key={item.to} className="border-b border-border last:border-b-0">
                <NavLink
                  ref={index === 0 ? firstLinkRef : undefined}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between px-6 py-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] ${
                      isActive ? "text-brand" : "text-muted-foreground"
                    }`
                  }
                >
                  {item.label}
                  <span aria-hidden="true">→</span>
                </NavLink>
              </li>
            ))}
            <li>
              <div className="px-6 py-3">
                <AuthNavLink onClick={() => setOpen(false)} />
              </div>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
