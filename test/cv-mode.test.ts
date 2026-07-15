import { test, expect } from "bun:test";
import { parseCv } from "../src/cv-parser.js";
import { analyzeCv } from "../src/analyze-cv.js";
import type { RefType } from "../src/ref-classify.js";
import type { CitationCheckResult } from "../src/quick-check.js";

const CV_TEXT = `PROFESSIONAL SUMMARY
Some prose about the person that should never be treated as a reference.

EDUCATION AND DEGREES
2005 Ph.D., Some University, Somewhere.

BIBLIOGRAPHY

Peer-Reviewed Publications — Cardiology
Smith J, Doe A. A real cardiology paper. N Engl J Med. 2020;382(15):1395-1407. doi: 10.1056/NEJMoa1915922.
Doe A, Smith J. Another article about hearts. PLoS One. 2019;14(3):e0210000.

Book Chapters
Smith J. A chapter on hearts. In: Big Book of Cardiology. Springer; 2021. p10-20.

PRESENTATIONS
Smith J, Doe A. A talk about hearts. American Heart Association Scientific Sessions, Chicago, IL, November 2019.

HONORS, AWARDS & SCHOLARSHIPS
2020 Best Paper Award, Some Society.`;

test("parseCv buckets by section and ignores non-publication content", () => {
  const { refs, sawSections } = parseCv(CV_TEXT);
  expect(sawSections).toBe(true);
  const byType = refs.reduce<Record<string, number>>((m, r) => { m[r.type] = (m[r.type] || 0) + 1; return m; }, {});
  expect(byType).toEqual({ journal: 2, book: 1, presentation: 1 });
  expect(refs.some((r) => /Best Paper Award/.test(r.text))).toBe(false);
  expect(refs.some((r) => /prose about the person/.test(r.text))).toBe(false);
});

function tc(type: RefType, over: Partial<CitationCheckResult>): { type: RefType; citation: CitationCheckResult } {
  return {
    type,
    citation: {
      key: "", title: "T", status: "verified", crossrefMatch: null, openalexMatch: null,
      pubmedMatch: null, journalStatus: "unknown", retracted: false, warnings: [], sourceRef: "", ...over,
    },
  };
}

test("analyzeCv: verdict comes from journals only — presentation/book not-found never flag", () => {
  const a = analyzeCv([
    tc("journal", { status: "verified" }),
    tc("journal", { status: "verified" }),
    tc("presentation", { status: "not_found" }),
    tc("book", { status: "not_found" }),
  ]);
  expect(a.verdict).toBe("pass");
  expect(a.presentation.total).toBe(1);
  expect(a.book.notIndexed).toBe(1);
});

test("analyzeCv: a not-found JOURNAL triggers REVIEW NEEDED", () => {
  const a = analyzeCv([
    tc("journal", { status: "verified" }),
    tc("journal", { status: "not_found", title: "Missing Paper" }),
    tc("presentation", { status: "not_found" }),
  ]);
  expect(a.verdict).toBe("review");
  expect(a.journal.notFound.length).toBe(1);
  expect(a.verdictDetail).toContain("1 journal article to confirm");
});

test("analyzeCv: a retraction anywhere triggers REVIEW NEEDED", () => {
  const a = analyzeCv([
    tc("journal", { status: "verified" }),
    tc("journal", { status: "verified", retracted: true, title: "Retracted paper" }),
  ]);
  expect(a.verdict).toBe("review");
  expect(a.retracted.length).toBe(1);
});

// ---------------------------------------------------------------------------
// Bulleted references (regression: Liu CV parsed as ONE 5,241-char mega-ref)
// ---------------------------------------------------------------------------

test("parseCv reflow: a bullet opens a reference and is stripped from the text", () => {
  // Full first names ("Richard K. Yang") match no author pattern — only the
  // bullet marks the boundary, which is exactly the case that regressed.
  const text = [
    "PEER-REVIEWED PUBLICATIONS",
    "• Richard K. Yang, Gokce A. Toruner, Wei Wang. CBFB Break-Apart FISH Testing: An",
    "Analysis of 1629 AML Cases. Cancers 2021, 13, 5354.",
    "• Liu S, Rice L, Ewton A. NK cell lymphocytosis with atypical immunophenotype in a",
    "chronic HIV infected patient. Cytometry Part B. Nov 2020.",
  ].join("\n");
  const { refs } = parseCv(text, { reflow: true });
  expect(refs.length).toBe(2);
  expect(refs[0]!.text.startsWith("Richard K. Yang")).toBe(true); // bullet gone
  expect(refs[0]!.text).toContain("Analysis of 1629 AML Cases"); // wrap rejoined
  expect(refs[1]!.text.startsWith("Liu S, Rice L")).toBe(true);
});

test("parseCv reflow: an unbulleted line still carries a reference across a page break", () => {
  const text = [
    "PEER-REVIEWED PUBLICATIONS",
    "• Richard K. Yang, Wei Wang, Joseph D.",
    "Khoury, L. Jeffrey Medeiros and Guilin Tang. CBFB Break-Apart FISH Testing. Cancers 2021.",
  ].join("\n");
  const { refs } = parseCv(text, { reflow: true });
  expect(refs.length).toBe(1);
  expect(refs[0]!.text).toContain("Khoury");
});

