import * as crossref from "../crossref.js";
import * as openalex from "../openalex.js";
import * as pubmed from "../pubmed.js";
import { checkByIssn } from "../doaj.js";
import { normalizeTitle, VERDICT_RANK, type CheckVerdict, type CitationCheckResult } from "../quick-check.js";

/** Common low-signal words (EN + a few DE) dropped before measuring title containment. */
const STOPWORDS = new Set(
  "a an the of and or in on for to with from by as at is are be this that into via using its their de der die das und von zur zum".split(
    " ",
  ),
);

/** Publication-TYPE words that are almost never distinctive on their own. A
 * candidate title made entirely of these ("Original research article", "Case
 * report") carries no identifying signal, so matching them must NOT count toward
 * the anti-inversion distinctiveness floor. These are post-normalizeTitle,
 * lowercase forms. Deliberately TYPE words only — content-bearing words (study,
 * analysis, effects, results, role, impact, survey) are excluded because they
 * can legitimately distinguish a real title. */
const GENERIC_TITLE_TERMS = new Set(
  "case report reports original research article articles review reviews editorial editorials letter letters correspondence communication communications commentary comment comments erratum corrigendum retraction introduction preface foreword abstract note notes reply response addendum proceedings supplement chapter book poster news overview".split(
    " ",
  ),
);

export interface Containment {
  /** Fraction of the candidate's title content-words present in the raw reference. */
  titleContainment: number;
  /** Absolute count of candidate title content-words present in the raw reference. */
  matchedTitleTokens: number;
  /** Count of matched title content-words that are NOT generic publication-TYPE
   * words. A count-only floor can't tell a distinctive short title from a generic
   * one ("Original research article" = 3 generic tokens); this counts only the
   * tokens that actually carry identifying signal. */
  distinctiveMatchedTokens: number;
  /** Total count of candidate title content-words (after stopword/digit filtering). */
  titleTokenCount: number;
  /** Candidate's first-author surname present in the raw reference. */
  surnameHit: boolean;
  /** Candidate's publication year present in the raw reference. */
  yearHit: boolean;
  /** A DOI in the raw reference exactly matches the candidate's DOI. */
  doiHit: boolean;
}

/** Matches a DOI anywhere in free text. The path component runs until whitespace
 * or a quote/angle-bracket so a trailing `.`/`,`/`)` stays attached and is
 * stripped separately (DOIs may legitimately contain `.` and `)`). */
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/i;

/** Lowercase a DOI and strip a trailing run of sentence punctuation. */
function normDoi(doi: string): string {
  return doi.toLowerCase().replace(/[.,;:)\]]+$/, "");
}

