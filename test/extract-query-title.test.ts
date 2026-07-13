import { test, expect } from "bun:test";
import { extractQueryTitle } from "../src/references/match.js";

test("extracts the title from a multi-author Vancouver citation", () => {
  const raw = "Fujita J, Krishnan B, Green L, Sandulache V and Lai S. Secretory Carcinoma with ETV6-NTRK3 Gene Fusion and Lymph Node Metastasis in Maxillary Gingiva- A Case Report with Pathological and Molecular Correlative Studies. Ann Clin Lab Sci 2023 Sep;53(5):800-805.";
  const title = extractQueryTitle(raw);
  expect(title.startsWith("Secretory Carcinoma with ETV6-NTRK3 Gene Fusion")).toBe(true);
  expect(title).not.toContain("Fujita J");
  expect(title).not.toContain("Ann Clin Lab Sci");
  expect(title).not.toContain("2023");
});

test("handles a single author", () => {
  const raw = "Fujita J. Development of Cardiac Regenerative Medicine Using Human iPS Cell-derived Cardiomyocytes. Keio J Med. 2020 Aug 22.";
  const title = extractQueryTitle(raw);
  expect(title).toBe("Development of Cardiac Regenerative Medicine Using Human iPS Cell-derived Cardiomyocytes");
});

test("handles 'et al' and a group author", () => {
  const raw = "Maron DJ, Hochman JS, Reynolds HR, O'Brien SM, et al; ISCHEMIA Research Group. Initial Invasive or Conservative Strategy for Stable Coronary Disease. N Engl J Med. 2020 Apr 9;382(15):1395-1407.";
  const title = extractQueryTitle(raw);
  expect(title).toBe("Initial Invasive or Conservative Strategy for Stable Coronary Disease");
});

test("does not mistake a title starting with a capitalized word for an author list", () => {
  const raw = "Vitamin D deficiency and cardiovascular risk in adults.";
  // No author list / no clear journal tail — should not strip title content.
  expect(extractQueryTitle(raw)).toContain("Vitamin D deficiency");
});

test("falls back to the raw string when it can't isolate a title", () => {
  expect(extractQueryTitle("1953")).toBe("1953");
});
