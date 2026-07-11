import { test, expect } from "bun:test";
import { parseCsv, parsePureCsv, looksLikePureCsv } from "../src/pure-csv.js";

test("parseCsv handles quoted fields with commas, newlines, and doubled quotes", () => {
  const csv = 'a,b,c\n"x,1","line1\nline2","he said ""hi"""\n';
  const rows = parseCsv(csv);
  expect(rows[0]).toEqual(["a", "b", "c"]);
  expect(rows[1]).toEqual(["x,1", "line1\nline2", 'he said "hi"']);
});

const PURE =
  [
    "Year,Research Output Title,DOIs (Digital Object Identifiers),Vancouver format,Author format,Journal Title",
    '2016,"The 2016 WHO Classification of Tumours: a summary",10.1007/s00401-016-1545-1,"Louis DN et al.","Louis, David N. ; Perry, Arie / The 2016...",Acta Neuropathologica',
    "2011,Hallmarks of Cancer,10.1016/j.cell.2011.02.013,Hanahan,\"Hanahan, Douglas ; Weinberg, Robert A.\",Cell",
    "2011,Hallmarks of Cancer (dup DOI),10.1016/j.cell.2011.02.013,x,Someone,Cell",
  ].join("\n") + "\n";

test("parsePureCsv maps Pure columns and dedupes by DOI", () => {
  const items = parsePureCsv(PURE);
  expect(items.length).toBe(2); // 3rd data row is a DOI duplicate → dropped
  expect(items[0]!.DOI).toBe("10.1007/s00401-016-1545-1");
  expect(items[0]!.title).toContain("WHO Classification");
  expect(items[0]!.issued?.["date-parts"]?.[0]?.[0]).toBe(2016);
  expect(items[0]!.author?.[0]?.family).toBe("Louis");
  expect(items[0]!.author?.[1]?.family).toBe("Perry"); // "/ Title" tail stripped
});

test("looksLikePureCsv detects a research-output header", () => {
  expect(looksLikePureCsv(PURE)).toBe(true);
  expect(looksLikePureCsv("name,age\nBob,30\n")).toBe(false);
});