/** Measure how much of the candidate's identifying tokens appear in `raw`. Pure. */
export function computeContainment(raw: string, candidate: crossref.CrossrefWork): Containment {
  const rawNorm = normalizeTitle(raw);
  const rawTokens = new Set(rawNorm.split(" ").filter(Boolean));

  const titleTokens = [
    ...new Set(
      normalizeTitle(candidate.title?.[0])
        .split(" ")
        // Drop stopwords AND pure-digit tokens: a number in a candidate title
        // (e.g. a year in "Global health 2020") would otherwise count as a
        // title-content token and be auto-satisfied by the reference's own
        // publication year/volume/page — inflating containment and letting a
        // fabricated ref clear the anti-inversion guard. A number must
        // corroborate via yearHit only, not double as a title-content token.
        .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
    ),
  ];
  let hit = 0;
  let distinctiveHit = 0;
  for (const t of titleTokens) {
    if (rawTokens.has(t)) {
      hit++;
      if (!GENERIC_TITLE_TERMS.has(t)) distinctiveHit++;
    }
  }
  const titleContainment = titleTokens.length === 0 ? 0 : hit / titleTokens.length;

  // Fold the surname through the SAME normalizer as the raw reference (rawTokens
  // also comes from normalizeTitle), so a diacritic-dropped citation ("Muller")
  // matches the candidate's accented form ("Müller"): NFKD folds ü -> u on both
  // sides. The old [^a-z0-9] strip DELETED accented letters ("Müller" -> "mller")
  // and broke the match, demoting faithful non-English citations.
  const surnameParts = normalizeTitle(candidate.author?.[0]?.family ?? "")
    .split(" ")
    .filter(Boolean);
  const surnameHit = surnameParts.length > 0 && surnameParts.every((p) => rawTokens.has(p));

  const year = crossref.extractYear(candidate);
  // Blank out any DOI substring BEFORE the year test. A DOI's path component can
  // contain a 4-digit run that coincides with the candidate year (e.g.
  // `doi:10.1234/2019.x`), which the standalone-date regex below would otherwise
  // accept as a spurious yearHit — manufacturing a corroborating signal from an
  // identifier, not a date. Replacing the DOI with a space leaves real date forms
  // (`(2019).`, `1953;171:`, ` 1953 `) untouched.
  const rawForYear = raw.replace(/10\.\d{4,9}\/[^\s]+/gi, " ");
  // Accept the candidate year only as a STANDALONE 4-digit run, never as the
  // endpoint of a numeric range. The lookbehind/lookahead exclude an adjacent
  // digit AND the dash family (ASCII hyphen plus U+2012–U+2015: figure/en/em
  // dash, horizontal bar — the en dash is the typographically standard range
  // separator in real bibliographies). Without this, a page range
  // (`pp. 2015–2019`, `1949-1953`) or a volume:page span (`171:1953-1960`)
  // would manufacture a spurious yearHit from a coincidental 4-digit run,
  // corroborating a weak title overlap and flipping a fabricated reference from
  // partial_match to "verified". Real date forms — `(2019).`, `1953;171:`,
  // `1905.`, ` 1953 ` — are unaffected.
  const yearHit =
    year != null &&
    new RegExp(`(?<![\\d\\-\\u2012-\\u2015])${year}(?![\\d\\-\\u2012-\\u2015])`).test(rawForYear);

  // An exact DOI match is the strongest identity signal a free-text reference can
  // carry: it points at one specific record. Extract the first DOI from the raw
  // reference, normalize both sides (lowercase, strip a `https?://(dx.)?doi.org/`
  // prefix off the candidate, strip trailing sentence punctuation off the raw),
  // and set doiHit on an exact match.
  const rawDoiMatch = raw.match(DOI_RE);
  const candidateDoi = candidate.DOI
    ? normDoi(candidate.DOI.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""))
    : "";
  const doiHit = rawDoiMatch != null && candidateDoi !== "" && normDoi(rawDoiMatch[0]) === candidateDoi;

  return {
    titleContainment: Math.round(titleContainment * 100) / 100,
    matchedTitleTokens: hit,
    distinctiveMatchedTokens: distinctiveHit,
    titleTokenCount: titleTokens.length,
    surnameHit,
    yearHit,
    doiHit,
  };
}

/**
 * Map containment to a verdict. Thresholds are a calibrated starting point; the
 * binding principle is that containment must be high enough to REJECT Crossref's
 * weak best-guesses (so a fabricated reference resolves to not_found).
 */
