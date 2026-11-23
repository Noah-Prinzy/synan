/**
 * The product's name, in one place. The identity is provisional (a rename is coming):
 * every visible use of the name — page titles, index.html, aria labels, copy — reads
 * from here, so the rename is an edit to this file plus the two SVG components and the
 * icons in ./public.
 *
 * Plain TypeScript, no JSX: the apps' vite.config files import it to fill index.html.
 */
export const BRAND = {
  /** The product name as people say it. */
  name: "Synan",
  /** What each surface is called next to the name. */
  surface: {
    attendee: "",
    admin: "Command",
    scanner: "Gate Scanner",
  },
  /** Browser chrome colour; matches --background in theme.css. */
  themeColor: "#0a0a0a",
} as const;

export type Surface = keyof typeof BRAND.surface;

/** `My pass · Synan`, or just `Synan` for a surface's home. */
export function pageTitle(page?: string): string {
  return page ? `${page} · ${BRAND.name}` : BRAND.name;
}

/** `Synan Command`, `Synan Gate Scanner`, `Synan`. */
export function surfaceName(surface: Surface): string {
  const suffix = BRAND.surface[surface];
  return suffix ? `${BRAND.name} ${suffix}` : BRAND.name;
}

/** Placeholders the apps' index.html may use; filled at dev and build time. */
export function brandHtml(surface: Surface) {
  return {
    name: "brand-html",
    transformIndexHtml(html: string): string {
      return html
        .replaceAll("%BRAND_NAME%", BRAND.name)
        .replaceAll("%BRAND_SURFACE_NAME%", surfaceName(surface))
        .replaceAll("%BRAND_THEME_COLOR%", BRAND.themeColor);
    },
  };
}

/** Shared icons (favicon, app icons) for every app's `publicDir`. Path from an app root. */
export const BRAND_PUBLIC_DIR = "../../packages/ui/src/brand/public";
