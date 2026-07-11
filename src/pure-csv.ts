import type { CslItemData, CslName } from "./types.js";

/**
 * Parse a Pure ("Research Output") CSV export directly into CSL items, so
 * `citecheck export.csv` works without a separate conversion step. Dedupes by
 * DOI (keeping legitimately duplicated titles that carry distinct DOIs, e.g. an
 * editorial published across several journals).
 */

/** Minimal RFC-4180 CSV reader: handles quoted fields with embedded commas,
 * newlines, and doubled ("") quotes. Returns rows of string fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n"); // normalize newlines
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  // Flush the final field/row unless the file ended on a clean newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseAuthors(af: string): CslName[] {
  if (!af) return [];
  const head = af.split(" / ")[0]!; // Pure appends "/ Title..." after the authors
  const out: CslName[] = [];
  for (const part of head.split(";")) {
    const p = part.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim();
    if (!p) continue;
    const comma = p.indexOf(",");
    if (comma >= 0) out.push({ family: p.slice(0, comma).trim(), given: p.slice(comma + 1).trim() });
    else out.push({ family: p }); // corporate/consortium author
  }
  return out;
}

/** Locate a column index by exact header, then case-insensitive substring. */
function columnIndex(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const exact = headers.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (exact >= 0) return exact;
  }
  for (const n of names) {
    const sub = headers.findIndex((h) => h.trim().toLowerCase().includes(n.toLowerCase()));
    if (sub >= 0) return sub;
  }
  return -1;
}

/** True when a CSV looks like a Pure research-output export (has a title or DOI
 * column). Used to decide whether a .csv can be parsed as a bibliography. */
export function looksLikePureCsv(text: string): boolean {
  const first = parseCsv(text.slice(0, 8192))[0];
  if (!first) return false;
  return columnIndex(first, "DOIs (Digital Object Identifiers)", "doi") >= 0 ||
    columnIndex(first, "Research Output Title", "title") >= 0;
}

export function parsePureCsv(text: string): CslItemData[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0]!;
  const iDoi = columnIndex(headers, "DOIs (Digital Object Identifiers)", "doi");
  const iTitle = columnIndex(headers, "Research Output Title", "title");
  const iYear = columnIndex(headers, "Year");
  const iVan = columnIndex(headers, "Vancouver format");
  const iAuth = columnIndex(headers, "Author format", "author");
  const iJournal = columnIndex(headers, "Journal Title", "journal");
  const cell = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");

  const seen = new Set<string>();
  const items: CslItemData[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const doi = cell(r, iDoi);
    const title = cell(r, iTitle);
    const van = cell(r, iVan);
    if (!doi && !title) continue;
    const key = doi ? doi.toLowerCase() : (van ? van.toLowerCase().slice(0, 80) : title.toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);

    const item: CslItemData = {
      id: `ref${i.toString().padStart(4, "0")}`,
      type: "article-journal",
      title: title || undefined,
      "container-title": cell(r, iJournal) || undefined,
    };
    if (doi) item.DOI = doi;
    const year = cell(r, iYear);
    if (/^\d{4}$/.test(year)) item.issued = { "date-parts": [[Number(year)]] };
    const authors = parseAuthors(cell(r, iAuth));
    if (authors.length) item.author = authors;
    items.push(item);
  }
  return items;
}
