/**
 * A minimal PDF 1.4 writer for the one-page event summary (D-21). No dependency and no headless
 * browser: text in the standard Helvetica fonts (not embedded, WinAnsi), filled rectangles for bars,
 * lines for the occupancy curve, A4 pages, uncompressed content streams.
 *
 * Text is written as PDF literal strings with `\`, `(` and `)` escaped and characters outside
 * Latin-1 replaced, so nothing in an event title or room name can break out of the string.
 */
const A4 = { w: 595.28, h: 841.89 };

function pdfText(s: string): string {
  const latin = s.normalize("NFKC").replace(/[–—]/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
  return `(${latin.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}
const f = (n: number) => (Math.round(n * 100) / 100).toString();

export class PdfPage {
  readonly ops: string[] = [];
  text(x: number, y: number, s: string, size = 10, bold = false) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${f(size)} Tf ${f(x)} ${f(A4.h - y)} Td ${pdfText(s)} Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, gray = 0.6) {
    this.ops.push(`${f(gray)} g ${f(x)} ${f(A4.h - y - h)} ${f(w)} ${f(h)} re f 0 g`);
  }
  line(points: [number, number][], width = 1) {
    if (points.length < 2) return;
    const [first, ...rest] = points;
    this.ops.push(`${f(width)} w ${f(first![0])} ${f(A4.h - first![1])} m ${rest.map(([x, y]) => `${f(x)} ${f(A4.h - y)} l`).join(" ")} S`);
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  readonly width = A4.w;
  readonly height = A4.h;
  page(): PdfPage {
    const p = new PdfPage();
    this.pages.push(p);
    return p;
  }

  toBuffer(title: string): Buffer {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object numbers
    const catalog = add("");
    const pagesObj = add("");
    const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const info = add(`<< /Title ${pdfText(title)} /Producer (Synan) >>`);
    const kids: number[] = [];
    for (const p of this.pages) {
      const content = Buffer.from(p.ops.join("\n"), "latin1");
      const stream = add(`<< /Length ${content.length} >>\nstream\n${content.toString("latin1")}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(A4.w)} ${f(A4.h)}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${stream} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
