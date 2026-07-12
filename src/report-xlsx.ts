import type { CitationCheckResult } from "./quick-check.js";
import { describeRef, type Analysis } from "./analysis.js";

const TEAL = "FF0D7D72";
const INK = "FF0E1A18";
const GREEN = "FF157347";
const RED = "FFB3261E";
const AMBER = "FFA4680F";
const GREY = "FF6B7B78";
const BAND = "FFF2F7F6";

const COLUMNS = ["Status", "Needs attention", "Retracted", "Open access", "DOI", "PMID", "Title", "What it means", "Source ref"];

function rowFor(r: CitationCheckResult): (string)[] {
  const d = describeRef(r);
  const oa = r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true;
  return [
    r.status,
    d.attention ? "YES" : "",
    r.retracted ? "yes" : "",
    oa ? "yes" : "",
    r.crossrefMatch?.doi ?? "",
    r.pubmedMatch?.pmid ?? "",
    r.title || "",
    d.reason,
    r.sourceRef ?? "",
  ];
}

function statusColor(status: string, retracted: boolean): string {
  if (retracted || status === "not_found") return RED;
  if (status === "verified") return GREEN;
  if (status === "check_failed") return GREY;
  return AMBER; // partial / suspicious
}

/** Write an .xlsx with three tabs: Summary (the analysis), All references (a
 * filterable Excel Table), and Needs a look (only the flagged rows). */
export async function writeXlsx(citations: CitationCheckResult[], a: Analysis, sourceName: string, outPath: string, narrative?: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "citecheck";

  // ── Summary tab ──────────────────────────────────────────────────────────
  const s = wb.addWorksheet("Summary", { properties: { defaultColWidth: 20 } });
  s.getColumn(1).width = 26;
  s.getColumn(2).width = 90;
  let row = 1;
  const put = (label: string, value: string, opts: { head?: boolean; color?: string } = {}) => {
    const c1 = s.getCell(row, 1);
    const c2 = s.getCell(row, 2);
    c1.value = label; c2.value = value;
    if (opts.head) { c1.font = { bold: true, size: 13, color: { argb: opts.color ?? INK } }; }
    else { c1.font = { bold: true, color: { argb: INK } }; c2.font = { color: { argb: opts.color ?? INK } }; c2.alignment = { wrapText: true, vertical: "top" }; }
    row++;
  };

  s.getCell(row, 1).value = "citecheck — reference-integrity report";
  s.getCell(row, 1).font = { bold: true, size: 16, color: { argb: TEAL } };
  row += 1;
  s.getCell(row, 1).value = sourceName;
  s.getCell(row, 1).font = { color: { argb: GREY }, italic: true };
  row += 2;

  put("Bottom line", a.headline, { color: INK });
  row += 1;

  if (narrative) {
    put("In plain terms", "", { head: true, color: TEAL });
    put("", narrative, { color: INK });
    s.getCell(row - 1, 2).alignment = { wrapText: true, vertical: "top" };
    s.getRow(row - 1).height = Math.min(160, 16 + Math.ceil(narrative.length / 90) * 15);
    row += 1;
  }

  put("The numbers", "", { head: true, color: TEAL });
  if (a.doiFound != null && a.doiTotal) put("DOI-bearing found", `${a.doiFound} of ${a.doiTotal}  (${a.doiFoundPct}%)`, { color: GREEN });
  put("Verified", String(a.buckets.clean + a.buckets.yearTolerated), { color: GREEN });
  put("Found, minor mismatch", String(a.buckets.yearMismatch + a.buckets.titleMismatch + a.buckets.review), { color: AMBER });
  put("Not found (check these)", String(a.buckets.notFound), { color: a.buckets.notFound ? RED : INK });
  put("Retracted", String(a.retracted.length), { color: a.retracted.length ? RED : INK });
  if (a.unreachableCount) put("Couldn't reach (re-run)", String(a.unreachableCount), { color: GREY });
  put("Open access", String(a.openAccess));
  put("Total checked", String(a.total));
  row += 1;

  put("What this means", "", { head: true, color: TEAL });
  for (const m of a.meaning) put("•", m);
  row += 1;

  put("What to do", "", { head: true, color: TEAL });
  a.actions.forEach((act, i) => put(String(i + 1) + ".", act, { color: INK }));

  // ── All references tab (filterable Excel Table) ─────────────────────────────
  addDataSheet(wb, "All references", COLUMNS, citations.map(rowFor), citations);

  // ── Needs a look tab (only the flagged rows) ────────────────────────────────
  const flagged = citations.filter((r) => r.retracted || r.status !== "verified");
  addDataSheet(wb, "Needs a look", COLUMNS, flagged.map(rowFor), flagged);

  await wb.xlsx.writeFile(outPath);

  // Helper that builds a filterable table sheet with colored status text.
  function addDataSheet(workbook: InstanceType<typeof ExcelJS.Workbook>, name: string, cols: string[], rows: string[][], src: CitationCheckResult[]) {
    const ws = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    if (!rows.length) {
      ws.getCell("A1").value = "(none)";
      return;
    }
    ws.addTable({
      name: name.replace(/[^A-Za-z0-9]/g, "") + "Tbl",
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleLight8", showRowStripes: true },
      columns: cols.map((c) => ({ name: c, filterButton: true })),
      rows,
    });
    // Column widths.
    const widths = [15, 15, 11, 12, 26, 12, 58, 64, 40];
    cols.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i] ?? 18));
    // Colored, bold status text per row (data starts at row 2).
    src.forEach((r, i) => {
      const cell = ws.getCell(i + 2, 1);
      cell.font = { bold: true, color: { argb: statusColor(r.status, r.retracted) } };
      ws.getCell(i + 2, 7).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(i + 2, 8).alignment = { wrapText: true, vertical: "top" };
    });
  }
}
