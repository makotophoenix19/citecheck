import { test, expect, afterEach } from "bun:test";
import { quickCheck, YEAR_TOLERANCE_NOTE } from "../src/quick-check.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CITECHECK_STRICT;
});

// Mock Crossref checkDoi to return a real record whose published year is `year`;
// everything else 404s (so PubMed/OpenAlex/DOAJ are no-ops).
function crossrefRecordYear(year: number): void {
  globalThis.fetch = (async (u: string | URL) => {
    if (String(u).includes("api.crossref.org/works/10.")) {
      return new Response(
        JSON.stringify({
          message: {
            DOI: "10.1/x",
            title: ["A perfectly real study of things"],
            author: [{ family: "Smith" }, { family: "Jones" }],
            published: { "date-parts": [[year]] },
          },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const ITEM = {
  id: "t",
  DOI: "10.1/x",
  title: "A perfectly real study of things",
  author: [{ family: "Smith" }, { family: "Jones" }],
  issued: { "date-parts": [[2020]] as (string | number)[] },
};

test("default: DOI resolves but year is off by 1 → verified, with the transparency note", async () => {
  crossrefRecordYear(2021); // record 2021 vs citation 2020
  const r = await quickCheck([ITEM]);
  expect(r.citations[0]!.status).toBe("verified");
  expect(r.citations[0]!.warnings).toContain(YEAR_TOLERANCE_NOTE);
  // crossrefMatch.yearMatch still reports the raw (non-exact) truth for consumers.
  expect(r.citations[0]!.crossrefMatch?.yearMatch).toBe(false);
});

test("--strict: the same year-off-by-1 reference is NOT verified", async () => {
  process.env.CITECHECK_STRICT = "1";
  crossrefRecordYear(2021);
  const r = await quickCheck([ITEM]);
  expect(r.citations[0]!.status).not.toBe("verified");
  expect(r.citations[0]!.warnings).not.toContain(YEAR_TOLERANCE_NOTE);
});

test("tolerance is only ±1: a 2-year gap does not verify", async () => {
  crossrefRecordYear(2022); // delta 2 from 2020
  const r = await quickCheck([ITEM]);
  expect(r.citations[0]!.status).not.toBe("verified");
});

test("exact year still verifies with no year note", async () => {
  crossrefRecordYear(2020); // exact
  const r = await quickCheck([ITEM]);
  expect(r.citations[0]!.status).toBe("verified");
  expect(r.citations[0]!.warnings).not.toContain(YEAR_TOLERANCE_NOTE);
});
