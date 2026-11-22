import { Link } from "react-router-dom";
import { Wordmark } from "../brand/wordmark";

export default function NotFound() {
  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border border-b px-6 py-4 md:px-10">
        <Link to="/" aria-label="Connexia home">
          <Wordmark className="text-foreground h-6 w-auto" />
        </Link>
      </header>
      <div className="flex flex-1 flex-col items-start justify-center gap-4 px-6 md:px-10">
        <p className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
          404
        </p>
        <h1 className="font-serif text-3xl font-normal">This page doesn’t exist.</h1>
        <Link to="/" className="text-sm underline underline-offset-4">
          Back to events
        </Link>
      </div>
    </main>
  );
}
