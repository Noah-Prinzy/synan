import { useEffect } from "react";
import { Link } from "react-router-dom";
import { pageTitle } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { PageShell } from "../components/page";

export default function NotFound() {
  useEffect(() => {
    document.title = pageTitle("Not found");
  }, []);

  return (
    <PageShell>
      <div className="flex flex-col items-start gap-4 py-10">
        <p className="font-mono text-15 text-muted-foreground">404</p>
        <h1 className="font-display text-40">This page doesn&apos;t exist.</h1>
        <p className="text-17 text-muted-foreground">The link may be old, or mistyped.</p>
        <Link to="/" className={buttonClass("secondary", "md", "mt-4")}>
          Back to events
        </Link>
      </div>
    </PageShell>
  );
}
