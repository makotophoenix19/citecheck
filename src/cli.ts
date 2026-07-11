#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { quickCheck, type CitationCheckResult } from "./quick-check.js";
import { detectAndParse } from "./parse-bibliography.js";
import { VERSION } from "./http.js";
import { checkDocument, MAX_INPUT_BYTES, tooLargeMessage, type CheckDocumentResult } from "./document.js";
import { formatOf } from "./ingest/index.js";
import { printBanner } from "./banner.js";
import { toCsv } from "./report.js";
import { makeProgress } from "./progress.js";
import { runWizard } from "./wizard.js";

const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code: string, s: string) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);
const red = (s: string) => c("31", s);
const magenta = (s: string) => c("35", s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);

const HELP = `citecheck v${VERSION} — sanity-check a bibliography against Crossref, PubMed, OpenAlex and DOAJ.

Flags references that don't exist or have been retracted, and notes which sources
are published in DOAJ-listed open-access journals. No API key, no signup.

USAGE
  citecheck                  Launch the guided wizard (pick a file, choose options).
  citecheck <file> [options] Check a file directly.

  <file>   A .bib / .bibtex, .ris, CSL-JSON (.json), or Pure "Research Output"
           .csv export, OR a document to extract references from: .docx, .txt, .md.
           Pass "-" to read a bibliography export from stdin (auto-detects format).

OPTIONS
  -w, --wizard      Guided, interactive mode (also the default with no file).
  --json            Print the full result as JSON (for scripts / CI).
  --csv             Print a spreadsheet-friendly CSV report (opens in Excel).
  --only-issues     Hide references that checked out clean.
  --strict          Require an EXACT publication year. NOT recommended: by
                    default a 1-year gap is tolerated because online-ahead-of-
                    print and issue dates routinely differ, and strict mode
                    re-flags many perfectly real references as a result.
  --mailto <email>  Use the Crossref/OpenAlex/PubMed "polite pool" (faster, kinder).
                    Also settable via the CITECHECK_MAILTO env var.
                    (PubMed rate limits lift further with CITECHECK_NCBI_API_KEY.)
  --no-color        Disable ANSI colors (also respects NO_COLOR).
  -h, --help        Show this help.
  -v, --version     Show the version.

EXIT CODE
  0  no problems found (every reference verified, or only partial matches)
  1  at least one reference is not found, suspicious, or retracted
  2  usage / read error
  (references citecheck couldn't reach Crossref for show as "check failed"
   and do not affect the exit code — re-run them.)

EXAMPLES
  citecheck references.bib
  citecheck library.ris --only-issues
  zotero-export.json | citecheck - --json
`;

interface Args {
  file?: string;
  json: boolean;
  csv: boolean;
  onlyIssues: boolean;
  strict: boolean;
  wizard: boolean;
  mailto?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, csv: false, onlyIssues: false, strict: false, wizard: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--json": args.json = true; break;
      case "--csv": args.csv = true; break;
      case "--only-issues": args.onlyIssues = true; break;
      case "--strict": args.strict = true; break;
      case "--wizard": case "-w": args.wizard = true; break;
      case "--no-color": process.env.NO_COLOR = "1"; break;
      case "--mailto": args.mailto = argv[++i]; break;
      case "-h": case "--help": args.help = true; break;
      case "-v": case "--version": args.version = true; break;
      default:
        if (a.startsWith("--mailto=")) args.mailto = a.slice("--mailto=".length);
        else if (!a.startsWith("-") || a === "-") { if (!args.file) args.file = a; }
        break;
    }
  }
  return args;
}


