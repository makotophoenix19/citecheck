import type { CslItemData } from "./types.js";
import * as crossref from "./crossref.js";
import * as openalex from "./openalex.js";
import * as pubmed from "./pubmed.js";
import { checkByIssn, type DoajStatus } from "./doaj.js";

export type CheckVerdict =
  | "verified"
  | "partial_match"
  | "not_found"
  | "suspicious"
  | "check_failed";

export interface CitationCheckResult {
  key: string;
  title: string;
  status: CheckVerdict;
  crossrefMatch: {
    doi?: string;
    title?: string;
    titleSimilarity: number;
    authorOverlap: number;
    yearMatch: boolean;
  } | null;
  openalexMatch: {
    citedByCount?: number;
    isOa?: boolean;
    journalName?: string;
  } | null;
  /** Corroboration from PubMed (biomedical authority). Present when PubMed was
   * consulted and returned a candidate — optional so existing fixtures that
   * predate PubMed support still typecheck. */
  pubmedMatch?: {
    pmid?: string;
    title?: string;
    titleSimilarity: number;
    authorOverlap: number;
    yearMatch: boolean;
  } | null;
  journalStatus: DoajStatus;
  retracted: boolean;
  warnings: string[];
  /** Set on the document/free-text path: the raw reference string this verdict came from. */
  sourceRef?: string;
}

export interface QuickCheckResult {
  citations: CitationCheckResult[];
  checkedAt: string;
}

export function normalizeTitle(t: string | undefined): string {
  if (!t) return "";
  // NFKD decomposes accented letters into base + combining mark (ü -> u + ̈);
  // the Unicode-aware class then drops the combining marks (they are \p{M}, not
  // \p{L}/\p{N}) — folding diacritics for free while KEEPING non-Latin letters
  // (Cyrillic/Greek/CJK/Arabic). The ASCII-only /[^a-z0-9\s]/ this replaces
  // stripped every non-Latin character, leaving non-English titles with zero
  // tokens and wrongly flagged as fabricated. (Diacritic-DROPPED citation forms
  // like "Muller"/"Korper" now match "Müller"/"Körper"; digraph-EXPANDED forms
  // like "Mueller"/"Koerper" and non-decomposable letters like ß/Ł/Ø are out of
  // scope for this fold.)
  return t
    .normalize("NFKD")
    .toLowerCase()
    // Fold Latin/general diacritics (Combining Diacritical Marks block U+0300–U+036F
    // that NFKD split off) so "Müller" -> "muller". Targeted range, NOT a blanket
    // \p{M} strip, so combining marks that are semantic letters in their script
    // (Devanagari/Thai vowel signs, Arabic harakat) are preserved, not corrupted.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")  // keep letters, numbers, remaining marks; drop punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function extractFamilyNames(authors: { family?: string; given?: string }[] | undefined): string[] {
  if (!authors) return [];
  return authors.map((a) => (a.family ?? "").toLowerCase()).filter(Boolean);
}

export function authorOverlapScore(
  sourceAuthors: { family?: string; given?: string }[] | undefined,
  crossrefAuthors: crossref.CrossrefAuthor[] | undefined,
): number {
  const src = extractFamilyNames(sourceAuthors);
  const cr = (crossrefAuthors ?? []).map((a) => (a.family ?? "").toLowerCase()).filter(Boolean);
  if (src.length === 0 && cr.length === 0) return 1;
  if (src.length === 0 || cr.length === 0) return 0;
  let matches = 0;
  for (const name of src) if (cr.includes(name)) matches++;
  return matches / Math.max(src.length, cr.length);
}

function getCitationYear(item: CslItemData): number | undefined {
  const parts = item.issued?.["date-parts"]?.[0];
  if (!parts?.[0]) return undefined;
  return typeof parts[0] === "number" ? parts[0] : parseInt(String(parts[0]), 10) || undefined;
}

/** Ordering of confidence, worst→best, used to decide whether a second source
 * may UPGRADE a verdict (PubMed can rescue a Crossref miss, never downgrade a
 * Crossref hit). */
export const VERDICT_RANK: Record<CheckVerdict, number> = {
  check_failed: -1,
  not_found: 0,
  suspicious: 1,
  partial_match: 2,
  verified: 3,
};

/**
 * Map similarity signals to a verdict, shared by the Crossref and PubMed
 * scorers. `exactId` is true when the candidate came from an EXACT identifier
 * resolve (a DOI that resolved, or a PMID looked up directly) rather than a
 * fuzzy title search — an exact id names one specific work, so it verifies on
 * a year match plus modest author OR title corroboration. This is what fixes
 * real papers with long subtitles (e.g. a WHO classification "…: a summary")
 * landing in partial_match: their DOI resolves exactly, but symmetric title
 * Jaccard dips below 0.7 because the citation drops the subtitle.
 */
