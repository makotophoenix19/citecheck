# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0-hm.1] - 2026-07-10 — Houston Methodist fork

Fork of [tobiasosDev/citecheck](https://github.com/tobiasosDev/citecheck) by the
Houston Methodist Department of Pathology & Genomic Medicine, adding **PubMed** as
a fourth verification source for biomedical literature.

### Added

- **PubMed (NCBI E-utilities) source** (`src/pubmed.ts`): ESearch/ESummary lookups,
  globally rate-limited to NCBI's policy (3 req/s without a key, 10/s with
  `CITECHECK_NCBI_API_KEY`). Added to both the structured (`.bib`/`.ris`/CSL-JSON)
  and free-text/document paths.
- **Direct PMID verification.** A PMID carried by a reference (BibTeX `pmid`, RIS
  `AN`, CSL-JSON `PMID`, or an inline `PMID: …` in document text) is resolved
  against PubMed as an exact-identity check. The CLI shows a positive
  *"found in PubMed (PMID …)"* note when PubMed corroborates a reference.
- **PubMed retraction detection** via the "Retracted Publication" publication type,
  complementing Crossref's retraction metadata (the retraction *notice* type is
  deliberately not flagged).
- Tests: `test/pubmed.test.ts` (unit + end-to-end through `quickCheck` and
  `checkFreeTextRef`), covering the DOI-exact fix, the fabrication guard, the PMID
  rescue, and the bounded-escalation rate-limit guard.

### Changed

- **Verdict scoring tuned** (shared `scoreVerdict`): a reference whose exact DOI (or
  PMID) resolves now verifies on a year match plus modest author *or* title
  corroboration, fixing real papers with long subtitles (e.g. a WHO classification
  "…: a summary") that previously landed in *partial* because the citation dropped
  the subtitle. PubMed can only **upgrade** a Crossref verdict, never downgrade it.
- BibTeX and RIS parsers now carry the PMID through to verification.

### Notes

- To bound outbound traffic, a PubMed *title search* is an escalation reserved for a
  Crossref near-miss (a candidate that didn't verify); a reference Crossref can't
  find at all does not trigger a blanket PubMed search. Cited PMIDs are always
  verified directly.
- Not republished to npm; install from this fork's source.

## [1.3.0] - 2026-06-09

- **MCP server (`citecheck-mcp`):** verify references from an AI agent via three tools —
  `verify_reference`, `check_bibliography`, `check_document`. Action-first output designed
  for an LLM; inherits citecheck's conservatism (a "not found" is not a "fabricated" verdict)
  and the existing input guards.
- **Claude Code plugin:** bundles the MCP server and a `verify-sources` skill that has the
  agent verify sources proactively after writing cited content.
- Library: `verifyReference(ref)` is now a public export.

## [1.2.0] - 2026-06-05

### Added

- `citecheck/extract` subpath export exposing `locateBibliography` and
  `segmentReferences` without pulling in the `mammoth` document-parsing
  dependency, so other tools can reuse the section-location and segmentation
  logic directly.

### Changed

- Widened the recognized bibliography-heading vocabulary (additional English,
  German, Spanish/Portuguese and Italian headings) so the section is located in
  more documents.

## [1.1.1] - 2026-06-05

### Fixed

- Bibliography extraction now stops at thesis back-matter sections (e.g.
  appendices, lists of abbreviations, statutory declarations) instead of
  swallowing them as references, eliminating phantom "references" after the real
  bibliography ends.

## [1.1.0] - 2026-06-05

### Added

- Document upload and reference extraction: point citecheck at a `.docx`,
  `.txt`, or `.md` file and it locates the bibliography section, splits it into
  individual references, and runs the same existence check used for
  `.bib` / `.ris` / CSL-JSON.

## [1.0.0] - 2026-06-02

### Added

- Initial release: check whether the references in a `.bib`, `.ris`, or CSL-JSON
  bibliography exist (via Crossref and OpenAlex), flag retracted works (Crossref
  retraction metadata), and surface sources in DOAJ-listed open-access journals.
- CLI with `--json`, `--only-issues`, `--mailto`, and `--no-color` options and
  CI-friendly exit codes.
- Programmatic library API (`quickCheck`, `parseBib`, `parseRis`,
  `parseCslJson`).

[1.3.0]: https://github.com/tobiasosDev/citecheck/releases/tag/v1.3.0
[1.2.0]: https://github.com/tobiasosDev/citecheck/releases/tag/v1.2.0
[1.1.1]: https://github.com/tobiasosDev/citecheck/releases/tag/v1.1.1
[1.1.0]: https://github.com/tobiasosDev/citecheck/releases/tag/v1.1.0
[1.0.0]: https://github.com/tobiasosDev/citecheck/releases/tag/v1.0.0
