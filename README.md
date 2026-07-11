# citecheck

[![npm](https://img.shields.io/npm/v/citecheck)](https://www.npmjs.com/package/citecheck)
[![CI](https://github.com/tobiasosDev/citecheck/actions/workflows/ci.yml/badge.svg)](https://github.com/tobiasosDev/citecheck/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> **Fork note.** This is a Houston Methodist Department of Pathology & Genomic
> Medicine fork of [tobiasosDev/citecheck](https://github.com/tobiasosDev/citecheck),
> adding **PubMed** as a fourth source so biomedical references — and the PMIDs
> they carry — verify against the authoritative biomedical index. See
> [CHANGELOG.md](./CHANGELOG.md) for what this fork changes.

**Sanity-check the references in your bibliography before you submit.** Point
citecheck at a `.bib`, `.ris`, or CSL-JSON export and it tells you which
references:

- **don't exist** — no matching record in Crossref, PubMed, or OpenAlex (a wrong
  DOI, a hallucinated reference, a typo in the title), or
- **have been retracted** — flagged via Crossref's *and* PubMed's retraction
  metadata.

It also verifies any **PMID** a reference carries directly against PubMed, and
notes which of your sources sit in **[DOAJ](https://doaj.org/)-listed
open-access journals** — a positive signal, shown inline when present.

No API key. No signup. No account. It only sends each reference's DOI/PMID/title
to public scholarly APIs (Crossref, PubMed, OpenAlex, DOAJ) and prints the
result — nothing is uploaded or stored.

```console
$ npx citecheck references.bib

  ✓  verified     watson1953      Molecular Structure of Nucleic Acids: A Structure for Deoxy…
  ✓  verified     ioannidis2005   Why Most Published Research Findings Are False
       ↳ journal listed in DOAJ (open access)
  ~  partial      wakefield1998   Ileal-lymphoid-nodular hyperplasia, non-specific colitis, a… ⚠ RETRACTED
       ↳ This work has been retracted.
  ✗  not found    fabricated2099  Quantum Entanglement of Bibliographic Phantoms in Non-Exist…

Summary: 2 verified · 1 partial · 1 not found · 0 suspicious · 1 retracted
         1 in DOAJ (open access)
```

(`examples/sample.bib` ships in this repo — clone it and run `npx citecheck
examples/sample.bib`, or just point citecheck at your own Zotero export.)

## Install

Run it once with no install:

```sh
npx citecheck references.bib
```

Or install it globally:

```sh
npm install -g citecheck
citecheck references.bib
```

Requires Node.js 18 or newer.

> Installing from source (`npm install github:tobiasosDev/citecheck`) builds with
> TypeScript on install, so don't pass `--omit=dev` / `NODE_ENV=production`. The
> published npm package ships prebuilt — no build step needed.

## Usage

Run it with **no arguments** for a guided wizard — it opens an arrow-key file
browser (in a folder you choose and it remembers, so nothing from elsewhere is
surfaced), lets you pick a file, and asks how you'd like the results (an Excel
spreadsheet, or an on-screen list of problems):

```sh
citecheck
```

Or check a file directly:

```sh
citecheck <file> [options]
```

`<file>` is a `.bib` / `.bibtex`, `.ris`, or CSL-JSON (`.json`) bibliography —
the kind you get from **Zotero → Export**, Mendeley, EndNote, or any reference
manager — or a Pure **"Research Output" `.csv`** export. Pass `-` to read from
stdin (the format is auto-detected):

```sh
# Zotero: right-click a collection → Export Collection → Better CSL JSON
citecheck my-library.json

# pipe from anywhere
cat refs.bib | citecheck -
```

### Options

| Option | What it does |
| --- | --- |
| `-w, --wizard` | Guided, interactive mode: pick a file, choose options, and run. Also the default when you run `citecheck` with no file. |
| `--json` | Print the full result as JSON (for scripts / CI). |
| `--csv` | Print a spreadsheet-friendly CSV report (opens directly in Excel). |
| `--only-issues` | Hide references that checked out clean. |
| `--strict` | Require an **exact** publication year. **Not recommended:** by default a 1-year gap is tolerated because online-ahead-of-print and issue dates routinely differ, and strict mode re-flags many perfectly real references. |
| `--mailto <email>` | Use the Crossref/OpenAlex/PubMed "polite pool" — faster, kinder rate limits. Also settable via the `CITECHECK_MAILTO` env var. |
| `--no-color` | Disable ANSI colors (also respects `NO_COLOR`). |

> **PubMed rate limits.** PubMed (NCBI E-utilities) is queried without a key at up
> to 3 requests/second. Set `CITECHECK_NCBI_API_KEY` to a
> [free NCBI key](https://www.ncbi.nlm.nih.gov/account/) to raise that to 10/second
> for large bibliographies. citecheck only escalates to a PubMed *search* on a
> Crossref near-miss (and verifies any cited PMID directly), so a normal run makes
> few PubMed calls.
| `-h, --help` | Show help. |
| `-v, --version` | Show the version. |

### Exit codes

citecheck exits non-zero when it finds a problem, so you can wire it into CI or a
pre-submission script:

| Code | Meaning |
| --- | --- |
| `0` | every reference verified, nothing retracted |
| `1` | at least one reference is **not found**, **suspicious**, or **retracted** |
| `2` | usage or file-read error |

## Check a whole document (no .bib needed)

Don't have a reference manager export? Point citecheck at the document itself:

```console
$ npx citecheck thesis.docx
  Detected 24 references in the bibliography — verify this matches your paper.
  Only the reference text is sent to Crossref/PubMed/OpenAlex/DOAJ — your document is never uploaded or stored.

  ✓  verified     #1   Watson & Crick (1953) Molecular Structure of Nucleic Acids…
  ✗  not found    #12  Quantum Entanglement of Bibliographic Phantoms…   ← likely fabricated
  ⚠  retracted    #18  Wakefield et al. (1998) …
```

Supported formats: **`.docx`**, **`.txt`**, **`.md`** (PDF and LaTeX are planned). citecheck locates the
bibliography section (English and German headings), splits it into individual references, and runs the same
existence check used for `.bib`/`.ris`/CSL-JSON. It always prints the **detected count** so you can confirm it
matched your bibliography — segmentation of messy formatting is best-effort.

### Privacy

Text extraction, section location, and segmentation all happen **locally**. Only each **reference string** is
sent to the public scholarly APIs (Crossref, PubMed, OpenAlex, DOAJ). Your document — often unpublished work — is
**never uploaded and never stored**.

## What the verdicts mean

| Verdict | Meaning |
| --- | --- |
| **verified** | A Crossref or PubMed record matches on title, authors, and year (or an exact DOI/PMID resolves with corroborating metadata). |
| **partial** | A record exists but the metadata only partly matches (title or year off) — worth a look, often just a sloppy entry. |
| **not found** | No matching record in Crossref, PubMed, or OpenAlex. Check the DOI/PMID/title. |
| **suspicious** | A record was found, but it matches so poorly it's probably the wrong source. |
| **check failed** | citecheck couldn't reach Crossref for this one (network/rate-limit). It retried; re-run later. This does **not** count as a problem and doesn't affect the exit code. |
| **⚠ RETRACTED** | The work has been retracted (shown on top of any verdict). |

A reference can be **verified** and **retracted** at the same time — it's a real,
findable paper that has since been pulled. When a source's journal is in DOAJ,
citecheck adds an inline *"journal listed in DOAJ (open access)"* note — an
open-access signal, never a warning (most subscription journals, e.g. Nature,
are simply not in DOAJ).

## Programmatic use

citecheck is also a small library:

```ts
import { readFile } from "node:fs/promises";
import { quickCheck, parseBib } from "citecheck";

const items = parseBib(await readFile("references.bib", "utf8"));
const { citations } = await quickCheck(items);

for (const c of citations) {
  if (c.status !== "verified" || c.retracted) {
    console.log(c.key, c.status, c.retracted ? "RETRACTED" : "");
  }
}
```

Exports: `quickCheck`, `parseBib`, `parseRis`, `parseCslJson`, and the
`CslItemData` / `QuickCheckResult` / `CitationCheckResult` types.

## Use it from an AI agent (MCP + Claude Code plugin)

citecheck ships an MCP server so an AI agent can verify sources itself — including
references it just wrote. It exposes three tools:

| Tool | Input | What it does |
| --- | --- | --- |
| `verify_reference` | a reference string, DOI, or title | check ONE citation |
| `check_bibliography` | a `.bib`/`.ris`/CSL-JSON `path` or inline `content` | check a whole export (≤200 refs) |
| `check_document` | a `.docx`/`.txt`/`.md` `path` | extract the bibliography and check it |

Run the server over stdio:

```sh
npx -y --package=citecheck citecheck-mcp
```

(The server bin lives in the `citecheck` package, so `--package=citecheck` is required.)

Set `CITECHECK_MAILTO` in the server's environment to use the Crossref/OpenAlex/PubMed
"polite pool" (faster, kinder rate limits) — e.g. via the `env` block of your
`.mcp.json`. `CITECHECK_NCBI_API_KEY` raises the PubMed rate limit further.

### Claude Code plugin

The repo also ships a Claude Code plugin that wires the MCP server and adds a skill
teaching the agent to verify sources proactively — and to read the verdicts
conservatively (a "not found" is a prompt to look, **not** proof a source is fake).

```text
/plugin marketplace add tobiasosDev/citecheck
/plugin install citecheck@citecheck
```

Same privacy guarantee as the CLI: only each reference string is sent to
Crossref/PubMed/OpenAlex/DOAJ — your document is never uploaded.

## What citecheck does *not* do

citecheck checks that your sources are **real, current, and from sound venues**.
It does **not** read the source and check whether your sentence is actually
*supported* by it — i.e. whether "Smith (2020) found X" is something Smith (2020)
really found. That's a separate, harder problem, and citecheck deliberately
stays out of it.

It's also intentionally conservative: "not found" means citecheck couldn't match
the reference, not that the work definitely doesn't exist (preprints, books,
grey literature, and non-English sources are under-represented in Crossref,
PubMed, and OpenAlex). Use it as a fast first pass, not a final verdict.

## Privacy

citecheck runs entirely on your machine. For each reference it sends the DOI,
PMID, or title to Crossref, PubMed, OpenAlex, and DOAJ to look it up. It writes
nothing to disk, keeps no history, and has no telemetry.

## Acknowledgements

Built on the open scholarly infrastructure that makes this possible:
[Crossref](https://www.crossref.org/), the
[NCBI E-utilities / PubMed](https://www.ncbi.nlm.nih.gov/books/NBK25501/),
[OpenAlex](https://openalex.org/), and the
[Directory of Open Access Journals](https://doaj.org/). Retraction data is
surfaced via Crossref (sourced from [Retraction Watch](https://retractionwatch.com/))
and via PubMed's "Retracted Publication" typing.

## Contributing

Bug reports, real-world bibliographies that segment badly, and improvements to
the matching heuristics are all welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for dev setup and the testing convention, and [CHANGELOG.md](./CHANGELOG.md) for
release notes.

## License

MIT © Tobias Lüscher

---

<sub>Made by the team behind [Acurio](https://acurio.ch), a related hosted tool that also checks whether each cited source actually supports the claim citing it.</sub>
