import type { CitationCheckResult } from "./quick-check.js";

/** One CSV row per reference, spreadsheet-friendly (opens directly in Excel).
 * Shared by the `--csv` flag and the interactive wizard. */
export function toCsv(citations: CitationCheckResult[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["key", "status", "retracted", "open_access", "doi", "pmid", "title", "notes", "source_ref"];
  const lines = [head.join(",")];
  for (const r of citations) {
    const openAccess = r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true;
    lines.push([
      r.key || "",
      r.status,
      r.retracted ? "yes" : "",
      openAccess ? "yes" : "",
      r.crossrefMatch?.doi ?? "",
      r.pubmedMatch?.pmid ?? "",
      r.title || "",
      r.warnings.join(" | "),
      r.sourceRef ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

export interface Counts {
  total: number;
  verified: number;
  partial: number;
  suspicious: number;
  notFound: number;
  checkFailed: number;
  retracted: number;
  openAccess: number;
}

export function count(citations: CitationCheckResult[]): Counts {
  const c: Counts = { total: citations.length, verified: 0, partial: 0, suspicious: 0, notFound: 0, checkFailed: 0, retracted: 0, openAccess: 0 };
  for (const r of citations) {
    if (r.status === "verified") c.verified++;
    else if (r.status === "partial_match") c.partial++;
    else if (r.status === "suspicious") c.suspicious++;
    else if (r.status === "not_found") c.notFound++;
    else if (r.status === "check_failed") c.checkFailed++;
    if (r.retracted) c.retracted++;
    if (r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true) c.openAccess++;
  }
  return c;
}
