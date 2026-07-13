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
