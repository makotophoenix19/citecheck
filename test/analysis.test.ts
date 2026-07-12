import { test, expect } from "bun:test";
import { analyze, describeRef } from "../src/analysis.js";
import { YEAR_TOLERANCE_NOTE, type CitationCheckResult } from "../src/quick-check.js";

function cite(over: Partial<CitationCheckResult>): CitationCheckResult {
  return {
    key: "", title: "T", status: "verified",
    crossrefMatch: null, openalexMatch: null, pubmedMatch: null,
    journalStatus: "unknown", retracted: false, warnings: [], ...over,
  };
}

test("analyze: root-causes each verdict into the right bucket", () => {
  const a = analyze([
    cite({ status: "verified" }),
    cite({ status: "verified", warnings: [YEAR_TOLERANCE_NOTE] }),
    cite({ status: "partial_match", warnings: ["Publication year mismatch."] }),
    cite({ status: "partial_match", warnings: ["Title differs from Crossref record."] }),
    cite({ status: "suspicious", warnings: ["Found a Crossref record but metadata does not match well."] }),
    cite({ status: "not_found", warnings: ["No matching record in Crossref or PubMed — this reference may be fabricated."] }),
    cite({ status: "check_failed", warnings: ["Could not reach Crossref — re-run to check this reference."] }),
    cite({ status: "verified", retracted: true }),
  ]);
  expect(a.buckets).toEqual({ clean: 2, yearTolerated: 1, yearMismatch: 1, titleMismatch: 1, review: 1, notFound: 1, unreachable: 1 });
  expect(a.retracted.length).toBe(1);
  expect(a.notFound.length).toBe(1);
  expect(a.verdict).toBe("review");
  expect(a.verdictLabel).toBe("REVIEW NEEDED");
  expect(a.headline).toContain("3 of 8 verified");
  expect(a.headline).toContain("1 retracted");
  expect(a.actions.join(" ")).toContain("retracted");
  expect(a.actions.join(" ")).toContain("unmatched");
  expect(a.actions.join(" ")).toContain("Re-run");
});

test("analyze: a clean run says everything was located", () => {
  const a = analyze([cite({ status: "verified" }), cite({ status: "verified" })]);
  expect(a.verdict).toBe("pass");
  expect(a.verdictLabel).toBe("PASS");
  expect(a.headline).toContain("All 2 references were located");
  expect(a.actions.join(" ")).toContain("No action needed");
});

test("analyze: only transient failures yield a RE-RUN verdict", () => {
  const a = analyze([
    cite({ status: "verified" }),
    cite({ status: "check_failed", warnings: ["Could not reach Crossref — re-run to check this reference."] }),
  ]);
  expect(a.verdict).toBe("rerun");
  expect(a.verdictLabel).toBe("RE-RUN");
});

test("analyze: DOI-bearing found rate uses the source items", () => {
  const a = analyze(
    [cite({ status: "verified" }), cite({ status: "not_found" }), cite({ status: "verified" })],
    [{ DOI: "10.1/a" }, { DOI: "10.1/b" }, {}], // items 0,1 have DOIs; item 1 was not found
  );
  expect(a.doiTotal).toBe(2);
  expect(a.doiFound).toBe(1);
  expect(a.doiFoundPct).toBe(50);
});

test("describeRef: flags retracted and not_found as needing attention", () => {
  expect(describeRef(cite({ status: "not_found" })).attention).toBe(true);
  expect(describeRef(cite({ status: "verified", retracted: true })).attention).toBe(true);
  expect(describeRef(cite({ status: "verified" })).attention).toBe(false);
  expect(describeRef(cite({ status: "partial_match", warnings: ["Title differs from Crossref record."] })).category).toBe("titleMismatch");
});
