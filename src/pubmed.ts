import { userAgent, politeMailto, ncbiApiKey, fetchRetry } from "./http.js";
import type { CrossrefWork } from "./crossref.js";

// NCBI E-utilities. PubMed is the authoritative index for biomedical
// literature, so it both (a) rescues real references that Crossref/OpenAlex
// under-cover and (b) lets us verify the PMID identifiers that biomedical
// citations carry far more often than DOIs.
const BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// NCBI's usage policy: at most 3 requests/second without an API key, 10/second
// with one. The structured path fires up to 10 references concurrently, each of
// which may make an esearch + esummary pair, so PubMed calls MUST be globally
// throttled or NCBI returns 429s. We gate the START of every request through a
// single promise chain that enforces minimum spacing between launches.
const SPACING_NO_KEY_MS = 350; // ~2.8 req/s, safely under the 3/s cap
const SPACING_WITH_KEY_MS = 120; // ~8 req/s, under the 10/s cap

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let lastLaunch = 0;
let gate: Promise<void> = Promise.resolve();

/** Resolve once it is this caller's turn to launch, respecting NCBI spacing. */
function throttle(): Promise<void> {
  gate = gate.then(async () => {
    const spacing = ncbiApiKey() ? SPACING_WITH_KEY_MS : SPACING_NO_KEY_MS;
    const wait = Math.max(0, lastLaunch + spacing - Date.now());
    if (wait > 0) await sleep(wait);
    lastLaunch = Date.now();
  });
  return gate;
}

/** Append the polite-pool identifiers (tool, email, api_key) NCBI asks for. */
function identityParams(): string {
  const parts = ["tool=citecheck"];
  const email = politeMailto();
  if (email) parts.push(`email=${encodeURIComponent(email)}`);
  const key = ncbiApiKey();
  if (key) parts.push(`api_key=${encodeURIComponent(key)}`);
  return parts.join("&");
}

async function eutilsFetch(url: string): Promise<Response> {
  await throttle();
  return fetchRetry(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    timeoutMs: 10_000,
  });
}

/** ESummary v2 record (subset of the fields citecheck reads). */
interface ESummaryRecord {
  uid?: string;
  title?: string;
  pubdate?: string;
  sortpubdate?: string;
  authors?: { name?: string; authtype?: string }[];
  articleids?: { idtype?: string; value?: string }[];
  pubtype?: string[];
  error?: string;
}

export interface PubmedWork {
  pmid: string;
  title: string;
  authors: string[]; // raw "Lastname FM" strings as PubMed returns them
  year?: number;
  doi?: string;
  pubtypes: string[];
}

function parseYear(rec: ESummaryRecord): number | undefined {
  // sortpubdate is "YYYY/MM/DD ..."; pubdate is looser ("2016 Jul", "2016").
  const raw = rec.sortpubdate ?? rec.pubdate ?? "";
  const m = raw.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

function docToWork(rec: ESummaryRecord): PubmedWork | null {
  if (!rec || rec.error || !rec.uid) return null;
  const doi = rec.articleids?.find((a) => a.idtype === "doi")?.value;
  return {
    pmid: rec.uid,
    title: (rec.title ?? "").replace(/\.$/, ""), // PubMed titles carry a trailing period
    authors: (rec.authors ?? [])
      .filter((a) => a.authtype == null || a.authtype === "Author")
      .map((a) => a.name ?? "")
      .filter(Boolean),
    year: parseYear(rec),
    doi: doi || undefined,
    pubtypes: rec.pubtype ?? [],
  };
}

/** Look up a single PMID via ESummary. `null` for a definitive miss; THROWS if
 * PubMed was unreachable (mirrors crossref.checkDoi's contract). */
export async function checkPmid(pmid: string): Promise<PubmedWork | null> {
  const clean = pmid.replace(/\D/g, "");
  if (!clean) return null;
  const res = await eutilsFetch(`${BASE_URL}/esummary.fcgi?db=pubmed&retmode=json&id=${clean}&${identityParams()}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: Record<string, ESummaryRecord> };
  const rec = body.result?.[clean];
  return rec ? docToWork(rec) : null;
}

/** Search PubMed by title/free text: ESearch for PMIDs, then ESummary for their
 * metadata. Returns matches (best-effort), `[]` for a definitive empty result,
 * and THROWS if PubMed was unreachable. */
export async function searchByText(query: string, retmax = 5): Promise<PubmedWork[]> {
  const term = encodeURIComponent(query.replace(/\s+/g, " ").trim().slice(0, 500));
  if (!term) return [];
  const searchRes = await eutilsFetch(
    `${BASE_URL}/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${term}&${identityParams()}`,
  );
  if (!searchRes.ok) return [];
  const searchBody = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = searchBody.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const sumRes = await eutilsFetch(
    `${BASE_URL}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}&${identityParams()}`,
  );
  if (!sumRes.ok) return [];
  const sumBody = (await sumRes.json()) as {
    result?: { uids?: string[] } & Record<string, ESummaryRecord>;
  };
  const result = sumBody.result;
  if (!result) return [];
  // Preserve ESearch's relevance order (result.uids), not object key order.
  const order = result.uids ?? ids;
  return order
    .map((id) => (result[id] ? docToWork(result[id]!) : null))
    .filter((w): w is PubmedWork => w !== null);
}

export function extractYear(work: PubmedWork): number | undefined {
  return work.year;
}

/** PubMed tags the retracted article itself with the "Retracted Publication"
 * publication type (the notice is "Retraction of Publication" — deliberately NOT
 * flagged, since citing a notice is not citing a retracted work). Some records
 * also prefix the title, e.g. "Retracted: …". */
export function isRetracted(work: PubmedWork): boolean {
  if (work.pubtypes.some((t) => /^retracted publication$/i.test(t))) return true;
  return /^\s*retracted\s*:/i.test(work.title);
}

/** First author's surname (PubMed formats authors as "Lastname FM"). */
export function firstAuthorSurname(work: PubmedWork): string {
  const first = work.authors[0] ?? "";
  return first.split(/\s+/)[0] ?? "";
}

/**
 * Adapt a PubMed record to the CrossrefWork shape so the free-text containment
 * scorer (computeContainment / verdictFor) and the structured Jaccard scorer can
 * be reused verbatim, instead of duplicating the matching logic per source.
 */
export function toCrossrefLike(work: PubmedWork): CrossrefWork {
  return {
    DOI: work.doi ?? "",
    title: work.title ? [work.title] : [],
    author: work.authors.map((name) => {
      const parts = name.split(/\s+/);
      return { family: parts[0] ?? "", given: parts.slice(1).join(" ") };
    }),
    published: work.year != null ? { "date-parts": [[work.year]] } : undefined,
  };
}
