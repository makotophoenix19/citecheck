#!/usr/bin/env node
/**
 * Batch CV parse QA — run the CV parser over a corpus and flag suspicious parses.
 *
 *   node scripts/batch-cv.mjs ~/cv-corpus
 *   node scripts/batch-cv.mjs a.pdf b.docx --refs
 *
 * PARSE ONLY — no network. That is deliberate: every CV-mode bug found so far
 * (bulleted lists fused into one ref; WCM table cells read as references) was a
 * PARSE bug that produced a confident, wrong answer. A verification run would
 * not have caught either, and would cost minutes and API calls per CV. This runs
 * a whole corpus in seconds for free, so it can be rerun on every parser change.
 *
 * The flags below encode the *shape* of a bad parse rather than any single known
 * bug — a CV whose references are 20 chars long is reading table cells, whoever
 * wrote the template.
 *
 * Exit code 1 if anything is flagged, so this can gate a release.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");
const load = (p) => import(pathToFileURL(join(dist, p)).href);

const { extractDocumentText, formatOf } = await load("ingest/index.js");
const { parseCv } = await load("cv-parser.js");
const { MAX_REFS } = await load("document.js");

const args = process.argv.slice(2);
const showRefs = args.includes("--refs");
const inputs = args.filter((a) => !a.startsWith("--"));
if (!inputs.length) {
  console.error("usage: node scripts/batch-cv.mjs <dir|file...> [--refs]");
  process.exit(2);
}

/** Expand a directory into the CV files inside it. */
function expand(p) {
  if (statSync(p).isDirectory()) {
    return readdirSync(p)
      .map((f) => join(p, f))
      .filter((f) => statSync(f).isFile() && formatOf(f) && !basename(f).startsWith("~$"));
  }
  return [p];
}
const files = inputs.flatMap(expand).filter((f) => formatOf(f));

/** Template scaffolding that survived into a "reference" — a parse escaped its section. */
const TEMPLATE = /^(n\/a|dates?\s*\(|title title|name$|institution\/location|site\/position|duplicate table|type of supervision|board \/ organization|journal \/ organization|books? \/ textbooks?|mentoring period|project\/accomplishments)/i;

const median = (ns) => {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Flag the shapes of a broken parse. Each is a symptom we have actually seen, or
 * its near neighbour — kept independent so a new failure trips at least one.
 */
function flagsFor({ refs, sawSections }) {
  const f = [];
  const lens = refs.map((r) => r.text.length);
  const journal = refs.filter((r) => r.type === "journal").length;

  if (!sawSections) f.push("NO-SECTIONS"); // no publication heading recognized at all
  if (refs.length >= MAX_REFS) f.push("TRUNCATED"); // cap hit — real refs may be cut off
  if (lens.some((n) => n > 1200)) f.push("MEGA-REF"); // several refs fused into one
  if (refs.length && median(lens) < 45) f.push("TABLE-CELLS"); // cells, not citations
  if (refs.length && journal === 0) f.push("NO-JOURNAL"); // a CV with zero articles is odd
  if (refs.some((r) => TEMPLATE.test(r.text.trim()))) f.push("TEMPLATE-TEXT");
  if (refs.length > 0 && refs.length < 3) f.push("THIN");
  return f;
}

const rows = [];
for (const file of files) {
  try {
    const bytes = new Uint8Array(readFileSync(file));
    const text = await extractDocumentText({ bytes, filename: file });
    const fmt = formatOf(file);
    const parse = parseCv(text, { reflow: fmt === "pdf" });
    const { refs } = parse;
    const by = { journal: 0, book: 0, presentation: 0, unknown: 0 };
    for (const r of refs) by[r.type]++;
    rows.push({ file: basename(file), fmt, n: refs.length, by, flags: flagsFor(parse), refs });
  } catch (e) {
    rows.push({ file: basename(file), fmt: "?", n: 0, by: {}, flags: ["ERROR: " + e.message], refs: [] });
  }
}

const w = Math.min(46, Math.max(18, ...rows.map((r) => r.file.length)));
const clip = (s) => (s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));
console.log("");
console.log("  " + "CV".padEnd(w) + " fmt   refs   jrnl  book  pres   flags");
console.log("  " + "─".repeat(w + 42));
for (const r of rows) {
  const flags = r.flags.length ? r.flags.join(" ") : "ok";
  console.log(
    "  " + clip(r.file) +
      " " + String(r.fmt).padEnd(5) +
      String(r.n).padStart(5) +
      String(r.by.journal ?? 0).padStart(7) +
      String(r.by.book ?? 0).padStart(6) +
      String(r.by.presentation ?? 0).padStart(6) +
      "   " + flags,
  );
}

const bad = rows.filter((r) => r.flags.length);
console.log("");
console.log(`  ${rows.length} CV(s) · ${rows.length - bad.length} clean · ${bad.length} flagged`);

if (showRefs) {
  for (const r of rows) {
    console.log("\n  === " + r.file + " ===");
    for (const ref of r.refs) console.log("    " + ref.type.padEnd(12) + ref.text.slice(0, 92));
  }
}

// Flagged parses are how both false-PASS bugs would have been caught pre-release.
if (bad.length) {
  console.log("\n  Flagged — inspect with --refs:");
  for (const r of bad) console.log(`    ${r.file}: ${r.flags.join(" ")}`);
  process.exit(1);
}
