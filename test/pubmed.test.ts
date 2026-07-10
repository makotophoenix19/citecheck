import { test, expect, afterEach, beforeAll } from "bun:test";
import {
  checkPmid,
  searchByText,
  isRetracted,
  firstAuthorSurname,
  extractYear,
  toCrossrefLike,
  type PubmedWork,
} from "../src/pubmed.js";
import { quickCheck } from "../src/quick-check.js";
import { checkFreeTextRef } from "../src/references/match.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Shorten NCBI request spacing so the module's rate-limit gate doesn't add
// hundreds of ms per mocked call (the value never leaves the URL query in our
// mocks, which ignore params).
beforeAll(() => { process.env.CITECHECK_NCBI_API_KEY = "test-key"; });

/** Route mocked fetch by URL substring; unmatched routes 404. */
function route(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const WHO_SUMMARY = {
  uid: "28170064",
  title: "The 2016 World Health Organization Classification of Tumors of the Central Nervous System: a summary.",
  sortpubdate: "2016/05/01 00:00",
  authors: [
    { name: "Louis DN", authtype: "Author" },
    { name: "Perry A", authtype: "Author" },
    { name: "Reifenberger G", authtype: "Author" },
  ],
  articleids: [
    { idtype: "pubmed", value: "28170064" },
    { idtype: "doi", value: "10.1007/s00401-016-1545-1" },
  ],
  pubtype: ["Journal Article", "Review"],
};

// --- unit: checkPmid ---------------------------------------------------------

test("checkPmid parses title (trailing period stripped), DOI, year and authors", async () => {
  route({ "esummary.fcgi": { result: { uids: ["28170064"], "28170064": WHO_SUMMARY } } });
  const w = await checkPmid("28170064");
  expect(w).not.toBeNull();
  expect(w!.pmid).toBe("28170064");
  expect(w!.doi).toBe("10.1007/s00401-016-1545-1");
  expect(w!.year).toBe(2016);
  expect(w!.title.endsWith(".")).toBe(false);
  expect(firstAuthorSurname(w!)).toBe("Louis");
  expect(isRetracted(w!)).toBe(false);
});

test("checkPmid tolerates a 'PMID:'-prefixed / non-digit id and returns null on an error record", async () => {
  route({ "esummary.fcgi": { result: { uids: ["999"], "999": { uid: "999", error: "cannot get document summary" } } } });
  expect(await checkPmid("PMID: 999")).toBeNull();
});

// --- unit: retraction --------------------------------------------------------

test("isRetracted flags the retracted article, not the retraction notice", () => {
  const retracted: PubmedWork = { pmid: "1", title: "A study", authors: [], pubtypes: ["Journal Article", "Retracted Publication"] };
  const notice: PubmedWork = { pmid: "2", title: "Retraction of X", authors: [], pubtypes: ["Retraction of Publication"] };
  const titlePrefix: PubmedWork = { pmid: "3", title: "Retracted: A study", authors: [], pubtypes: ["Journal Article"] };
  const normal: PubmedWork = { pmid: "4", title: "A normal paper", authors: [], pubtypes: ["Journal Article"] };
  expect(isRetracted(retracted)).toBe(true);
  expect(isRetracted(notice)).toBe(false);
  expect(isRetracted(titlePrefix)).toBe(true);
  expect(isRetracted(normal)).toBe(false);
});

// --- unit: searchByText order + adaptation ----------------------------------

test("searchByText preserves ESearch relevance order via result.uids", async () => {
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    if (url.includes("esearch.fcgi")) {
      return new Response(JSON.stringify({ esearchresult: { idlist: ["2", "1"] } }), { status: 200 });
    }
    // esummary — object key order deliberately differs from the relevance order.
    return new Response(JSON.stringify({
      result: {
        uids: ["2", "1"],
        "1": { uid: "1", title: "Second best.", authors: [{ name: "Bee C" }], articleids: [] },
        "2": { uid: "2", title: "Top hit.", authors: [{ name: "Ay A" }], articleids: [] },
      },
    }), { status: 200 });
  }) as typeof fetch;

  const works = await searchByText("some query");
  expect(works.map((w) => w.pmid)).toEqual(["2", "1"]);
  expect(works[0]!.title).toBe("Top hit");
});

test("toCrossrefLike adapts a PubMed record to the Crossref shape (surname split, year date-parts)", () => {
  const w: PubmedWork = {
    pmid: "1", title: "T", authors: ["Louis DN", "Perry A"], year: 2016, doi: "10.1/x", pubtypes: [],
  };
  const cr = toCrossrefLike(w);
  expect(cr.DOI).toBe("10.1/x");
  expect(cr.title).toEqual(["T"]);
  expect(cr.author?.[0]).toEqual({ family: "Louis", given: "DN" });
  expect(cr.published?.["date-parts"]?.[0]?.[0]).toBe(2016);
  expect(extractYear(w)).toBe(2016);
});

// --- integration: structured path -------------------------------------------

