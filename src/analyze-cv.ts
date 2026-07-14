import { describeRef } from "./analysis.js";
import { detectOwner, isFirstAuthor, isCorresponding, findDuplicates, refTitle } from "./cv-profile.js";
import type { TypedCitation } from "./check-cv.js";

/**
 * CV mode, part 3: the type-aware verdict. The PASS / REVIEW NEEDED stamp is
 * computed from the JOURNAL bucket only (plus retractions across everything).
 * Book chapters and conference presentations are reported for information but
 * never hard-flagged — a conference abstract that isn't in Crossref is normal,
 * not a problem. This is what stops the over-flagging plain document mode has.
 */

export interface CvFlag {
  title: string;
  reason: string;
  retracted: boolean;
}

export interface CvAnalysis {
  total: number;
  journal: { total: number; verified: number; mismatch: number; unreachable: number; notFound: CvFlag[] };
  book: { total: number; found: number; notIndexed: number };
  presentation: { total: number };
  retracted: CvFlag[]; // across all types — retractions always matter
  openAccess: number;
  verdict: "pass" | "review" | "rerun";
  verdictLabel: string;
  verdictDetail: string;
  profile: {
    articles: number;
    bookChapters: number;
    presentations: number;
    yearRange: [number, number] | null;
    owner?: string;
    firstAuthor: number; // journal articles where the CV owner is first author
    corresponding: number; // references marked "corresponding author"
    duplicates: { title: string; count: number }[];
  };
}

function flag(tc: TypedCitation): CvFlag {
  const r = tc.citation;
  return {
    title: r.title || r.sourceRef || r.key || "(untitled)",
    reason: describeRef(r).reason,
    retracted: r.retracted,
  };
}

function yearsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = Number(m[0]);
    if (y >= 1950 && y <= 2100) out.push(y);
  }
  return out;
}

export function analyzeCv(typed: TypedCitation[]): CvAnalysis {
  const journal = { total: 0, verified: 0, mismatch: 0, unreachable: 0, notFound: [] as CvFlag[] };
  const book = { total: 0, found: 0, notIndexed: 0 };
  const presentation = { total: 0 };
  const retracted: CvFlag[] = [];
  let openAccess = 0;
  const years: number[] = [];

  // Publication-profile signals.
  const owner = detectOwner(typed.map((tc) => tc.citation.sourceRef || ""));
  let firstAuthor = 0;
  let corresponding = 0;
  const titles: string[] = [];

  for (const tc of typed) {
    const r = tc.citation;
    if (r.retracted) retracted.push(flag(tc));
    if (r.journalStatus === "doaj_listed" || r.openalexMatch?.isOa === true) openAccess++;
    years.push(...yearsIn(r.sourceRef || r.title || ""));
    if (owner && tc.type === "journal" && isFirstAuthor(r.sourceRef || "", owner)) firstAuthor++;
    if (isCorresponding(r.sourceRef || "")) corresponding++;
    titles.push(refTitle(r.title, r.sourceRef || ""));

    if (tc.type === "journal" || tc.type === "unknown") {
      journal.total++;
      if (r.status === "verified") journal.verified++;
      else if (r.status === "not_found") journal.notFound.push(flag(tc));
      else if (r.status === "check_failed") journal.unreachable++;
      else journal.mismatch++; // partial_match / suspicious — found, minor mismatch
    } else if (tc.type === "book") {
      book.total++;
      if (r.status === "not_found" || r.status === "check_failed") book.notIndexed++;
      else book.found++;
    } else {
      presentation.total++;
    }
  }

  const attention = journal.notFound.length + retracted.length;
  let verdict: CvAnalysis["verdict"];
  let verdictLabel: string;
  let verdictDetail: string;
  const noted: string[] = [];
  if (presentation.total) noted.push(`${presentation.total} presentation${presentation.total === 1 ? "" : "s"} noted separately`);
  if (book.total) noted.push(`${book.total} book chapter${book.total === 1 ? "" : "s"}`);
  const notedStr = noted.length ? ` (${noted.join(", ")} — not database-checkable)` : "";

  if (attention > 0) {
    verdict = "review";
    verdictLabel = "REVIEW NEEDED";
    const parts: string[] = [];
    if (journal.notFound.length) parts.push(`${journal.notFound.length} journal article${journal.notFound.length === 1 ? "" : "s"} to confirm`);
    if (retracted.length) parts.push(`${retracted.length} retracted`);
    verdictDetail = parts.join(", ") + notedStr;
  } else if (journal.unreachable > 0) {
    verdict = "rerun";
    verdictLabel = "RE-RUN";
    verdictDetail = `${journal.unreachable} journal article${journal.unreachable === 1 ? "" : "s"} couldn't be reached — re-run to finish.`;
  } else {
    verdict = "pass";
    verdictLabel = "PASS";
    verdictDetail = `All ${journal.total} journal article${journal.total === 1 ? "" : "s"} verified.${notedStr}`;
  }

  return {
    total: typed.length,
    journal, book, presentation, retracted, openAccess,
    verdict, verdictLabel, verdictDetail,
    profile: {
      articles: journal.total,
      bookChapters: book.total,
      presentations: presentation.total,
      yearRange: years.length ? [Math.min(...years), Math.max(...years)] : null,
      owner,
      firstAuthor,
      corresponding,
      duplicates: findDuplicates(titles),
    },
  };
}