function scoreVerdict(
  titleSim: number,
  authOverlap: number,
  yearMatch: boolean,
  exactId: boolean,
): CheckVerdict {
  // Exact-identifier path: the record IS this work. Require a year match plus
  // either author OR title corroboration so a hallucinated DOI that happens to
  // resolve to some real (but unrelated) paper still fails to verify.
  if (exactId && yearMatch && (authOverlap >= 0.5 || titleSim >= 0.5)) return "verified";
  if (titleSim >= 0.7 && authOverlap >= 0.5 && yearMatch) return "verified";
  // Subtitle-drop tolerance: a citation that omits a candidate's post-colon
  // subtitle drags symmetric title Jaccard down; accept the lower bar only when
  // BOTH surname overlap AND the year independently corroborate.
  if (titleSim >= 0.5 && authOverlap >= 0.5 && yearMatch) return "verified";
  if (titleSim >= 0.4 || authOverlap >= 0.3) return "partial_match";
  return "suspicious";
}

/** Pull a PMID off a parsed reference: an explicit CSL/BibTeX/RIS field, or a
 * "PMID: 12345678" buried in a note. Returns digits only. */
function extractPmid(item: CslItemData): string | undefined {
  const rec = item as Record<string, unknown>;
  for (const key of ["PMID", "pmid", "PMCID"]) {
    const v = rec[key];
    if (typeof v === "number") return String(v);
    if (typeof v === "string" && /\d/.test(v)) return v.replace(/\D/g, "");
  }
  const note = typeof rec.note === "string" ? rec.note : "";
  const m = note.match(/PMID:?\s*(\d{4,9})/i);
  return m ? m[1] : undefined;
}

// Soft Crossref metadata warnings that become misleading once PubMed verifies
// the SAME reference against a better-matching record. Cleared on a PubMed
// upgrade; retraction and other hard warnings are never touched.
const CROSSREF_SOFT_WARNINGS = new Set([
  "Title differs from Crossref record.",
  "Publication year mismatch.",
  "Found a Crossref record but metadata does not match well.",
]);

