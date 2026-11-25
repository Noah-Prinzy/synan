import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { BRAND, Wordmark } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { useModal } from "@synan/ui/mobile";
import { useSession } from "../data/auth";

/** The top bar's two words (D-37). The rest is in the phone menu and the footer. */
const topLinks = [
  { to: "/", label: "Events" },
  { to: "/pass", label: "My pass" },
];

/** The phone menu: large words, each with one quiet line saying what is there. */
const menuLinks = [
  { to: "/", label: "Events", note: "What's on, and what's coming" },
  { to: "/pass", label: "My pass", note: "What you show at the door" },
  { to: "/agenda", label: "Agenda", note: "Your sessions, now and next" },
  { to: "/notifications", label: "Updates", note: "Messages from the venue" },
];

/** "Amara Okafor" → "AO"; an email → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** True once the page has moved under the bar (the event page's clear bar turns solid then). */
function useMoved(watch: boolean): boolean {
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!watch) return;
    const onScroll = () => setMoved(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [watch]);
  return watch && moved;
}

/** On a photograph the action sits on glass, so its words keep 4.5:1 over any picture. */
const onGlass = "bg-glass text-glass-ink backdrop-blur-xl";

const square = "grid size-11 shrink-0 place-items-center transition-colors duration-120 ease-standard motion-reduce:transition-none";

/**
 * The one top bar (D-37): the wordmark, Events and My pass, and one action (Sign in, or the
 * holder's initials). On a phone: the wordmark, the action and a menu button that opens a
 * full-height menu of large words. `over` (the event page): the bar lies clear over the picture
 * and turns solid as soon as the page moves under it; from then on `action` (Register) takes
 * the action's place. `onPhoto`: the clear bar lies on a photograph, so its words are white.
 */
export default function SiteHeader({ over = false, onPhoto = false, action }: { over?: boolean; onPhoto?: boolean; action?: ReactNode }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = useRef(() => setOpen(false)).current;
  const moved = useMoved(over);
  const clear = over && !moved;
  const photo = clear && onPhoto;

  useEffect(() => setOpen(false), [pathname]);

  // Focus moves into the menu, Tab stays in it, Escape closes it and focus returns to the
  // menu button; the page behind does not scroll.
  useModal(sheetRef, open, close, { returnTo: toggleRef });

  // Widening past the phone breakpoint closes the menu (it is a phone menu).
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 48rem)");
    const onChange = () => wide.matches && setOpen(false);
    onChange();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const ink = photo ? "text-qr-field" : "text-foreground";
  const rest = photo ? "text-qr-field hover:bg-qr-ink/40" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground";
  const holder = session ? session.name || session.email : "";

  return (
    <header
      className={`z-40 ${over ? "fixed inset-x-0 top-0 transition-colors duration-180 ease-standard motion-reduce:transition-none" : "relative"} ${over && !clear ? "bg-solid shadow-pop" : ""}`}
    >
      <div className="flex h-16 items-center gap-2 pr-3 pl-5 md:h-18 md:gap-6 md:px-8">
        <Link to="/" aria-label={`${BRAND.name} home`} className={`flex min-h-11 items-center text-21 ${ink}`}>
          <Wordmark small tone={photo ? "white" : "colour"} />
        </Link>

        <nav aria-label="Main" className="ml-auto hidden gap-1 md:flex">
          {topLinks.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `inline-flex min-h-10 items-center px-3.5 text-15 transition-colors duration-120 ease-standard motion-reduce:transition-none ${isActive ? `${ink} font-medium` : rest}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {over && !clear && action ? (
            action
          ) : session ? (
            <Link
              to="/account"
              className={`${square} size-10 rounded-full text-13 font-semibold pointer-coarse:size-11 ${photo ? onGlass : "bg-surface-2 hover:bg-surface-3"}`}
            >
              {initials(holder)}
              <span className="sr-only">, your account</span>
            </Link>
          ) : (
            <Link
              to="/sign-in"
              className={photo ? `inline-flex min-h-11 items-center px-4 text-15 font-medium ${onGlass}` : buttonClass("secondary", "sm", "text-15")}
            >
              Sign in
            </Link>
          )}
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label="Menu"
            onClick={() => setOpen(true)}
            className={`${square} md:hidden ${rest}`}
          >
            <Icon d="M3 7h14M3 13h14" />
          </button>
        </div>
      </div>

      {open ? (
        <div
          ref={sheetRef}
          id="site-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fade-in fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground md:hidden"
        >
          <div className="-mr-2 flex h-16 shrink-0 items-center justify-between text-21">
            <Wordmark small />
            <button type="button" aria-label="Close the menu" onClick={close} className={`${square} bg-surface-2 hover:bg-surface-3`}>
              <Icon d="M5 5l10 10M15 5 5 15" />
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1 py-6">
            {[...menuLinks, session ? { to: "/account", label: "Account", note: holder } : { to: "/sign-in", label: "Sign in", note: "With your email, no password" }].map(
              (item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={close}
                  className="-mx-4 flex flex-col px-4 py-3 transition-colors duration-120 ease-standard hover:bg-surface-2 motion-reduce:transition-none"
                >
                  {({ isActive }) => (
                    <>
                      <span className="flex items-center gap-3 font-display text-40 leading-[1.1] font-medium tracking-[-0.02em]">
                        {item.label}
                        {isActive ? <span aria-hidden="true" className="size-2 rounded-full bg-brand" /> : null}
                      </span>
                      <span className="mt-1 text-15 text-muted-foreground">{item.note}</span>
                    </>
                  )}
                </NavLink>
              ),
            )}
          </nav>
          {session ? (
            <div className="mt-auto flex flex-col items-center gap-3">
              <Link to="/pass" onClick={close} className={buttonClass("primary", "md", "min-h-14 w-full text-17")}>
                Show my pass <span aria-hidden="true">→</span>
              </Link>
              <p className="text-13 text-muted-foreground">Signed in as {holder}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
