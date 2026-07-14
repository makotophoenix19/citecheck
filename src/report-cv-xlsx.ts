import type { CvAnalysis } from "./analyze-cv.js";
import type { TypedCitation } from "./check-cv.js";
import { describeRef } from "./analysis.js";
import { refTitle } from "./cv-profile.js";

const TEAL = "FF0D7D72";
const INK = "FF0E1A18";
const GREEN = "FF157347";
const RED = "FFB3261E";
const AMBER = "FFA4680F";
const GREY = "FF6B7B78";

const COLUMNS = ["Type", "Status", "Needs attention", "Title", "DOI", "PMID", "What it means"];

function statusColor(status: string, retracted: boolean): string {
  if (retracted || status === "not_found") return RED;
  if (status === "verified") return GREEN;
  if (status === "check_failed") return GREY;
  return AMBER; // partial / suspicious
}

function rowFor(tc: TypedCitation): string[] {
  const r = tc.citation;
  const d = describeRef(r);
  // In CV mode only a journal not-found (or any retraction) is a real problem.
  const attention = r.retracted || (tc.type === "journal" && r.status === "not_found");
  return [
    tc.type,
    r.status,
    attention ? "YES" : "",
    refTitle(r.title, r.sourceRef || ""),
    r.crossrefMatch?.doi ?? "",
    r.pubmedMatch?.pmid ?? "",
    d.reason,
  ];
}

/** Write a CV publications workbook: a Summary tab (verdict + profile), a
 * filterable All-references table (with a Type column so you can filter journal
 * vs presentation), and a Possible-duplicates tab when any exist. */
export async function writeCvXlsx(a: CvAnalysis, refs: TypedCitation[], sourceName: string, outPath: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "citecheck";

  // ── Summary ────────────────────────────────────────────────────────────────
  const s = wb.addWorksheet("Summary");
  s.getColumn(1).width = 26;
  s.getColumn(2).width = 80;
  let row = 1;
  const put = (label: string, value: string, opts: { head?: boolean; color?: string } = {}) => {
    const c1 = s.getCell(row, 1);
    const c2 = s.getCell(row, 2);
    c1.value = label; c2.value = value;
    if (opts.head) c1.font = { bold: true, size: 13, color: { argb: opts.color ?? INK } };
    else { c1.font = { bold: true, color: { argb: INK } }; c2.font = { color: { argb: opts.color ?? INK } }; c2.alignment = { wrapText: true, vertical: "top" }; }
    row++;
  };

  s.getCell(row, 1).value = "citecheck — CV publications report";
  s.getCell(row, 1).font = { bold: true, size: 16, color: { argb: TEAL } };
  row++;
  s.getCell(row, 1).value = sourceName;
  s.getCell(row, 1).font = { color: { argb: GREY }, italic: true };
  row += 2;

  const verdictFill = ({ pass: GREEN, review: RED, rerun: GREY } as const)[a.verdict];
  const vc = s.getCell(row, 1);
  vc.value = a.verdictLabel;
  vc.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: verdictFill } };
  vc.alignment = { horizontal: "center", vertical: "middle" };
  const vd = s.getCell(row, 2);
  vd.value = a.verdictDetail;
  vd.font = { bold: true, color: { argb: INK } };
  vd.alignment = { wrapText: true, vertical: "middle" };
  s.getRow(row).height = 26;
  row += 2;

  put("The numbers", "", { head: true, color: TEAL });
  put("Journal articles", `${a.journal.total}  (${a.journal.verified} verified, ${a.journal.notFound.length} to confirm, ${a.journal.mismatch} minor mismatch)`, { color: INK });
  put("Book chapters", String(a.book.total));
  put("Presentations", String(a.presentation.total));
  if (a.retracted.length) put("Retracted", String(a.retracted.length), { color: RED });
  row++;

  put("Publication profile", "", { head: true, color: TEAL });
  if (a.profile.yearRange) put("Publication span", `${a.profile.yearRange[0]}–${a.profile.yearRange[1]}`);
  if (a.profile.firstAuthor) put("First-author articles", String(a.profile.firstAuthor));
  if (a.profile.corresponding) put("Corresponding-author", String(a.profile.corresponding));
  if (a.openAccess) put("Open-access", String(a.openAccess));

  if (a.profile.duplicates.length) {
    row++;
    put("Possible duplicates", "", { head: true, color: AMBER });
    for (const d of a.profile.duplicates) put(`listed ${d.count}×`, d.title, { color: AMBER });
  }

  // ── All references (filterable table) ───────────────────────────────────────
  const ws = wb.addWorksheet("All references", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addTable({
    name: "CvReferences",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleLight8", showRowStripes: true },
    columns: COLUMNS.map((c) => ({ name: c, filterButton: true })),
    rows: refs.map(rowFor),
  });
  const widths = [14, 15, 15, 62, 26, 12, 64];
  COLUMNS.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i] ?? 18));
  refs.forEach((tc, i) => {
    ws.getCell(i + 2, 2).font = { bold: true, color: { argb: statusColor(tc.citation.status, tc.citation.retracted) } };
    ws.getCell(i + 2, 4).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(i + 2, 7).alignment = { wrapText: true, vertical: "top" };
  });

  await wb.xlsx.writeFile(outPath);
}
