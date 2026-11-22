import { Link, NavLink } from "react-router-dom"
import SiteHeader from "../components/site-header";
import { Wordmark } from "../brand/wordmark";

function SkipLink() {
  return (
    <a
      href="#content"
      className="focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:block focus:bg-background focus:p-2 focus:text-brand focus:underline focus:underline-offset-2 motion-reduce:transition-none"
      style={{ position: "absolute", left: "-9999px", top: 0 }}
    >
      Skip to content
    </a>
  );
}

function SiteNav() {
  return (
    <nav aria-label="Main navigation" className="flex items-center gap-6 sm:gap-8">
      <NavLink
        to="/"
        className={({ isActive }) => {
          const base = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand px-2 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none";
          return isActive
            ? `${base} text-brand border-b border-brand`
            : `${base} text-muted-foreground hover:text-foreground`;
        }}
      >
        Events
      </NavLink>
      <NavLink
        to="/pass"
        className={({ isActive }) => {
          const base = "focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand px-2 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none";
          return isActive
            ? `${base} text-brand border-b border-brand`
            : `${base} text-muted-foreground hover:text-foreground`;
        }}
      >
        My pass
      </NavLink>
    </nav>
  );
}

export default function NotFound() {
  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-border border-b">
        <div className="mx-auto w-full max-w-[1600px] flex items-center justify-between gap-4 px-6 py-4 md:px-10 xl:px-16">
          <Link to="/" aria-label="Connexia home">
            <Wordmark className="text-foreground h-6 w-auto" />
          </Link>
          <SiteHeader />
        </div>
      </header>
      <div id="content" className="flex flex-1 flex-col items-start justify-center gap-4 mx-auto w-full max-w-[1600px] px-6 md:px-10 xl:px-16">
        <p className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
          404
        </p>
        <h1 className="font-serif text-3xl font-normal">This page doesn&apos;t exist.</h1>
        <Link to="/" className="text-sm underline underline-offset-4">
          Back to events
        </Link>
      </div>
    </main>
  );
}
