/**
 * Installable-app plumbing for the Attendee Portal and the Gate Scanner, hand-written
 * instead of vite-plugin-pwa so the lockfile does not change (D-17 names the plugin; this
 * is the stand-in until it is approved).
 *
 * BUILD-TIME ONLY. Imported by an app's vite.config.ts, never by app code. Plain TypeScript,
 * no Node or Vite imports, so it type-checks with the rest of packages/ui.
 *
 * It does three things:
 *   1. Serves and emits `<base>manifest.webmanifest` (name, icons from brand/public,
 *      theme colour, start URL, display mode) and links it from index.html.
 *   2. At build, emits `<base>sw.js`: a small service worker that precaches the app shell
 *      (index.html), every JS and CSS file of the build, the Latin font files and the icons.
 *      Navigations are answered from the cached shell first (so the pass opens offline and
 *      paints at once on a slow venue connection); hashed assets are cache-first.
 *   3. Nothing in development: the dev server never registers a worker (see
 *      registerServiceWorker in ./index.ts), so hot reload is untouched.
 */
import { BRAND, surfaceName, type Surface } from "../../brand/name";

export interface PwaOptions {
  surface: Surface;
  /** Vite `base`, with leading and trailing slash: "/" or "/scan/". */
  base: string;
  /** Path the installed app opens on, relative to `base` ("" = the base itself). */
  startPath: string;
  shortName: string;
  description: string;
  /** "any" leaves rotation to the device. */
  orientation?: "any" | "portrait";
  shortcuts?: { name: string; path: string }[];
}

/* Icons live in packages/ui/src/brand/public (each app's publicDir). */
const ICONS = [
  { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
];
const PUBLIC_FILES = ["favicon.svg", "icon-192.png", "apple-touch-icon.png", "manifest.webmanifest"];

export function manifestFor(options: PwaOptions) {
  const { base } = options;
  return {
    id: base,
    name: surfaceName(options.surface),
    short_name: options.shortName,
    description: options.description,
    lang: "en",
    dir: "ltr",
    start_url: base + options.startPath,
    scope: base,
    display: "standalone",
    orientation: options.orientation ?? "any",
    background_color: BRAND.themeColor,
    theme_color: BRAND.themeColor,
    icons: ICONS.map((icon) => ({ ...icon, src: base + icon.src })),
    shortcuts: options.shortcuts?.map((s) => ({ name: s.name, url: base + s.path, icons: [{ src: base + "icon-192.png", sizes: "192x192" }] })),
  };
}

/** A short stable hash, so the cache name changes exactly when the precache list does. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function workerSource(cacheName: string, prefix: string, base: string, precache: string[]): string {
  return `/* ${BRAND.name} service worker — generated at build by packages/ui/src/components/mobile/pwa-plugin.ts */
const CACHE = ${JSON.stringify(cacheName)};
const PREFIX = ${JSON.stringify(prefix)};
const BASE = ${JSON.stringify(base)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

// Keep this build and the one before it: a page still open on the previous build can
// then load its lazy chunks, online or not.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const ours = keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).sort();
        return Promise.all(ours.slice(0, -1).map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

async function fromCacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// The shell this worker was built with, so the page and its chunks always match.
// A newer build arrives as a new worker and takes over on the next navigation.
async function shell(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(BASE);
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch {
    return new Response("Offline, and this app was not saved on this device yet.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (request.mode === "navigate") {
    event.respondWith(shell(request));
    return;
  }
  if (url.pathname.startsWith(BASE + "assets/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(fromCacheFirst(request));
  }
});
`;
}

/** Only the Latin subsets are precached; other scripts load (and cache) on first use. */
function precached(fileName: string): boolean {
  if (/\.(js|css)$/.test(fileName)) return true;
  if (/\.woff2$/.test(fileName)) return /-latin-wght-/.test(fileName);
  return /\.(svg|png|webp)$/.test(fileName);
}

type Bundle = Record<string, { fileName: string }>;
interface EmitContext {
  emitFile(file: { type: "asset"; fileName: string; source: string }): void;
}
interface DevServer {
  middlewares: { use(fn: (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(body: string): void }, next: () => void) => void): void };
}

/** The Vite plugin. Add to `plugins` in vite.config.ts. */
export function pwa(options: PwaOptions) {
  const manifest = JSON.stringify(manifestFor(options), null, 2);
  const manifestPath = options.base + "manifest.webmanifest";
  return {
    name: "synan-pwa",
    transformIndexHtml() {
      return [
        { tag: "link", attrs: { rel: "manifest", href: manifestPath }, injectTo: "head" as const },
      ];
    },
    configureServer(server: DevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== manifestPath) return next();
        res.setHeader("content-type", "application/manifest+json");
        res.end(manifest);
      });
    },
    generateBundle(this: EmitContext, _options: unknown, bundle: Bundle) {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
      const files = Object.values(bundle)
        .map((item) => item.fileName)
        .filter(precached)
        .sort();
      const precache = [options.base, ...PUBLIC_FILES.map((f) => options.base + f), ...files.map((f) => options.base + f)];
      const prefix = `${BRAND.name.toLowerCase()}-${options.surface}-`;
      // Build time first, so caches sort oldest → newest on activate.
      const cacheName = `${prefix}${Date.now().toString(36)}-${hash(precache.join("\n"))}`;
      this.emitFile({ type: "asset", fileName: "sw.js", source: workerSource(cacheName, prefix, options.base, precache) });
    },
  };
}