test("parseCv reflow: a footnote marker and a wrapped page range are not bullets", () => {
  const text = [
    "PEER-REVIEWED PUBLICATIONS",
    "• Wu RC*, Liu S*, Chacon JA. Detection of CD8+CD57+ T-cells. Clin Cancer Res 2012; 18(9):2465-",
    "-77.",
    "*: Co-first author.",
  ].join("\n");
  const { refs } = parseCv(text, { reflow: true });
  expect(refs.length).toBe(1); // all three lines are ONE reference
  expect(refs[0]!.text).toContain("Co-first author");
});

test("parseCv: bullets are stripped on the .docx/.txt path too", () => {
  const text = [
    "PEER-REVIEWED PUBLICATIONS",
    "• Liu S, Riley J, Rosenberg S. Comparison of common gamma chain cytokines. J Immunother 2006; 29(3): 284-93.",
  ].join("\n");
  const { refs } = parseCv(text); // no reflow — line segmenter path
  expect(refs.length).toBe(1);
  expect(refs[0]!.text.startsWith("Liu S")).toBe(true);
});

// ---------------------------------------------------------------------------
// Table-built CVs (regression: WCM template — table cells parsed as references,
// filling the cap so the real bibliography was truncated away → false PASS)
// ---------------------------------------------------------------------------

test("cvHeadingKind: a table cell that merely STARTS with a section word is not a heading", () => {
  // Both lines are real WCM cells: a column header and a mentee's project.
  const text = [
    "MENTORING",
    "Books / Textbooks / Journals / Organization Name",
    "Abstract and potential publication",
    "Tobiola Odetola, MD",
    "01/2016- 06/2019",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(0); // nothing here is a publication
});

test("parseCv: an unknown ALL-CAPS heading stops collection", () => {
  const text = [
    "Peer-reviewed Research Articles:",
    "Saint Martin M, DeChristopher P, Sweeney P. A Strategy for Wellness. Acad Pathol. 2020;7:1-6.",
    "INVITATIONS TO SPEAK/PRESENT",
    "Pathology Department Grand Rounds",
    "MD Anderson, Houston, Texas",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(1);
  expect(refs[0]!.text).toContain("A Strategy for Wellness");
});

test("cvHeadingKind: a heading may carry a dash subtitle or a parenthetical", () => {
  const text = [
    "Peer-Reviewed Publications — Pathology & Laboratory Medicine",
    "Fujita J, Smith A. A Paper Title Here. Ann Clin Lab Sci. 2023;53(5):800-805.",
    "Abstracts (optional, list 10-20 best or most recent only):",
    "Someone A. A Poster Title. Annual Meeting of the Society. 2021.",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(2);
  expect(refs[0]!.type).toBe("journal");
  expect(refs[1]!.type).toBe("presentation");
});

test("parseCv: unpublished and non-peer-reviewed sections are excluded, not flagged", () => {
  // These can never verify; checking them would flag every entry as "to confirm".
  const text = [
    "Peer-reviewed Research Articles:",
    "Real A, Author B. A Published Paper. J Med. 2020;1(1):1-5.",
    "In review (manuscripts submitted or in preparation – list separately):",
    "Demystifying Apheresis Myths for Non-Apheresis Providers. (In preparation).",
    "Non-peer-reviewed Research Publications:",
    "Saint Martin M. Wellness: A New Kind of Best Practice. The Pathologist. 2018 Aug;4(8):32-33.",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(1);
  expect(refs[0]!.text).toContain("A Published Paper");
});

test("cvHeadingKind: multi-word presentation headings ('Poster Presentations')", () => {
  // Listing the nouns as bare alternatives missed the two-word phrase, so these
  // posters were swallowed by the Publications section above and checked as
  // journal articles — 31 false "to confirm" on one real CV.
  const text = [
    "Publications",
    "Real A, Author B. A Published Paper. J Med. 2020;1(1):1-5.",
    "Poster presentations",
    "Someone A. A Poster Title. Annual Meeting of the Society. 2021.",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(2);
  expect(refs[0]!.type).toBe("journal");
  expect(refs[1]!.type).toBe("presentation");
});

test("cvHeadingKind: an ALL-CAPS heading naming publications opens a section, never stops", () => {
  // "PUBLICATIONS & PRESENTATIONS" has no specific pattern; stopping on it
  // discarded the whole section and reported zero publications.
  const text = [
    "PUBLICATIONS & PRESENTATIONS",
    "Articles in Peer-Reviewed Journals",
    "Eskandari G, Author B. A Real Paper Title. J Med. 2020;1(1):1-5.",
  ].join("\n");
  const { refs } = parseCv(text);
  expect(refs.length).toBe(1);
  expect(refs[0]!.type).toBe("journal");
});

test("cvHeadingKind: a mixed-case line with a publication word is still NOT a heading", () => {
  // The ALL-CAPS leniency must not extend to cells: this is the WCM mentee cell.
  const text = ["MENTORING", "Abstract and potential publication", "Tobiola Odetola, MD"].join("\n");
  expect(parseCv(text).refs.length).toBe(0);
});