export function verdictFor(c: Containment, candidateHasYear: boolean): CheckVerdict {
  const yearOk = c.yearHit || !candidateHasYear;
  // An exact DOI match to the record Crossref returned is conclusive: a DOI names
  // one specific work, so a surname hit on top of it leaves no plausible room for
  // a coincidental collision. This short-circuits ahead of the title checks.
  if (c.doiHit && c.surnameHit) return "verified";
  // Title-only path. A short/generic candidate title ("Case report", "Original
  // research article", "Book review") saturates titleContainment to 1.0 on a few
  // shared publication-TYPE words that any fabricated reference might
  // coincidentally include — so surname + year is NOT enough to verify against
  // such a candidate. A bare matched-token COUNT can't tell a distinctive short
  // title from a generic one: "Original research article" is 3 matched tokens but
  // zero identifying signal. The floor is therefore on DISTINCTIVE matched tokens
  // (those NOT in GENERIC_TITLE_TERMS). Requiring at least TWO distinctive tokens
  // keeps genuine short titles verified — "Zur Elektrodynamik bewegter Körper"
  // has 3 distinctive tokens (zur is a stopword), Vaswani/Watson have 4 — while
  // rejecting all-generic fabrications ("Case report", "Original research
  // article" both have 0 distinctive tokens, so they cap at partial_match).
  const enoughTitleTokens = c.distinctiveMatchedTokens >= 2;
  if (enoughTitleTokens && c.titleContainment >= 0.7 && c.surnameHit && yearOk) return "verified";
  // Subtitle-drop tolerance: citations routinely omit a candidate's post-colon
  // subtitle, which drags titleContainment below 0.7 even for faithful refs
  // (e.g. Watson 1953 lands at ~0.67). Accept a lower bar ONLY when BOTH the
  // surname AND an explicit year hit independently corroborate — that double
  // signal is what keeps a fabricated ref's weak title overlap from verifying.
  if (enoughTitleTokens && c.titleContainment >= 0.5 && c.surnameHit && c.yearHit) return "verified";
  if (c.titleContainment >= 0.45) return "partial_match";
  return "not_found";
}

/** A PMID cited inline, e.g. "PMID: 28170064" or "PubMed ID 28170064". */
const PMID_RE = /\bpmid:?\s*(\d{4,9})\b|\bpubmed(?:\s*id)?:?\s*(\d{4,9})\b/i;

