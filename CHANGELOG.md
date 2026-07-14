# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-07-13 — Houston Methodist edition

### Added

- **CV mode** (`--cv`, or the wizard's "This is a CV" toggle). A CV mixes journal
  articles, book chapters, and conference presentations — reference kinds with
  very different indexing expectations. CV mode reads the CV's section structure,
  classifies each reference by type, and checks with type-appropriate rules:
  - **journal articles** are hard-checked; a "not found" counts toward the verdict.
  - **book chapters** are checked, but "not indexed" is informational, not a flag.
  - **conference presentations / abstracts** are listed but not existence-checked —
    a conference item that isn't in Crossref/PubMed is normal, not a red flag.

  The PASS / REVIEW NEEDED verdict is computed from the **journal bucket only**
  (plus retractions across all types), so it reflects reality instead of
  over-flagging as plain document mode did on a CV. Output is a grouped on-screen
  report and a one-page HTML report, plus a light **publication profile** (article
  / chapter / presentation counts, year span, open-access).

  New modules: `ref-classify.ts` (type classifier), `cv-parser.ts` (section
  walker), `check-cv.ts` (pipeline), `analyze-cv.ts` (type-aware verdict),
  `report-cv-text.ts` / `report-cv-html.ts` (grouped reports).

### Fixed

- **PubMed rescue queries the extracted title, not the full citation.** A
  biomedical reference with no DOI whose journal is thinly indexed in Crossref
  (so Crossref returns the wrong papers) is now rescued via PubMed — its search
  works once given a clean title instead of the whole citation string. Fixes a
  real miss (*Ann Clin Lab Sci* 2023;53(5):800-805, PMID 37945013). Precision is
  unchanged: the containment scorer still gates every hit.
- For small bibliographies (≤100 refs) the rescue also fires when Crossref returns
  **nothing at all**, catching PubMed-only papers; larger bibliographies keep the
  fast near-miss-only behavior so outbound HTTP stays bounded. On the Crossref-
  empty path only a verified-grade PubMed match is accepted, so a fabrication
  can't soften to a benign mismatch.

### Notes

- Reads `.docx` / `.txt` / `.md` (PDF still on the roadmap). An Excel CV workbook
  is planned.
- The matcher can still occasionally miss a real paper in a very small journal
  absent from both indexes — CV mode makes the journal verdict trustworthy to
  *read*, not infallible.

## [1.3.0] - 2026-07-12 — Houston Methodist edition

### Added

- **At-a-glance verdict stamp.** Every result now opens with an unmistakable
  status: **PASS** (green — nothing to do), **REVIEW NEEDED** (red — retracted or
  not-found references to check, with the plain-language note on what to do), or
  **RE-RUN** (grey — only transient network failures; run it again). Shown as a
  reverse-video badge on screen, a colored badge at the top of the HTML report,
  and a colored cell at the top of the Excel Summary. The AI narrative is written
  to be consistent with the verdict. Re-run after resolving items until it's a
  clean PASS.

## [1.2.0] - 2026-07-12 — Houston Methodist edition

Adds **Layer 2**: an optional, plain-language leadership briefing written by
Claude on top of the deterministic analysis. It's strictly additive — with no
route configured, nothing changes and you get the Layer-1 analysis as before.

### Added

- **AI narrative layer.** When a route is configured, the wizard offers "Add a
  plain-language leadership summary?" and writes the result into the on-screen
  output, the HTML report (an "In plain terms" callout), and the Excel Summary
  tab.
- **Endpoint-agnostic client** (`src/explain-client.ts`): prefers
  `CITECHECK_EXPLAIN_URL` (a service you host — e.g. the NAS over Tailscale, so
  the API key never touches a laptop), else falls back to a direct Claude call
  when `ANTHROPIC_API_KEY` is set (fast local iteration). Same code path either
  way; if neither is set it silently returns nothing.
- **Narrative generator** (`src/explain.ts`, Anthropic SDK, `claude-opus-4-8`)
  and a **privacy-bounded payload** (`src/explain-input.ts`) — only aggregate
  counts and the **titles** of flagged references (published, public metadata)
  are ever sent; never the bibliography or the manuscript.
- **The explain-service** (`src/explain-server.ts`, new `citecheck-explain-server`
  bin) — a tiny HTTP endpoint (`POST /explain`, `GET /health`, optional bearer
  token) that holds the key and calls Claude. `explain-service/` ships a
  Dockerfile, a docker-compose, and a Portainer deploy guide for the QNAP.

## [1.1.0] - 2026-07-11 — Houston Methodist edition

Answers the "okay, so what do we do with this?" question. Every run now produces
a plain-language **analysis** — not just per-reference verdicts — that says what
the results mean and what to do about them. Deterministic (no AI); a Claude-
written narrative layer is planned as an opt-in follow-up.

### Added

- **Analysis engine** (`src/analysis.ts`): root-causes the results into buckets
  (verified, verified-despite-1-year-gap, found-with-minor-mismatch, not-found,
  retracted, couldn't-reach), computes the DOI-bearing found rate, and generates
  a plain-language "what this means" + "what to do" with the short list that
  actually needs attention (retracted and not-found first).
- **Three report outputs** (chosen in the wizard):
  - **On-screen** — the analysis printed in the terminal after a run.
  - **Excel workbook** (`.xlsx` via exceljs) — a **Summary** tab (the analysis),
    an **All references** tab as a filterable Excel Table (sort/filter to find the
    troublemakers), and a **Needs a look** tab with only the flagged rows. Status
    is color-coded; a "Needs attention" column filters to retracted/not-found.
  - **One-page HTML report** — print-to-PDF, leadership-ready (headline, stat
    tiles, what-it-means, what-to-do, and the flagged table).
- The wizard's output menu is now "Everything / Excel / Report / On-screen".

## [1.0.5] - 2026-07-11 — Houston Methodist edition

### Added

- **Verbose "watch it work" mode** (`--verbose` / `-V`): streams one line per
  reference as it's checked — a running counter, a colored status glyph, the
  title, and a retracted flag — instead of the quiet progress counter. On a big
  catalog the lines fly by, which reads well in a demo. The wizard adds a "While
  it checks" choice (live stream vs quiet bar).
- `quickCheck` / `checkDocument` gained an `onResult` callback (fires per
  reference, in order) alongside the existing `onProgress`.

## [1.0.4] - 2026-07-11 — Houston Methodist edition

Reworks the wizard's file selection for arrow-key navigation and, importantly,
privacy: it no longer auto-scans Downloads and Desktop and dump every file
title. That matters when demoing to someone who shouldn't see unrelated,
not-yet-ready work.

### Changed

- **Arrow-key file browser.** Instead of listing files from several folders at
  once, the wizard opens a browser in a single folder that you navigate with the
  arrow keys (↑/↓ to move, Enter to open a folder or pick a file, a ".." entry to
  go up, plus "type a path" and "go home"). Only the folder you're in is ever
  read, so nothing from elsewhere is surfaced on screen.
- **Remembered folder.** The folder you last picked a file from is saved to
  `~/.config/citecheck/config.json` and the browser reopens there next time, so
  you can point it at a safe, curated folder once and stay there.
- The wizard's option prompts (output format, year matching, email) are now
  arrow-key menus too, via `@inquirer/select` / `@inquirer/input`.
- The wizard requires an interactive terminal; scripted/piped use should pass a
  file directly (`citecheck <file>`), which is unchanged.

## [1.0.3] - 2026-07-11 — Houston Methodist edition

Fixes the "Could not reach Crossref — re-run" noise seen when checking a large
catalog without the polite-pool email set. Those were transient rate-limit
failures (correctly reported as "check failed", never "not found"), but they
made a clean run look messy.

### Added

- **Remembered polite-pool email.** The wizard asks for it once (framed as
  optional, never shared, no mail sent) and saves it to
  `~/.config/citecheck/config.json`; `--mailto` also persists it. Every later
  run — wizard or direct — then uses it automatically, so Crossref/PubMed grant
  the faster, kinder rate limits and the transient failures largely disappear.

### Changed

- **Hardened retry/backoff.** Transient 429/5xx responses now honor a
  `Retry-After` header when present, and otherwise back off exponentially with
  jitter across a few attempts before giving up.

## [1.0.2] - 2026-07-11 — Houston Methodist edition

Usability release aimed at a non-technical demo: run `citecheck` with no
arguments and it walks you through the whole thing.

### Added

- **Guided wizard** (`citecheck` with no file, or `--wizard`/`-w`): lists the
  bibliography files in the current folder, Downloads, and Desktop; lets you pick
  one (or paste a path); asks how you want the results (Excel spreadsheet or an
  on-screen list of problems) and whether to use normal or strict year matching;
  then runs and, for the spreadsheet option, writes the CSV next to your file and
  opens it. Interactive-only; scripts should keep using the flags.
- **Native Pure "Research Output" CSV input.** `citecheck export.csv` now works
  directly — no separate conversion step. A `.csv` is parsed as a Pure export
  (DOI, title, year, authors, journal), deduped by DOI. Includes a small
  RFC-4180 CSV reader (`src/pure-csv.ts`).
- **Live progress indicator** on long runs: a spinner and `checked N / total`
  counter on stderr, so a big catalog never looks frozen. TTY-gated, so it never
  appears in `--json` / `--csv` output or automated pipelines.

### Changed

- The CLI now sets the exit code instead of force-exiting, so a large `--csv`
  piped into another program flushes completely before the process ends.
- `quickCheck` / `checkDocument` accept an optional `onProgress` callback.

## [1.0.1] - 2026-07-11 — Houston Methodist edition

> The Houston Methodist edition versions independently starting at **1.0** (the
> PubMed-complete fork below), derived from upstream
> [tobiasosDev/citecheck](https://github.com/tobiasosDev/citecheck) 1.3.0.

Tuning and usability changes informed by validating the tool against 4,734 real
Houston Methodist Pathology publications (99.9% of DOI-bearing references found,
zero false "not found" on mainstream literature).

### Added

- **`--strict`**: require an exact publication year. Off by default (see below);
  documented as not-recommended because it re-flags many real references.
- **`--csv`**: spreadsheet-friendly per-reference report that opens directly in
  Excel (key, status, retracted, open-access, DOI, PMID, title, notes, source).
- **Retro boot banner** (`src/banner.ts`): an ANSI block wordmark printed on an
  interactive run. Written to stderr and gated on a TTY, so it never contaminates
  `--json` / `--csv` output or automated pipelines.

### Changed

- **±1-year tolerance for DOI/PMID-verified references.** A reference whose
  identifier resolves and whose title and authors match now verifies even when
  its year is off by one, absorbing the routine online-ahead-of-print vs
  issue-date gap. In the full-catalog validation this moved ~200 real papers out
  of the "review" bucket without weakening fabrication detection (a fake still
  fails the title AND author checks). Verified references that used the tolerance
  carry a plain-language note explaining why the year gap is not a concern.
  `--strict` restores exact-year matching.

## [1.4.0-hm.1] - 2026-07-10 — PubMed source (fork of tobiasosDev/citecheck)

Fork of [tobiasosDev/citecheck](https://github.com/tobiasosDev/citecheck) by the
Houston Methodist Department of Pathology & Genomic Medicine, adding **PubMed** as
a fourth verification source for biomedical literature. Re-designated **v1.0** of
the Houston Methodist edition.

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
