import type { Ingester } from "./types.js";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

/**
 * Reconstruct lines from PDF text items (PDF has no inherent line breaks; we use
 * pdf.js's per-item `hasEOL` end-of-line flag), then strip running page headers
 * and footers so they don't land between references and create phantom entries.
 */
function stripRunningHeaders(pageLines: string[][]): string {
  const norm = (l: string) => l.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const nPages = pageLines.length;

  // Count how many pages each digit-normalized line appears on.
  const pageCount = new Map<string, number>();
  for (const lines of pageLines) {
    for (const key of new Set(lines.map(norm))) pageCount.set(key, (pageCount.get(key) ?? 0) + 1);
  }

  const isRunning = (l: string): boolean => {
    if (/\bpage\s+\d+\s+of\s+\d+\b/i.test(l)) return true; // explicit "Page 3 of 11"
    const seen = pageCount.get(norm(l)) ?? 0;
    return nPages >= 3 && seen >= Math.ceil(nPages * 0.5) && l.length < 140;
  };

  const kept: string[] = [];
  for (const lines of pageLines) {
    for (const l of lines) if (l.trim() && !isRunning(l)) kept.push(l);
  }
  return kept.join("\n");
}

export const pdfIngester: Ingester = {
  canHandle(filename: string, bytes: Uint8Array): boolean {
    if (!/\.pdf$/i.test(filename)) return false;
    return PDF_MAGIC.every((b, i) => bytes[i] === b);
  },
  async extractText(bytes: Uint8Array): Promise<string> {
    // Loaded on demand — the PDF stack is heavy and only needed for .pdf inputs.
    const { getDocumentProxy } = await import("unpdf");
    // pdf.js requires a plain Uint8Array (it rejects a Node Buffer).
    const data = bytes instanceof Buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes;
    // verbosity 0 = errors only. Real-world CV PDFs emit noisy font-parsing
    // warnings ("TT: undefined function: 21") that pdf.js recovers from on its
    // own; they are not ours to show and they bury the actual progress output.
    const pdf = await getDocumentProxy(data, { verbosity: 0 });
    const pageLines: string[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue; // skip marked-content markers
        line += item.str;
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = "";
        }
      }
      if (line.trim()) lines.push(line.trim());
      pageLines.push(lines);
    }
    return stripRunningHeaders(pageLines);
  },
};
