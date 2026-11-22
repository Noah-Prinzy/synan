import { useSession } from "../data/auth";
import { NavLink, Link } from "react-router-dom";
import { Wordmark } from "../brand/wordmark";

export interface SiteHeaderProps {
  title?: string;
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => {
        const base = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand px-2 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none";
        return isActive
          ? `${base} text-brand border-b border-brand`
          : `${base} text-muted-foreground hover:text-foreground`;
      }}
    >
      {children}
    </NavLink>
  );
}

function AuthNav() {
  const session = useSession();
  
  if (session) {
    return (
      <NavItem to="/account">Account</NavItem>
    );
  }
  return (
    <NavItem to="/sign-in">Sign in</NavItem>
  );
}

export default function SiteHeader({ title }: SiteHeaderProps) {
  return (
    <header className="border-border border-b px-6 py-4 md:px-10">
      <div className="mx-auto w-full max-w-[1600px] flex items-center justify-between gap-6">
        <Link to="/" aria-label="Connexia home" className="shrink-0">
          <Wordmark className="h-7 w-auto" />
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-6 sm:gap-8">
          <NavItem to="/">Events</NavItem>
          <NavItem to="/agenda">Agenda</NavItem>
          <NavItem to="/notifications">Updates</NavItem>
          <NavItem to="/pass">My pass</NavItem>
          <AuthNav />
        </nav>
      </div>
    </header>
  );
}
