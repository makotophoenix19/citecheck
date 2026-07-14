import { test, expect } from "bun:test";
import { extractSurnames, detectOwner, isFirstAuthor, isCorresponding, findDuplicates } from "../src/cv-profile.js";

test("extractSurnames pulls the author-list surnames only", () => {
  const s = extractSurnames("Fujita J, Krishnan B, Green L. Some Great Title About Hearts. Ann Clin Lab Sci. 2023;53(5):800-805.");
  expect(s).toEqual(["fujita", "krishnan", "green"]);
});

test("detectOwner finds the surname present in the most references", () => {
  const refs = [
    "Fujita J, Smith A. Paper one. J Cardiol. 2020;1(1):1-2.",
    "Doe B, Fujita J. Paper two. Circulation. 2021;2(2):3-4.",
    "Fujita J. Paper three. Cell. 2022;3(3):5-6.",
    "Fujita J, Lee C. Paper four. Blood. 2019;4(4):7-8.",
  ];
  expect(detectOwner(refs)).toBe("fujita");
});

test("isFirstAuthor checks the owner's position", () => {
  expect(isFirstAuthor("Fujita J, Smith A. Title. J. 2020;1:1.", "fujita")).toBe(true);
  expect(isFirstAuthor("Smith A, Fujita J. Title. J. 2020;1:1.", "fujita")).toBe(false);
});

test("isCorresponding detects the annotation", () => {
  expect(isCorresponding("Fujita J. Title. Keio J Med. 2020. corresponding author")).toBe(true);
  expect(isCorresponding("Fujita J. Title. Keio J Med. 2020.")).toBe(false);
});

test("findDuplicates groups a paper listed twice (abstract + article)", () => {
  const dups = findDuplicates([
    "Secretory Carcinoma with ETV6-NTRK3 Gene Fusion in Maxillary Gingiva",
    "Secretory Carcinoma with ETV6-NTRK3 Gene Fusion in Maxillary Gingiva",
    "A Completely Different Paper About Something Else Entirely",
  ]);
  expect(dups.length).toBe(1);
  expect(dups[0]!.count).toBe(2);
});