export function extractPmidFromText(raw: string): string | undefined {
  const m = raw.match(PMID_RE);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** Enrich a result in place with OpenAlex citation-count / open-access / DOAJ
 * signal for a known DOI. Never throws. */
async function enrichOpenAlex(result: CitationCheckResult, doi: string): Promise<void> {
  const oa = await openalex.lookupByDoi(doi);
  if (!oa) return;
  result.openalexMatch = {
    citedByCount: oa.cited_by_count,
    isOa: oa.is_oa,
    journalName: oa.primary_location?.source?.display_name,
  };
  if (oa.primary_location?.source?.is_in_doaj === true) {
    result.journalStatus = "doaj_listed";
  }
}

/** Check a single free-text reference string against Crossref, then PubMed as a
 * biomedical rescue. Produces a CitationCheckResult. */
export async function checkFreeTextRef(raw: string): Promise<CitationCheckResult> {
  const result: CitationCheckResult = {
    key: "",
    title: "",
    status: "not_found",
    crossrefMatch: null,
    openalexMatch: null,
    pubmedMatch: null,
    journalStatus: "unknown",
    retracted: false,
    warnings: [],
    sourceRef: raw,
  };

  const pmid = extractPmidFromText(raw);

  // --- Crossref pass ---
  let candidates: crossref.CrossrefWork[] = [];
  let crossrefUnreachable = false;
  try {
    candidates = await crossref.searchByBibliographic(raw, 5);
  } catch {
    crossrefUnreachable = true;
  }

  // Containment of the best Crossref candidate, kept for the not_found messaging
  // (a zero-token candidate title signals a tokenizer limit, not fabrication).
  let crCont: Containment | null = null;
  if (candidates.length > 0) {
    const candidate = candidates[0]!;
    crCont = computeContainment(raw, candidate);
    const candidateHasYear = crossref.extractYear(candidate) != null;
    const crVerdict = verdictFor(crCont, candidateHasYear);
    if (crVerdict !== "not_found") {
      result.status = crVerdict;
      result.title = candidate.title?.[0] ?? "";
      result.crossrefMatch = {
        doi: candidate.DOI,
        title: candidate.title?.[0],
        titleSimilarity: crCont.titleContainment,
        authorOverlap: crCont.surnameHit ? 1 : 0,
        yearMatch: crCont.yearHit,
      };
      if (crVerdict === "partial_match") {
        result.warnings.push("Reference text only partially matches the closest Crossref record.");
        if (!crCont.yearHit && candidateHasYear) {
          result.warnings.push("Publication year not found in the reference text.");
        }
      }
      if (crossref.isRetracted(candidate)) {
        result.retracted = true;
        result.warnings.push("This work has been retracted.");
      }
      const issns = candidate.ISSN ?? [];
      if (issns.length > 0) result.journalStatus = await checkByIssn(issns[0]!);
      if (candidate.DOI) await enrichOpenAlex(result, candidate.DOI);
    }
  }

  // --- PubMed rescue --- upgrades only. A cited PMID is always verified
  // directly (cheap). A PubMed title search is an escalation reserved for a
  // Crossref NEAR-MISS: it fires only when Crossref returned a candidate that
  // didn't verify — never on a reference Crossref couldn't find at all, so a
  // large bibliography of junk/fabricated lines can't fan out into hundreds of
  // rate-limited NCBI searches.
  const escalateToPubmed = candidates.length > 0 && result.status !== "verified";
  if (pmid || escalateToPubmed) {
    let pmWork: pubmed.PubmedWork | null = null;
    try {
      if (pmid) pmWork = await pubmed.checkPmid(pmid);
      else if (escalateToPubmed) pmWork = await bestPubmedByText(raw);
    } catch {
      pmWork = null; // PubMed unreachable — fall through with whatever we have.
    }

    if (pmWork) {
      const pmLike = pubmed.toCrossrefLike(pmWork);
      const pmCont = computeContainment(raw, pmLike);
      const pmHasYear = pubmed.extractYear(pmWork) != null;
      let pmVerdict = verdictFor(pmCont, pmHasYear);
      // A PMID we looked up directly is an exact-identity match; accept a lower
      // containment bar (subtitle drops, journal-in-line noise) as long as the
      // title materially overlaps and the first author is present — but never on
      // zero overlap, so a wrong/typo'd PMID can't auto-verify.
      if (pmid && pmCont.titleContainment >= 0.5 && pmCont.surnameHit) pmVerdict = "verified";

      if (
        (pmVerdict === "verified" || pmVerdict === "partial_match") &&
        VERDICT_RANK[pmVerdict] > VERDICT_RANK[result.status]
      ) {
        result.status = pmVerdict;
        result.title = pmWork.title;
        result.pubmedMatch = {
          pmid: pmWork.pmid,
          title: pmWork.title,
          titleSimilarity: pmCont.titleContainment,
          authorOverlap: pmCont.surnameHit ? 1 : 0,
          yearMatch: pmCont.yearHit,
        };
        if (pmVerdict === "partial_match") {
          result.warnings.push("Reference text only partially matches the closest PubMed record.");
        }
        if (pmWork.doi) await enrichOpenAlex(result, pmWork.doi);
      }

      if (pmVerdict === "verified" && pubmed.isRetracted(pmWork) && !result.retracted) {
        result.retracted = true;
        result.warnings.push("This work has been retracted (PubMed).");
      }
    }
  }

  // --- Finalize a still-unresolved reference ---
  if (result.status === "not_found") {
    // Crossref was unreachable and nothing rescued it: a transient failure, not
    // a verdict on the reference.
    if (crossrefUnreachable && candidates.length === 0) {
      result.status = "check_failed";
      result.warnings.push("Could not reach Crossref — re-run to check this reference.");
      return result;
    }
    // A rejected best-guess is not the user's reference — do not surface the
    // rejected paper's title (the CLI would otherwise headline a fabricated ref
    // with a real paper's title). Show only sourceRef.
    result.title = "";
    result.crossrefMatch = null;
    if (candidates.length === 0) {
      result.warnings.push("No matching record in Crossref or PubMed — this reference may be fabricated.");
    } else if (crCont && crCont.titleTokenCount > 0) {
      // Suppress the fabrication warning when the candidate title yielded zero
      // extractable tokens — that is a tokenizer limitation (e.g. a script the
      // normalizer cannot segment), NOT evidence of fabrication.
      result.warnings.push("Closest record does not match this reference — it may be fabricated.");
    } else {
      result.warnings.push("Could not verify this reference automatically — please check it manually.");
    }
  }

  return result;
}

/**
 * Best-effort title extraction from a Vancouver-style citation, for querying
 * PubMed. PubMed's esearch matches poorly on a full citation string — the author
 * fragments, abbreviated journal, and page range get ANDed together and return
 * nothing (Crossref's citation endpoint tolerates the raw string; PubMed's does
 * not). Stripping a leading author list and the trailing "Journal. Year;vol:pages"
 * tail leaves a clean title query. Falls back to the raw string if it can't
 * confidently isolate a title. Exported for testing.
 */
export function extractQueryTitle(raw: string): string {
  let s = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bdoi:\s*\S+/gi, " ")
    .replace(/\bpmid:?\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip a leading author list: "Surname II" units joined by commas / "and" / "&",
  // optionally followed by "et al" and/or a group author ("… Research Group"),
  // ending in a period before a capitalized title word.
  const unit = "[A-Z][A-Za-zÀ-ÿ'’\\-]+\\s+(?:[A-Z]\\.?){1,3}";
  const etal = "(?:,?\\s*et\\s+al\\.?)?";
  const group = "(?:\\s*[;,]\\s*[A-Z][A-Za-zÀ-ÿ'’\\- ]+?(?:Group|Investigators|Consortium|Collaboration|Network|Committee))?";
  const authorList = new RegExp(`^(?:${unit})(?:(?:,\\s*|\\s+and\\s+|\\s*&\\s*)(?:${unit}))*${etal}${group}\\.\\s+(?=[A-Z])`);
  const m = s.match(authorList);
  if (m) s = s.slice(m[0].length).trim();

  // Drop the trailing "Journal. Year;vol:pages" tail: first any year/volume
  // segments, then — only once a year tail confirmed we're looking at a citation
  // — a trailing journal-abbreviation segment ("N Engl J Med", "Keio J Med").
  const segs = s.split(/\.\s+/).map((x) => x.trim()).filter(Boolean);
  let sawYear = false;
  while (segs.length > 1 && /\b(19|20)\d{2}\b/.test(segs[segs.length - 1]!)) { segs.pop(); sawYear = true; }
  if (sawYear) {
    while (segs.length > 1 && looksLikeJournal(segs[segs.length - 1]!)) segs.pop();
  }
  const title = segs.join(". ").replace(/[.\s]+$/, "").trim();

  return title.length >= 8 ? title : raw;
}

/** Short, journal-abbreviation-shaped segment (few words, carrying a journal
 * hint word) — used only to peel a trailing journal name off a citation. */
const JOURNAL_HINT = /\b(J|Med|Sci|Biol|Clin|Res|Proc|Natl|Acad|Rev|Cell|PLoS|Engl|Circ|Cardiol|Am|Eur|Int|Mol|Physiol|Lab|Ann|Nat|BMC|Stem|Transl|Rep|Metab|Immunol|Oncol|Genet|Neurol|Surg|Hematol|Blood|Nature|Science|Lancet|JAMA|NEJM|Keio|Heart|Lung|Vasc|Pathol|Chest|Kidney|Biomaterials|iScience|JACC|ASAIO)\b/;
function looksLikeJournal(seg: string): boolean {
  const words = seg.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 7 && JOURNAL_HINT.test(seg);
}

/** Search PubMed for a free-text reference and return the best containment
 * match, or null. Rejects weak best-guesses the same way the Crossref path does. */
async function bestPubmedByText(raw: string): Promise<pubmed.PubmedWork | null> {
  const works = await pubmed.searchByText(extractQueryTitle(raw), 5);
  let best: pubmed.PubmedWork | null = null;
  let bestScore = 0;
  for (const w of works) {
    const cont = computeContainment(raw, pubmed.toCrossrefLike(w));
    if (cont.titleContainment > bestScore) {
      bestScore = cont.titleContainment;
      best = w;
    }
  }
  // Below this, verdictFor would reject it as not_found anyway; skip the work.
  return bestScore >= 0.45 ? best : null;
}
