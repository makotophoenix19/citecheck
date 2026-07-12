import type { CitationCheckResult } from "./quick-check.js";
import { YEAR_TOLERANCE_NOTE } from "./quick-check.js";
import type { CslItemData } from "./types.js";

/**
 * Turns raw per-reference verdicts into a plain-language analysis: what the
 * numbers are, what the "not verified" items actually mean (root-caused), and
 * what a person should do about them. Entirely deterministic — this is the
 * "so what / now what" layer, computed from rules, no AI.
 */

export type Category =
  | "clean" | "yearTolerated" | "yearMismatch" | "titleMismatch"
  | "review" | "notFound" | "unreachable";

export interface FlaggedRef {
  status: string;
  category: Category;
  title: string;
  reason: string;
  retracted: boolean;
  doi: string;
  pmid: string;
}

export interface Analysis {
  total: number;
  located: number;          // matched to a real record (not "not found" / unreachable)
  locatedPct: number;
  buckets: {
    clean: number;          // verified outright
    yearTolerated: number;  // verified despite a 1-year gap
    yearMismatch: number;   // found, year differs (benign)
    titleMismatch: number;  // found, title differs (benign-ish)
    review: number;         // found, other metadata mismatch
    notFound: number;       // NOT matched — the real to-check items
    unreachable: number;    // transient network/rate-limit — re-run
  };
  retracted: FlaggedRef[];
  notFound: FlaggedRef[];
  review: FlaggedRef[];     // all metadata-mismatch items (year/title/other)
  unreachableCount: number;
  openAccess: number;
  doiTotal?: number;
  doiFound?: number;
  doiFoundPct?: number;
  verdict: "pass" | "review" | "rerun"; // the at-a-glance stamp
  verdictLabel: string;                 // "PASS" | "REVIEW NEEDED" | "RE-RUN"
  verdictDetail: string;                // one line explaining the stamp
  headline: string;
  meaning: string[];
  actions: string[];
}

function reasonFor(r: CitationCheckResult): { category: Category; reason: string } {
  const w = r.warnings.join(" ").toLowerCase();
  if (r.status === "verified") {
    if (r.warnings.includes(YEAR_TOLERANCE_NOTE)) {
      return { category: "yearTolerated", reason: "Verified; publication year off by 1 (the routine online-ahead-of-print vs issue-date gap) — not a concern." };
    }
    return { category: "clean", reason: "Verified against a real record." };
  }
  if (r.status === "not_found") {
    return { category: "notFound", reason: "No matching record found — verify this reference exists (it may be fabricated, mistyped, or genuinely obscure)." };
  }
  if (r.status === "check_failed") {
    return { category: "unreachable", reason: "Couldn't reach the database (rate limit / network). Re-run to resolve — this is not a problem with the reference." };
  }
  // partial_match / suspicious → root-cause the mismatch
  if (/title differs|partially matches/.test(w)) {
    return { category: "titleMismatch", reason: "The paper was found, but the title differs from the record (often a truncated or variant title in the source) — usually harmless." };
  }
  if (/year/.test(w)) {
    return { category: "yearMismatch", reason: "The paper was found, but the publication year doesn't match (often the online-vs-issue date) — usually harmless." };
  }
  return { category: "review", reason: "A record was found but the metadata only partly matches — worth a quick glance." };
}

/** Per-reference plain-language classification: its category, a "what it means"
 * sentence, and whether it genuinely needs attention (retracted or not found).
 * Reused row-by-row by the Excel and report writers. */
export function describeRef(r: CitationCheckResult): { category: Category; reason: string; attention: boolean } {
  const { category, reason } = reasonFor(r);
  return {
    category,
    reason: r.retracted ? "This work has been RETRACTED. " + reason : reason,
    attention: r.retracted || category === "notFound",
  };
}

function toFlagged(r: CitationCheckResult): FlaggedRef {
  const { category, reason } = describeRef(r);
  return {
    status: r.status,
    category,
    title: r.title || r.sourceRef || r.key || "(untitled)",
    reason,
    retracted: r.retracted,
    doi: r.crossrefMatch?.doi ?? "",
    pmid: r.pubmedMatch?.pmid ?? "",
  };
}

/** Compute the analysis. Pass the parsed source items (when available) to also
 * report the DOI-bearing found rate — the single most persuasive number. */
