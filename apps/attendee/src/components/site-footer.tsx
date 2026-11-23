import { Link } from "react-router-dom";
import { BRAND, Wordmark } from "@synan/ui/brand";

const columns: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: "Your visit",
    links: [
      { to: "/", label: "Events" },
      { to: "/agenda", label: "Agenda" },
      { to: "/pass", label: "My pass" },
      { to: "/notifications", label: "Updates" },
    ],
  },
  {
    title: "Your account",
    links: [
      { to: "/account", label: "Account" },
      { to: "/account#privacy", label: "Privacy and your data" },
      { to: "/pass/pair", label: "Bind a wristband" },
    ],
  },
];

/** Footer in ruled cells (Direction A). */
export default function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="grid md:grid-cols-3">
        <div className="border-b border-border px-4 py-8 sm:px-6 md:border-b-0 md:px-8">
          <span className="text-28">
            <Wordmark />
          </span>
          <p className="mt-3 max-w-[32ch] text-15 text-muted-foreground">
            Your pass, your agenda and the venue's updates, for every event you attend.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title} className="border-b border-border px-4 py-8 sm:px-6 md:border-b-0 md:border-l md:px-8">
            <h2 className="text-13 font-medium text-muted-foreground">{column.title}</h2>
            <ul className="mt-3">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="flex min-h-11 items-center text-15 text-foreground underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border px-4 py-4 text-13 text-muted-foreground sm:px-6 md:px-8">
        <span>
          © <span className="font-mono">2026</span> {BRAND.name}
        </span>
        <span>Times are shown in each event's local time.</span>
      </div>
    </footer>
  );
}