async function checkSingle(item: CslItemData): Promise<CitationCheckResult> {
  const result: CitationCheckResult = {
    key: (item.id as string) ?? "",
    title: item.title ?? "",
    status: "not_found",
    crossrefMatch: null,
    openalexMatch: null,
    pubmedMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
  };

  const srcTitle = normalizeTitle(item.title);
  const srcYear = getCitationYear(item);
  let crWork: crossref.CrossrefWork | null = null;
  let matchedByDoi = false;
  let crossrefUnreachable = false;

  if (item.DOI) {
    try {
      crWork = await crossref.checkDoi(item.DOI);
      if (crWork) matchedByDoi = true;
    } catch {
      crossrefUnreachable = true;
    }
  }

  if (!crWork && !crossrefUnreachable && item.title) {
    try {
      const candidates = await crossref.searchByTitle(item.title);
      if (candidates.length > 0) {
        let bestSim = 0;
        for (const c of candidates) {
          const sim = jaccardSimilarity(srcTitle, normalizeTitle(c.title?.[0]));
          if (sim > bestSim) {
            bestSim = sim;
            crWork = c;
          }
        }
        if (bestSim < 0.3) crWork = null;
      }
    } catch {
      crossrefUnreachable = true;
    }
  }

  if (crWork) {
    const crTitle = normalizeTitle(crWork.title?.[0]);
    const titleSim = jaccardSimilarity(srcTitle, crTitle);
    const authOverlap = authorOverlapScore(item.author, crWork.author);
    const crYear = crossref.extractYear(crWork);
    const yearMatch = srcYear != null && crYear != null ? srcYear === crYear : true;

    result.crossrefMatch = {
      doi: crWork.DOI,
      title: crWork.title?.[0],
      titleSimilarity: Math.round(titleSim * 100) / 100,
      authorOverlap: Math.round(authOverlap * 100) / 100,
      yearMatch,
    };

    if (crossref.isRetracted(crWork)) {
      result.retracted = true;
      result.warnings.push("This work has been retracted.");
    }

    result.status = scoreVerdict(titleSim, authOverlap, yearMatch, matchedByDoi);
    if (result.status === "partial_match") {
      if (titleSim < 0.7) result.warnings.push("Title differs from Crossref record.");
      if (!yearMatch) result.warnings.push("Publication year mismatch.");
    } else if (result.status === "suspicious") {
      result.warnings.push("Found a Crossref record but metadata does not match well.");
    }

    const issns = crWork.ISSN ?? [];
    if (issns.length > 0) {
      result.journalStatus = await checkByIssn(issns[0]!);
    }
  }

  // PubMed corroboration — the authoritative biomedical index. It can only
  // UPGRADE a verdict, never downgrade a Crossref hit. Two triggers, chosen to
  // bound outbound traffic:
  //   • a cited PMID  → always verify the identifier directly (cheap, targeted);
  //   • a Crossref near-miss → escalate to a PubMed title search ONLY when
  //     Crossref already returned a candidate that didn't verify. A reference
  //     Crossref can't find at all (fabricated, or genuinely absent) does NOT
  //     trigger a blanket PubMed search — that would fire on every junk line of
  //     a large bibliography and hit NCBI's rate limit for no benefit.
  const srcPmid = extractPmid(item);
  const escalateToPubmed = crWork != null && result.status !== "verified";
  let pmWork: pubmed.PubmedWork | null = null;
  if (srcPmid != null || escalateToPubmed) {
    try {
      if (srcPmid != null) {
        pmWork = await pubmed.checkPmid(srcPmid);
      } else if (item.title) {
        const authorHint = (item.author ?? []).map((a) => a.family ?? "").filter(Boolean).join(" ");
        const cands = await pubmed.searchByText(`${item.title} ${authorHint}`.trim());
        let best = 0;
        for (const c of cands) {
          const sim = jaccardSimilarity(srcTitle, normalizeTitle(c.title));
          if (sim > best) {
            best = sim;
            pmWork = c;
          }
        }
        if (best < 0.3) pmWork = null;
      }
    } catch {
      // PubMed unreachable — Crossref may have already answered; leave as-is.
      pmWork = null;
    }

    if (pmWork) {
      const pmTitleSim = jaccardSimilarity(srcTitle, normalizeTitle(pmWork.title));
      const pmAuthOverlap = authorOverlapScore(item.author, pubmed.toCrossrefLike(pmWork).author);
      const pmYear = pubmed.extractYear(pmWork);
      const pmYearMatch = srcYear != null && pmYear != null ? srcYear === pmYear : true;
      const pmVerdict = scoreVerdict(pmTitleSim, pmAuthOverlap, pmYearMatch, srcPmid != null);

      result.pubmedMatch = {
        pmid: pmWork.pmid,
        title: pmWork.title,
        titleSimilarity: Math.round(pmTitleSim * 100) / 100,
        authorOverlap: Math.round(pmAuthOverlap * 100) / 100,
        yearMatch: pmYearMatch,
      };

      // Adopt only as an upgrade, and only to a genuine match (verified/partial)
      // so a weak PubMed hit can't launder a fabricated reference into a softer
      // verdict than it earned.
      if (
        (pmVerdict === "verified" || pmVerdict === "partial_match") &&
        VERDICT_RANK[pmVerdict] > VERDICT_RANK[result.status]
      ) {
        if (pmVerdict === "verified") {
          result.warnings = result.warnings.filter((w) => !CROSSREF_SOFT_WARNINGS.has(w));
        }
        result.status = pmVerdict;
        if (!result.title) result.title = pmWork.title;
      }

      // Retraction from PubMed — asserted only on a confident identity match so
      // we never flag the wrong paper.
      if (pmVerdict === "verified" && pubmed.isRetracted(pmWork) && !result.retracted) {
        result.retracted = true;
        result.warnings.push("This work has been retracted (PubMed).");
      }
    }
  }

  // Couldn't reach Crossref, and PubMed didn't rescue it — say so instead of
  // mislabelling a real reference as "not found".
  if (!crWork && crossrefUnreachable && result.status === "not_found") {
    result.status = "check_failed";
    result.warnings.push("Could not reach Crossref — re-run to check this reference.");
    return result;
  }

  // Enrich with OpenAlex (citation count, open-access + DOAJ signal). Use any
  // DOI we now hold, including one PubMed supplied for a DOI-less citation.
  const doiForOa = item.DOI || crWork?.DOI || pmWork?.doi;
  if (doiForOa && result.status !== "not_found") {
    const oaWork = await openalex.lookupByDoi(doiForOa);
    if (oaWork) {
      result.openalexMatch = {
        citedByCount: oaWork.cited_by_count,
        isOa: oaWork.is_oa,
        journalName: oaWork.primary_location?.source?.display_name,
      };
      if (oaWork.primary_location?.source?.is_in_doaj === true) {
        result.journalStatus = "doaj_listed";
      }
    }
  }

  return result;
}

/** Check every reference against Crossref, PubMed, OpenAlex and DOAJ. No API key needed. */
export async function quickCheck(items: CslItemData[]): Promise<QuickCheckResult> {
  const batchSize = 10;
  const results: CitationCheckResult[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(checkSingle));
    results.push(...batchResults);
  }

  return { citations: results, checkedAt: new Date().toISOString() };
}
