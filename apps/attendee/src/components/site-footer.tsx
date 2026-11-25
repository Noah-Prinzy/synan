import { Link } from "react-router-dom";
import { BRAND } from "@synan/ui/brand";
import { ThemeSwitch } from "@synan/ui/components";

const links = [
  { to: "/agenda", label: "Agenda" },
  { to: "/notifications", label: "Updates" },
  { to: "/pass/pair", label: "Bind a wristband" },
  { to: "/account#privacy", label: "Privacy and your data" },
];

/** A quiet footer (D-37): two lines of muted words, and the theme choice. No rules, no columns. */
export default function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-300 flex-col gap-4 px-5 pt-24 pb-24 text-13 text-muted-foreground md:flex-row md:flex-wrap md:items-center md:justify-between md:px-8">
      <p>
        {BRAND.name} · times are in each event's local time · © <span className="font-mono">2026</span>
      </p>
      <nav aria-label="More" className="flex flex-wrap gap-x-4">
        {links.map((link) => (
          <Link key={link.to} to={link.to} className="inline-flex min-h-8 items-center hover:text-foreground pointer-coarse:min-h-11">
            {link.label}
          </Link>
        ))}
      </nav>
      <ThemeSwitch density="compact" hideLabel label="Appearance" />
    </footer>
  );
}
