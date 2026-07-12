import type { Analysis } from "./analysis.js";

/**
 * The privacy-bounded payload sent to the narrative generator (Claude, whether
 * called directly or via the Tailscale service). It carries ONLY aggregate
 * counts and the titles of flagged references — published, public metadata —
 * never the full bibliography and never the manuscript body.
 */
export interface ExplainInput {
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