async function readInput(file: string): Promise<string> {
  if (file === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(file, "utf8");
}


const VERDICT = {
  verified: { label: "verified", paint: green, sym: "✓" },
  partial_match: { label: "partial", paint: yellow, sym: "~" },
  not_found: { label: "not found", paint: red, sym: "✗" },
  suspicious: { label: "suspicious", paint: magenta, sym: "?" },
  check_failed: { label: "check failed", paint: dim, sym: "⋯" },
} as const;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// A confirming PubMed hit is a positive signal, shown only when it actually
// corroborated the reference (verified / partial), like the DOAJ line.
function pubmedNote(r: CitationCheckResult): string {
  const pmid = r.pubmedMatch?.pmid;
  if (!pmid || (r.status !== "verified" && r.status !== "partial_match")) return "";
  return "\n" + dim(`       ↳ found in PubMed (PMID ${pmid})`);
}

function renderRow(r: CitationCheckResult, keyWidth: number): string {
  const v = VERDICT[r.status];
  const key = (r.key || "(no key)").padEnd(keyWidth);
  const title = truncate(r.title || dim("(untitled)"), 60);
  const flag = r.retracted ? " " + red(bold("⚠ RETRACTED")) : "";
  const head = `  ${v.paint(v.sym)}  ${v.paint(v.label.padEnd(12))} ${dim(key)}  ${title}${flag}`;
  const notes = r.warnings.length ? "\n" + r.warnings.map((w) => dim("       ↳ " + w)).join("\n") : "";
  // DOAJ listing is a positive, open-access signal — only ever shown, never a warning.
  const doaj = r.journalStatus === "doaj_listed" ? "\n" + dim("       ↳ journal listed in DOAJ (open access)") : "";
  return head + notes + doaj + pubmedNote(r);
}

function renderDocRow(r: CitationCheckResult, index: number): string {
  const v = VERDICT[r.status];
  const num = `#${index}`.padEnd(5);
  const shown = r.title?.trim() ? truncate(r.title, 60) : dim(truncate(r.sourceRef ?? "", 60));
  const flag = r.retracted ? " " + red(bold("⚠ RETRACTED")) : "";
  const head = `  ${v.paint(v.sym)}  ${v.paint(v.label.padEnd(12))} ${dim(num)} ${shown}${flag}`;
  const src = r.sourceRef ? "\n" + dim("       ↳ " + truncate(r.sourceRef, 80)) : "";
  const notes = r.warnings.length ? "\n" + r.warnings.map((w) => dim("       ↳ " + w)).join("\n") : "";
  const doaj = r.journalStatus === "doaj_listed" ? "\n" + dim("       ↳ journal listed in DOAJ (open access)") : "";
  return head + src + notes + doaj + pubmedNote(r);
}

function writeSummaryAndExitCode(citations: CitationCheckResult[], json: boolean): number {
  const counts = {
    verified: 0, partial_match: 0, not_found: 0, suspicious: 0, check_failed: 0,
    retracted: 0, doajListed: 0,
  };
  for (const r of citations) {
    counts[r.status]++;
    if (r.retracted) counts.retracted++;
    if (r.journalStatus === "doaj_listed") counts.doajListed++;
  }
  if (!json) {
    const segments = [
      green(`${counts.verified} verified`),
      yellow(`${counts.partial_match} partial`),
      red(`${counts.not_found} not found`),
      magenta(`${counts.suspicious} suspicious`),
      counts.retracted ? red(bold(`${counts.retracted} retracted`)) : dim(`0 retracted`),
    ];
    if (counts.check_failed) segments.push(dim(`${counts.check_failed} check failed`));
    process.stdout.write("\n" + bold("Summary: ") + segments.join(dim(" · ")) + "\n");
    if (counts.doajListed) process.stdout.write(dim(`         ${counts.doajListed} in DOAJ (open access)\n`));
    if (counts.check_failed) process.stdout.write(dim(`         ${counts.check_failed} could not be checked (network) — re-run\n`));
  }
  return counts.not_found > 0 || counts.suspicious > 0 || counts.retracted > 0 ? 1 : 0;
}

async function runStructured(args: Args): Promise<number> {
  let text: string;
  try {
    text = await readInput(args.file!);
  } catch (err) {
    process.stderr.write(red(`Could not read ${args.file}: ${(err as Error).message}\n`));
    return 2;
  }

  const items = detectAndParse(args.file!, text);
  if (items.length === 0) {
    process.stderr.write(red("No references found. Expected a .bib, .ris, or CSL-JSON bibliography.\n"));
    return 2;
  }

  process.stderr.write(dim(`Checking ${items.length} reference${items.length === 1 ? "" : "s"} against Crossref, PubMed, OpenAlex and DOAJ…\n`));
  const prog = makeProgress();
  const result = await quickCheck(items, { onProgress: prog.onProgress });
  prog.done();

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (args.csv) {
    process.stdout.write(toCsv(result.citations));
  } else {
    const rows = args.onlyIssues
      ? result.citations.filter((r) => r.status !== "verified" || r.retracted)
      : result.citations;
    const keyWidth = Math.min(24, Math.max(8, ...result.citations.map((r) => (r.key || "").length)));
    process.stdout.write("\n");
    if (rows.length === 0) {
      process.stdout.write(dim("  (no issues — every reference checked out)\n"));
    } else {
      for (const r of rows) process.stdout.write(renderRow(r, keyWidth) + "\n");
    }
  }

  return writeSummaryAndExitCode(result.citations, args.json);
}

async function runDocument(args: Args): Promise<number> {
  let bytes: Uint8Array;
  try {
    // Pre-read stat guard: refuse oversized inputs before loading them into
    // memory. Shares MAX_INPUT_BYTES and tooLargeMessage with the library-level
    // guard in document.ts so the limit and wording have one source of truth.
    const info = await stat(args.file!);
    if (info.size > MAX_INPUT_BYTES) {
      process.stderr.write(red(tooLargeMessage(info.size) + "\n"));
      return 2;
    }
    bytes = await readFile(args.file!);
  } catch (err) {
    process.stderr.write(red(`Could not read ${args.file}: ${(err as Error).message}\n`));
    return 2;
  }

  let doc: CheckDocumentResult;
  try {
    process.stderr.write(dim(`Extracting references from ${args.file}…\n`));
    const prog = makeProgress();
    doc = await checkDocument({ bytes, filename: args.file! }, { onProgress: prog.onProgress });
    prog.done();
  } catch (err) {
    process.stderr.write(red(`${(err as Error).message}\n`));
    return 2;
  }

  const { extraction, result } = doc;
  if (result.citations.length === 0) {
    process.stderr.write(red("No references detected in the document.\n"));
    return 2;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return writeSummaryAndExitCode(result.citations, true);
  }

  if (args.csv) {
    process.stdout.write(toCsv(result.citations));
    return writeSummaryAndExitCode(result.citations, true);
  }

  const n = extraction.referencesDetected;
  const checked = extraction.referencesChecked;
  if (extraction.sectionFound) {
    process.stdout.write("\n" + dim(`Detected ${n} reference${n === 1 ? "" : "s"} in the bibliography — verify this matches your paper.\n`));
  } else {
    process.stdout.write("\n" + yellow(`No bibliography heading found — scanned the whole document (low confidence). Detected ${n} candidate reference${n === 1 ? "" : "s"} — verify this matches your paper.\n`));
  }
  if (extraction.truncated) {
    process.stdout.write(yellow(`Too many candidate references — only the first ${checked} of ${n} were checked. The bibliography may not have been isolated; add a "References" heading.\n`));
  }
  process.stdout.write(dim("Only the reference text is sent to Crossref/PubMed/OpenAlex/DOAJ — your document is never uploaded or stored.\n\n"));

  const visible = result.citations
    .map((r, i) => ({ r, i: i + 1 }))
    .filter(({ r }) => !args.onlyIssues || r.status !== "verified" || r.retracted);

  if (visible.length === 0) {
    process.stdout.write(dim("  (no issues — every reference checked out)\n"));
  } else {
    for (const { r, i } of visible) process.stdout.write(renderDocRow(r, i) + "\n");
  }

  return writeSummaryAndExitCode(result.citations, false);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) { process.stdout.write(VERSION + "\n"); return 0; }
  if (args.help) { printBanner(); process.stdout.write(HELP); return 0; }
  if (args.mailto) process.env.CITECHECK_MAILTO = args.mailto;
  if (args.strict) process.env.CITECHECK_STRICT = "1";

  // Guided mode: explicit --wizard, or a bare interactive launch with no file.
  if (args.wizard || (!args.file && process.stdin.isTTY && process.stdout.isTTY)) {
    return runWizard();
  }
  // No file and not interactive (piped/scripted): greet and show usage.
  if (!args.file) { printBanner(); process.stdout.write(HELP); return 0; }

  printBanner();

  if (args.file !== "-" && formatOf(args.file) !== null) {
    return runDocument(args);
  }
  return runStructured(args);
}

// Set the exit code rather than force-exiting, so buffered stdout (e.g. a large
// --csv piped into another program) fully flushes before the process ends.
main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`citecheck: ${(err as Error).stack ?? err}\n`);
    process.exitCode = 2;
  },
);
