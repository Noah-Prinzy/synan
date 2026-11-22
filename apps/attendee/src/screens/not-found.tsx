import { Link } from "react-router-dom";
import SiteHeader from "../components/site-header";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute top-0 -left-[9999px] focus:left-4 focus:top-4 focus:z-50 focus:block focus:border focus:border-brand focus:bg-background focus:px-3 focus:py-2 focus:font-mono focus:text-[0.6875rem] focus:tracking-[0.12em] focus:text-brand focus:uppercase focus:underline focus:underline-offset-2"
    >
      Skip to content
    </a>
  );
}

export default function NotFound() {
  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <SkipLink />
      <SiteHeader />
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