test("DOI-exact tuning: a real paper whose citation drops the subtitle verifies without PubMed", async () => {
  // Citation says "WHO"; the Crossref record spells out "World Health
  // Organization", so symmetric title Jaccard dips below 0.7. Because the DOI
  // resolved exactly and the authors overlap, it must still verify.
  route({
    "api.crossref.org/works/10.1007": {
      message: {
        DOI: "10.1007/s00401-016-1545-1",
        title: ["The 2016 World Health Organization Classification of Tumours of the Central Nervous System: a summary"],
        author: [{ family: "Louis" }, { family: "Perry" }, { family: "Reifenberger" }],
        published: { "date-parts": [[2016]] },
        ISSN: ["0001-6322"],
      },
    },
  });
  const result = await quickCheck([{
    id: "who2016",
    DOI: "10.1007/s00401-016-1545-1",
    title: "The 2016 WHO Classification of Tumours of the Central Nervous System: a summary",
    author: [{ family: "Louis" }, { family: "Perry" }],
    issued: { "date-parts": [[2016]] },
  }]);
  expect(result.citations[0]!.status).toBe("verified");
  expect(result.citations[0]!.crossrefMatch?.doi).toBe("10.1007/s00401-016-1545-1");
});

test("fabrication guard: a fake DOI that resolves to an unrelated real paper does NOT verify", async () => {
  route({
    // The hallucinated DOI happens to resolve to a real but unrelated paper,
    // coincidentally sharing the citation's year.
    "api.crossref.org/works/10.1038": {
      message: {
        DOI: "10.1038/s44521-023-00417-2",
        title: ["A completely different real paper about something else"],
        author: [{ family: "Nobody" }],
        published: { "date-parts": [[2023]] },
      },
    },
    // PubMed finds nothing to corroborate the fabricated title.
    "esearch.fcgi": { esearchresult: { idlist: [] } },
  });
  const result = await quickCheck([{
    id: "fab",
    DOI: "10.1038/s44521-023-00417-2",
    title: "Spatial transcriptomic profiling of tumor-infiltrating lymphocytes predicts immunotherapy response",
    author: [{ family: "Ramirez" }, { family: "Okafor" }],
    issued: { "date-parts": [[2023]] },
  }]);
  expect(result.citations[0]!.status).not.toBe("verified");
  expect(["suspicious", "not_found"]).toContain(result.citations[0]!.status);
});

test("PubMed rescue: a Crossref near-miss on a DOI-less citation is upgraded to verified via PubMed", async () => {
  route({
    // Crossref title-search returns a weak, wrong-year candidate (a near-miss:
    // enough signal to escalate, not enough to verify) — no DOI on the citation.
    "api.crossref.org/works?": {
      message: {
        items: [{
          DOI: "10.9999/weak",
          title: ["Classification of tumors of the central nervous system"],
          author: [{ family: "Someone" }],
          published: { "date-parts": [[2010]] },
        }],
      },
    },
    "esearch.fcgi": { esearchresult: { idlist: ["28170064"] } },
    "esummary.fcgi": { result: { uids: ["28170064"], "28170064": WHO_SUMMARY } },
  });
  const result = await quickCheck([{
    id: "who_nodoi",
    title: "The 2016 World Health Organization Classification of Tumors of the Central Nervous System: a summary",
    author: [{ family: "Louis" }, { family: "Perry" }, { family: "Reifenberger" }],
    issued: { "date-parts": [[2016]] },
  }]);
  expect(result.citations[0]!.status).toBe("verified");
  expect(result.citations[0]!.pubmedMatch?.pmid).toBe("28170064");
});

test("bounded escalation: a citation Crossref can't find at all does NOT trigger a PubMed search", async () => {
  // Guards the rate-limit fix: zero Crossref candidates + no PMID => PubMed is
  // never called, so a big bibliography of junk lines can't fan out to NCBI.
  let esearchCalls = 0;
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    if (url.includes("api.crossref.org")) return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    if (url.includes("esearch.fcgi") || url.includes("esummary.fcgi")) esearchCalls++;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const result = await quickCheck([{
    id: "junk",
    title: "Nonexistent fabricated paper title with no real match anywhere",
    author: [{ family: "Ghost" }],
    issued: { "date-parts": [[2099]] },
  }]);
  expect(result.citations[0]!.status).toBe("not_found");
  expect(esearchCalls).toBe(0);
});

// --- integration: free-text path --------------------------------------------

test("free-text PMID rescue: a cited PMID verifies when Crossref returns nothing", async () => {
  route({
    "api.crossref.org/works?": { message: { items: [] } }, // Crossref bibliographic search empty
    "esummary.fcgi": { result: { uids: ["28170064"], "28170064": WHO_SUMMARY } },
  });
  const raw =
    "Louis DN, Perry A, Reifenberger G, et al. The 2016 WHO classification of tumors of the central nervous system: a summary. Acta Neuropathol. 2016;131(6):803-820. PMID: 28170064.";
  const r = await checkFreeTextRef(raw);
  expect(r.status).toBe("verified");
  expect(r.pubmedMatch?.pmid).toBe("28170064");
});

test("free-text fabrication: no Crossref and no PubMed match stays not_found", async () => {
  route({
    "api.crossref.org/works?": { message: { items: [] } },
    "esearch.fcgi": { esearchresult: { idlist: [] } },
  });
  const raw = "Phantom A. Quantum entanglement of bibliographic ghosts. J Imaginary Studies. 2021;9:1-9.";
  const r = await checkFreeTextRef(raw);
  expect(r.status).toBe("not_found");
  expect(r.warnings.join(" ")).toContain("may be fabricated");
});
