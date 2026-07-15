import type { Analysis } from "./analysis.js";
import type { CvAnalysis } from "./analyze-cv.js";

/**
 * The privacy-bounded payload sent to the narrative generator (Claude, whether
 * called directly or via the Tailscale service). It carries ONLY aggregate
 * counts and the titles of flagged references — published, public metadata —
 * never the full bibliography and never the manuscript body.
 */
export interface ExplainInput {
  kind: "manuscript";
  verdict: string; // "PASS" | "REVIEW NEEDED" | "RE-RUN"
  headline: string;
  total: number;
  verified: number;
  minorMismatch: number;
  notFoundCount: number;
  retractedCount: number;
  unreachable: number;
  openAccess: number;
  doiFound?: number;
  doiTotal?: number;
  doiFoundPct?: number;
  retractedTitles: string[];
  notFoundTitles: string[];
  meaning: string[];
  actions: string[];
}

export function toExplainInput(a: Analysis): ExplainInput {
  return {
    kind: "manuscript",
    verdict: a.verdictLabel,
    headline: a.headline,
    total: a.total,
    verified: a.buckets.clean + a.buckets.yearTolerated,
    minorMismatch: a.buckets.yearMismatch + a.buckets.titleMismatch + a.buckets.review,
    notFoundCount: a.buckets.notFound,
    retractedCount: a.retracted.length,
    unreachable: a.buckets.unreachable,
    openAccess: a.openAccess,
    doiFound: a.doiFound,
    doiTotal: a.doiTotal,
    doiFoundPct: a.doiFoundPct,
    retractedTitles: a.retracted.map((f) => f.title).slice(0, 20),
    notFoundTitles: a.notFound.map((f) => f.title).slice(0, 30),
    meaning: a.meaning,
    actions: a.actions,
  };
}

/** CV-shaped payload — same privacy bound (aggregate counts + flagged/duplicate
 * titles, all public metadata; no contact details, no document body). */
export interface CvExplainInput {
  kind: "cv";
  verdict: string;
  verdictDetail: string;
  journalTotal: number;
  journalVerified: number;
  journalToConfirm: number;
  journalMismatch: number;
  bookChapters: number;
  presentations: number;
  retractedCount: number;
  firstAuthor: number;
  corresponding: number;
  openAccess: number;
  yearRange: [number, number] | null;
  toConfirmTitles: string[];
  retractedTitles: string[];
  duplicateTitles: { title: string; count: number }[];
}

export function toCvExplainInput(a: CvAnalysis): CvExplainInput {
  return {
    kind: "cv",
    verdict: a.verdictLabel,
    verdictDetail: a.verdictDetail,
    journalTotal: a.journal.total,
    journalVerified: a.journal.verified,
    journalToConfirm: a.journal.notFound.length,
    journalMismatch: a.journal.mismatch,
    bookChapters: a.book.total,
    presentations: a.presentation.total,
    retractedCount: a.retracted.length,
    firstAuthor: a.profile.firstAuthor,
    corresponding: a.profile.corresponding,
    openAccess: a.openAccess,
    yearRange: a.profile.yearRange,
    toConfirmTitles: a.journal.notFound.map((f) => f.title).slice(0, 20),
    retractedTitles: a.retracted.map((f) => f.title).slice(0, 20),
    duplicateTitles: a.profile.duplicates.slice(0, 15),
  };
}
