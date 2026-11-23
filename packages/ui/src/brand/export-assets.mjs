/**
 * Writes the Synan logo files from ./fit.ts:
 *   ./assets/  — files to hand to other people (SVG + PNG): mark, horizontal and stacked
 *                lockups, each on dark / light / white / black; favicon; app icon.
 *   ./public/  — what the apps serve: favicon.svg, apple-touch-icon.png, icon-192.png,
 *                icon-512.png, icon-maskable-512.png.
 *
 * Run from this folder after changing the drawing:  node export-assets.mjs
 * (Node ≥ 23 imports the .ts file directly.) PNGs are rasterised here from the same
 * primitives — 4×4 supersampling, exact circle and seam tests — so no browser or
 * font is involved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { BRAND_COLOURS as C, contains, lockupDrawing, markDrawing, pathOf, stackedDrawing } from "./fit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "assets");
const pub = join(here, "public");
mkdirSync(assets, { recursive: true });

const TONES = {
  dark: { ground: C.ground, ink: C.ink, accent: C.accent },
  light: { ground: C.lightGround, ink: C.lightInk, accent: C.lightAccent },
  white: { ground: null, ink: "#FFFFFF", accent: "#FFFFFF" },
  black: { ground: null, ink: "#000000", accent: "#000000" },
};

/* --------------------------------------------------------------------- SVG */

function svgFile(drawing, tone, { pad = 0, title = "Synan", scale = 1, frame = null } = {}) {
  const w = frame ?? drawing.width + pad * 2;
  const h = frame ?? drawing.height + pad * 2;
  const ox = frame ? (frame - drawing.width * scale) / 2 : pad;
  const oy = frame ? (frame - drawing.height * scale) / 2 : pad;
  const bg = tone.ground ? `<rect width="${w}" height="${h}" fill="${tone.ground}"/>\n  ` : "";
  const paths = drawing.parts
    .map((part) => `<path d="${pathOf(part.shape)}" fill="${part.role === "accent" ? tone.accent : tone.ink}"/>`)
    .join("\n    ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${Math.round(w * 16)}" height="${Math.round(h * 16)}">\n  <title>${title}</title>\n  ${bg}<g transform="translate(${ox} ${oy}) scale(${scale})">\n    ${paths}\n  </g>\n</svg>\n`;
}

/* --------------------------------------------------------------------- PNG */

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Rasterise a drawing into a W×H RGBA PNG; the drawing is placed at (ox, oy) with `scale` px per unit. */
function pngFile(drawing, tone, W, H, ox, oy, scale) {
  const ink = hex(tone.ink);
  const accent = hex(tone.accent);
  const ground = tone.ground ? hex(tone.ground) : null;
  const S = 4;
  const rows = [];
  for (let py = 0; py < H; py++) {
    const row = Buffer.alloc(1 + W * 4);
    for (let px = 0; px < W; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S - ox) / scale;
          const y = (py + (sy + 0.5) / S - oy) / scale;
          let colour = null;
          for (const part of drawing.parts) {
            if (contains(part.shape, x, y)) colour = part.role === "accent" ? accent : ink;
          }
          if (colour) {
            r += colour[0]; g += colour[1]; b += colour[2]; a += 255;
          } else if (ground) {
            r += ground[0]; g += ground[1]; b += ground[2]; a += 255;
          }
        }
      }
      const n = S * S;
      const alpha = a / n;
      const k = alpha > 0 ? 255 / a : 0; // un-premultiply
      row.set([Math.round(r * k), Math.round(g * k), Math.round(b * k), Math.round(alpha)], 1 + px * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Icon: the mark (32-unit drawing) occupying `fraction` of a square tile of `px` pixels. */
function iconPng(px, fraction, small = false) {
  const drawing = markDrawing(small);
  // The mark's square is 24 of the 32 units; size it so the square is `fraction` of the tile.
  const scale = (px * fraction) / 24;
  const o = (px - 32 * scale) / 2;
  return pngFile(drawing, TONES.dark, px, px, o, o, scale);
}

/* ----------------------------------------------------------------- write */

const mark = markDrawing(false);
const horizontal = lockupDrawing(false);
const stacked = stackedDrawing();

for (const [name, tone] of Object.entries(TONES)) {
  writeFileSync(join(assets, `synan-mark-${name}.svg`), svgFile(mark, tone, { title: `Synan mark — ${name}` }));
  writeFileSync(join(assets, `synan-lockup-horizontal-${name}.svg`), svgFile(horizontal, tone, { pad: 8, title: `Synan — horizontal, ${name}` }));
  writeFileSync(join(assets, `synan-lockup-stacked-${name}.svg`), svgFile(stacked, tone, { pad: 10, title: `Synan — stacked, ${name}` }));
}
writeFileSync(join(assets, "synan-mark-dark-1024.png"), iconPng(1024, 0.75));
writeFileSync(
  join(assets, "synan-lockup-horizontal-dark.png"),
  pngFile(horizontal, TONES.dark, 1440, 520, (1440 - horizontal.width * 12) / 2, (520 - horizontal.height * 12) / 2, 12),
);
writeFileSync(
  join(assets, "synan-lockup-horizontal-light.png"),
  pngFile(horizontal, TONES.light, 1440, 520, (1440 - horizontal.width * 12) / 2, (520 - horizontal.height * 12) / 2, 12),
);

function tileSvg(fraction, small) {
  const d = markDrawing(small);
  const scale = (32 * fraction) / 24;
  const o = (32 - 32 * scale) / 2;
  const paths = d.parts.map((p) => `<path d="${pathOf(p.shape)}" fill="${p.role === "accent" ? C.accent : C.ink}"/>`).join("\n    ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n  <title>Synan</title>\n  <rect width="32" height="32" fill="${C.ground}"/>\n  <g transform="translate(${o.toFixed(3)} ${o.toFixed(3)}) scale(${scale.toFixed(4)})">\n    ${paths}\n  </g>\n</svg>\n`;
}
writeFileSync(join(assets, "synan-favicon.svg"), tileSvg(0.84, true));
writeFileSync(join(assets, "synan-app-icon.svg"), tileSvg(0.62, false));
writeFileSync(join(assets, "synan-app-icon-512.png"), iconPng(512, 0.62));
writeFileSync(join(assets, "synan-favicon-32.png"), iconPng(32, 0.84, true));

// What the apps serve.
writeFileSync(join(pub, "favicon.svg"), tileSvg(0.84, true));
writeFileSync(join(pub, "apple-touch-icon.png"), iconPng(180, 0.62));
writeFileSync(join(pub, "icon-192.png"), iconPng(192, 0.62));
writeFileSync(join(pub, "icon-512.png"), iconPng(512, 0.62));
// Maskable: platforms crop up to a circle of 80% — keep the mark inside the safe zone.
writeFileSync(join(pub, "icon-maskable-512.png"), iconPng(512, 0.5));

console.log("wrote assets and public icons");
