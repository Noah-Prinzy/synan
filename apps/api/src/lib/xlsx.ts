/**
 * A minimal streaming XLSX (SpreadsheetML) writer on fflate's streaming zip (D-21).
 *
 * Why this and not a workbook library: fflate is one small dependency-free package, and rows are
 * deflated into the archive as they are written, so no workbook model is held in memory. We emit only
 * what reports need: typed numbers, dates (numFmt 22), text, a bold frozen header row, column widths.
 *
 * Formula injection: no cell is ever written as a formula. Text is always an inline string
 * (t="inlineStr"), so `=HYPERLINK(...)` in a name is stored and displayed as text, never evaluated.
 */
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type XCell = string | number | Date | boolean | null | undefined;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** Excel serial date (1900 system), UTC. */
const serial = (d: Date) => d.getTime() / 86_400_000 + 25569;
const enc = new TextEncoder();

/** Styles: 0 default, 1 bold header, 2 date-time, 3 bold number (totals). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`;

export class XlsxWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private readonly sheets: string[] = [];
  private done!: Promise<Buffer>;
  private current: { file: ZipDeflate; row: number; width: number[] } | null = null;

  constructor() {
    let resolve!: (b: Buffer) => void;
    let reject!: (e: Error) => void;
    this.done = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    this.zip = new Zip((err, data, final) => {
      if (err) return reject(err);
      this.chunks.push(data);
      if (final) resolve(Buffer.concat(this.chunks));
    });
  }

  private static(name: string, text: string) {
    const f = new ZipPassThrough(name);
    this.zip.add(f);
    f.push(enc.encode(text), true);
  }

  /** Start a sheet with a bold, frozen header row and column widths. */
  sheet(name: string, header: string[], widths?: number[]) {
    this.endSheet();
    const safe = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    this.sheets.push(safe);
    const file = new ZipDeflate(`xl/worksheets/sheet${this.sheets.length}.xml`, { level: 6 });
    this.zip.add(file);
    const w = widths ?? header.map((h) => Math.max(10, Math.min(40, h.length + 4)));
    this.current = { file, row: 0, width: w };
    const cols = w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join("");
    file.push(enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<cols>${cols}</cols><sheetData>`,
    ));
    this.row(header, 1);
  }

  /** Append a row (style 3 = bold totals). Strings are always text, never formulas. */
  row(cells: readonly XCell[], style = 0) {
    const s = this.current;
    if (!s) throw new Error("no sheet");
    const r = ++s.row;
    const xml = cells
      .map((v, i) => {
        const ref = `${colName(i)}${r}`;
        if (v === null || v === undefined || v === "") return "";
        if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>` : "";
        if (v instanceof Date) return `<c r="${ref}" s="2"><v>${serial(v)}</v></c>`;
        if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      })
      .join("");
    s.file.push(enc.encode(`<row r="${r}">${xml}</row>`));
  }

  private endSheet() {
    if (!this.current) return;
    this.current.file.push(enc.encode(`</sheetData></worksheet>`), true);
    this.current = null;
  }

  async finish(): Promise<Buffer> {
    this.endSheet();
    const n = this.sheets.length;
    this.static("[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      Array.from({ length: n }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`);
    this.static("_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    this.static("xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      this.sheets.map((s, i) => `<sheet name="${esc(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`);
    this.static("xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    this.static("xl/styles.xml", STYLES);
    this.zip.end();
    return this.done;
  }
}
