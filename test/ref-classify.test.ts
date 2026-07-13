import { test, expect } from "bun:test";
import { classifyRef, reconcile } from "../src/ref-classify.js";

test("journal articles: DOI, eLocator, vol(issue):pages, and truncated DOI", () => {
  expect(classifyRef("Maron DJ, et al. Initial Invasive or Conservative Strategy for Stable Coronary Disease. N Engl J Med. 2020 Apr 9;382(15):1395-1407. doi: 10.1056/NEJMoa1915922.")).toBe("journal");
  expect(classifyRef("Tamura Y, et al. Human Pentraxin 3 as a Novel Biomarker. PLoS One. 2012;7(9):e45834.")).toBe("journal");
  expect(classifyRef("Fujita J, Krishnan B, Green L, Lai S. Secretory Carcinoma with ETV6-NTRK3 Gene Fusion. Ann Clin Lab Sci. 2023 Sep;53(5):800-805.")).toBe("journal");
  expect(classifyRef("Fujita J, et al. Factor XIII Concentrate. ASAIO Journal 2025 Dec 9. doi: 10.1097")).toBe("journal");
  expect(classifyRef("Kawada H, Fujita J, et al. Non-hematopoietic mesenchymal stem cells. Blood. 2004;104(12):3581-3587.")).toBe("journal");
});

test("book chapters: 'In:' + publisher outrank page ranges", () => {
  expect(classifyRef("Fujita J, et al. Clinical Application of iPSC Derived Cardiomyocytes. In: Advanced Technologies in Cardiovascular Bioengineering. Springer; 2022. p361-374.")).toBe("book");
  expect(classifyRef("Fukuda K, Fujita J, Hakuno D, Makino S. Mesenchymal stem cell-derived cardiomyogenic cells. In: Cardiac Regeneration and Stem Cell Therapy. Wiley-Blackwell; 2006. p37-45.")).toBe("book");
});

test("conference presentations: meetings/retreats without journal structure", () => {
  expect(classifyRef("Fujita J, Barbieri A, Eskandari G. Aggressive lymphoma with bone marrow necrosis. Texas Society of Pathologists Young Pathologists Section Retreat, San Antonio, TX, August 2023.")).toBe("presentation");
  expect(classifyRef("Okada M, et al. Prevention of tumorigenesis. European Society of Cardiology Congress 2018, Munich, Germany, August 2018.")).toBe("presentation");
  expect(classifyRef("Endo J, et al. Contribution of bone marrow-derived cells. American Heart Association 78th Scientific Sessions, Chicago, IL, November 2006.")).toBe("presentation");
});

test("edge case: a conference report PUBLISHED in a journal is a journal article", () => {
  // has "Scientific Sessions" in the title but also a real vol(issue):pages → journal
  expect(classifyRef("Aizawa Y, Kimura M, Fujita J, Fukuda K. Report of the American Heart Association Scientific Sessions 2015. Circ J. 2015 Dec 25;80(1):51-7.")).toBe("journal");
});

test("reconcile: section hint is authoritative unless content is a hard journal signal", () => {
  expect(reconcile("presentation", "unknown")).toBe("presentation");       // trust the section
  expect(reconcile(undefined, "journal")).toBe("journal");                  // no section → content
  expect(reconcile("presentation", "journal")).toBe("journal");             // structured journal filed under Presentations
  expect(reconcile("book", "unknown")).toBe("book");
});
