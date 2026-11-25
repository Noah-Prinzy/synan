import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Mark, pageTitle } from "@synan/ui/brand";
import { buttonClass } from "@synan/ui/components";
import { PageHeader, PageShell } from "../components/page";

export default function NotFound() {
  useEffect(() => {
    document.title = pageTitle("Not found");
  }, []);

  return (
    <PageShell>
      <div className="flex justify-center pt-12 md:pt-20">
        <Mark size={56} title="" />
      </div>
      <PageHeader
        label={<span className="font-mono">404</span>}
        title="This page doesn't exist."
        more="The link may be old, or mistyped."
        aside={
          <Link to="/" className={buttonClass("secondary", "md")}>
            Back to events
          </Link>
        }
      />
    </PageShell>
  );
}