export function analyze(citations: CitationCheckResult[], sourceItems?: CslItemData[]): Analysis {
  const buckets = { clean: 0, yearTolerated: 0, yearMismatch: 0, titleMismatch: 0, review: 0, notFound: 0, unreachable: 0 };
  const retracted: FlaggedRef[] = [];
  const notFound: FlaggedRef[] = [];
  const review: FlaggedRef[] = [];
  let openAccess = 0;

  for (const r of citations) {
    const f = toFlagged(r);
    buckets[f.category]++;
    if (r.retracted) retracted.push(f);
    if (f.category === "notFound") notFound.push(f);
    else if (f.category === "yearMismatch" || f.category === "titleMismatch" || f.category === "review") review.push(f);
    if (r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true) openAccess++;
  }

  const total = citations.length;
  const located = total - buckets.notFound - buckets.unreachable;
  const locatedPct = total ? Math.round((located / total) * 1000) / 10 : 0;

  // DOI-bearing found rate.
  let doiTotal: number | undefined;
  let doiFound: number | undefined;
  let doiFoundPct: number | undefined;
  if (sourceItems && sourceItems.length === total) {
    doiTotal = 0; doiFound = 0;
    for (let i = 0; i < total; i++) {
      if (!sourceItems[i]!.DOI) continue;
      doiTotal++;
      const st = citations[i]!.status;
      if (st !== "not_found" && st !== "check_failed") doiFound!++;
    }
    doiFoundPct = doiTotal ? Math.round((doiFound / doiTotal) * 1000) / 10 : undefined;
  }

  const verifiedTotal = buckets.clean + buckets.yearTolerated;
  const metadataMismatch = buckets.yearMismatch + buckets.titleMismatch + buckets.review;

  // ── verdict: the at-a-glance stamp ──
  const attentionCount = buckets.notFound + retracted.length;
  let verdict: Analysis["verdict"];
  let verdictLabel: string;
  let verdictDetail: string;
  if (attentionCount > 0) {
    verdict = "review";
    verdictLabel = "REVIEW NEEDED";
    verdictDetail = `${attentionCount} reference${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} a look${retracted.length ? ` (including ${retracted.length} retracted)` : ""} — see below.`;
  } else if (buckets.unreachable > 0) {
    verdict = "rerun";
    verdictLabel = "RE-RUN";
    verdictDetail = `${buckets.unreachable} reference${buckets.unreachable === 1 ? "" : "s"} couldn't be reached (network / rate limit). Re-run to finish — this is not a reference problem.`;
  } else {
    verdict = "pass";
    verdictLabel = "PASS";
    verdictDetail = "Every reference verified. Nothing needs attention.";
  }

  // ── narrative (deterministic) ──
  const headline =
    buckets.notFound === 0 && retracted.length === 0
      ? `All ${total} references were located. None flagged as fake.`
      : `${verifiedTotal} of ${total} verified; ${buckets.notFound} to check${retracted.length ? `, ${retracted.length} retracted` : ""}.`;

  const meaning: string[] = [];
  if (doiFound != null && doiTotal) meaning.push(`${doiFound} of ${doiTotal} references carrying a DOI were found (${doiFoundPct}%). This is the number that matters most.`);
  meaning.push(`${verifiedTotal} verified cleanly${buckets.yearTolerated ? `, ${buckets.yearTolerated} of them despite a harmless 1-year date difference` : ""}.`);
  if (metadataMismatch) meaning.push(`${metadataMismatch} were found but had a minor metadata mismatch (publication year or title formatting). The papers exist — no action needed unless you want tidy citations.`);
  if (buckets.notFound) meaning.push(`${buckets.notFound} could NOT be matched. These are the ones to check — they may be fabricated, mistyped, or genuinely obscure.`);
  if (retracted.length) meaning.push(`${retracted.length} cited paper${retracted.length === 1 ? " has" : "s have"} been RETRACTED. Review whether to keep ${retracted.length === 1 ? "it" : "them"}.`);
  if (buckets.unreachable) meaning.push(`${buckets.unreachable} couldn't be reached (rate limit / network) — re-run to resolve. Not a reference problem.`);
  if (openAccess) meaning.push(`${openAccess} of the references are open-access.`);

  const actions: string[] = [];
  if (retracted.length) actions.push(`Review the ${retracted.length} retracted paper${retracted.length === 1 ? "" : "s"} before submitting.`);
  if (buckets.notFound) actions.push(`Verify the ${buckets.notFound} unmatched reference${buckets.notFound === 1 ? "" : "s"} listed under "Needs a look".`);
  if (buckets.unreachable) actions.push(`Re-run to resolve the ${buckets.unreachable} reference${buckets.unreachable === 1 ? "" : "s"} that couldn't be reached.`);
  if (metadataMismatch && !buckets.notFound && !retracted.length) actions.push(`The metadata mismatches are cosmetic; no action required.`);
  if (!actions.length) actions.push(`No action needed — every reference was located and none were retracted.`);

  return {
    total, located, locatedPct, buckets,
    retracted, notFound, review,
    unreachableCount: buckets.unreachable, openAccess,
    doiTotal, doiFound, doiFoundPct,
    verdict, verdictLabel, verdictDetail,
    headline, meaning, actions,
  };
}
