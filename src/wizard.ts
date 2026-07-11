import * as readline from "node:readline/promises";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, extname, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { printBanner } from "./banner.js";
import { detectAndParse } from "./parse-bibliography.js";
import { quickCheck, type CitationCheckResult } from "./quick-check.js";
import { checkDocument } from "./document.js";
import { formatOf } from "./ingest/index.js";
import { toCsv, count } from "./report.js";
import { makeProgress } from "./progress.js";
import { loadConfig, saveMailto } from "./config.js";
import type { CslItemData } from "./types.js";

// ── small color helpers (interactive only) ──────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `${code}${s}\x1b[0m` : s);
const teal = (s: string) => c("\x1b[38;2;20;160;146m", s);
const green = (s: string) => c("\x1b[32m", s);
const amber = (s: string) => c("\x1b[33m", s);
const red = (s: string) => c("\x1b[31m", s);
const dim = (s: string) => c("\x1b[2m", s);
const bold = (s: string) => c("\x1b[1m", s);

const READABLE = new Set([".csv", ".bib", ".bibtex", ".ris", ".json", ".docx", ".txt", ".md"]);

interface Candidate { path: string; mtime: number; size: number; where: string }

/** Bibliography-ish files in the current folder, ~/Downloads and ~/Desktop, newest first. */
function findCandidates(): Candidate[] {
  const dirs: [string, string][] = [
    [process.cwd(), "here"],
    [join(homedir(), "Downloads"), "Downloads"],
    [join(homedir(), "Desktop"), "Desktop"],
  ];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const [d, where] of dirs) {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (!READABLE.has(extname(n).toLowerCase())) continue;
      const p = join(d, n);
      if (seen.has(p)) continue;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      seen.add(p);
      out.push({ path: p, mtime: st.mtimeMs, size: st.size, where });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDate(ms: number): string {
  const d = new Date(ms);
  // Always show the year — an old export may be exactly the one you want.
  const md = d.toLocaleString("en-US", { month: "short", day: "2-digit" });
  const time = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${md}, ${d.getFullYear()} ${time}`;
}

async function ask(rl: readline.Interface, prompt: string, fallback = ""): Promise<string> {
  try {
    const a = (await rl.question(prompt)).trim();
    return a || fallback;
  } catch {
    return fallback; // stdin closed (e.g. piped input ran out)
  }
}

/** Interactive, talkative run. Walk the user through choosing a file and a few
 * options, then check with a live progress indicator. */
export async function runWizard(): Promise<number> {
  printBanner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // 0 ── polite-pool email (asked once, then remembered) --------------------
    if (!process.env.CITECHECK_MAILTO) {
      const saved = loadConfig().mailto;
      if (saved) {
        process.env.CITECHECK_MAILTO = saved;
      } else {
        process.stdout.write(dim("  One-time setup. Crossref and PubMed give faster, kinder rate limits\n  when they know who's calling — it avoids the odd \"couldn't reach Crossref\".\n"));
        const email = await ask(rl, "  Your email (never shared; no mail is sent; press enter to skip): ");
        if (email && email.includes("@")) {
          process.env.CITECHECK_MAILTO = email;
          saveMailto(email);
          process.stdout.write(green("  ✓ Saved — you won't be asked again.\n"));
        }
        process.stdout.write("\n");
      }
    }

    // 1 ── choose a file ------------------------------------------------------
    process.stdout.write(bold("  Let's check a bibliography.\n\n"));
    const cands = findCandidates();
    let filePath = "";
    if (cands.length) {
      process.stdout.write(dim("  Files I can read, from this folder, Downloads and Desktop:\n\n"));
      const nameWidth = Math.min(52, Math.max(...cands.map((f) => basename(f.path).length)));
      cands.forEach((f, i) => {
        const name = basename(f.path).padEnd(nameWidth);
        const meta = `${humanSize(f.size).padStart(7)}  ${humanDate(f.mtime).padStart(18)}  ${f.where}`;
        process.stdout.write(`   ${teal(String(i + 1).padStart(2))}  ${name}   ${dim(meta)}\n`);
      });
      process.stdout.write("\n");
      const pick = await ask(rl, `  Pick a number ${dim("[1]")}, or paste a full path: `, "1");
      if (/^\d+$/.test(pick) && Number(pick) >= 1 && Number(pick) <= cands.length) {
        filePath = cands[Number(pick) - 1]!.path;
      } else {
        filePath = pick.replace(/^['"]|['"]$/g, "");
      }
    } else {
      filePath = (await ask(rl, "  Paste the full path to a .csv / .bib / .ris / .json / .docx file: ")).replace(/^['"]|['"]$/g, "");
    }
    filePath = resolve(filePath.replace(/^~(?=\/)/, homedir()));
    if (!existsSync(filePath)) {
      process.stdout.write(red(`\n  Can't find that file: ${filePath}\n`));
      return 2;
    }
    process.stdout.write(`\n  ${green("✓")} ${basename(filePath)}\n\n`);

    // 2 ── output format ------------------------------------------------------
    process.stdout.write("  How would you like the results?\n");
    process.stdout.write(`   ${teal("1")}  An Excel spreadsheet ${dim("(recommended)")}\n`);
    process.stdout.write(`   ${teal("2")}  On screen, just the problems\n`);
    const outChoice = await ask(rl, `  Choose ${dim("[1]")}: `, "1");
    const wantExcel = outChoice !== "2";

    // 3 ── year matching ------------------------------------------------------
    process.stdout.write("\n  Publication-year matching:\n");
    process.stdout.write(`   ${teal("1")}  Normal ${dim("(recommended — tolerates the usual online-vs-issue 1-year gap)")}\n`);
    process.stdout.write(`   ${teal("2")}  Strict ${dim("(exact year; re-flags many real papers)")}\n`);
    const yr = await ask(rl, `  Choose ${dim("[1]")}: `, "1");
    if (yr === "2") process.env.CITECHECK_STRICT = "1";

    // 4 ── run ----------------------------------------------------------------
    process.stdout.write("\n" + dim("  Checking against Crossref, PubMed, OpenAlex and DOAJ. Nothing leaves your machine except each reference string.\n\n"));

    const citations = await runCheck(filePath);
    if (citations === null) {
      process.stdout.write(red("  I couldn't find any references in that file.\n"));
      return 2;
    }

    // 5 ── report -------------------------------------------------------------
    printSummary(citations, filePath);

    if (wantExcel) {
      const out = join(dirname(filePath), basename(filePath, extname(filePath)) + ".citecheck.csv");
      writeFileSync(out, toCsv(citations));
      process.stdout.write(`\n  ${green("✓")} Spreadsheet saved: ${bold(out)}\n`);
      try {
        spawn("open", [out], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
        process.stdout.write(dim("  Opening it for you…\n"));
      } catch { /* non-macOS or no opener — the path above is enough */ }
    } else {
      printIssues(citations);
    }
    process.stdout.write("\n");
    return 0;
  } finally {
    rl.close();
  }
}

/** Load a file (CSV/bib/ris/json or docx/txt/md) and check it, with progress. */
async function runCheck(filePath: string): Promise<CitationCheckResult[] | null> {
  const prog = makeProgress();
  const docFormat = formatOf(filePath);
  if (docFormat !== null) {
    const bytes = readFileSync(filePath);
    const doc = await checkDocument({ bytes, filename: filePath }, { onProgress: prog.onProgress });
    prog.done();
    return doc.result.citations.length ? doc.result.citations : null;
  }
  const text = readFileSync(filePath, "utf8");
  const items: CslItemData[] = detectAndParse(filePath, text);
  if (!items.length) { prog.done(); return null; }
  process.stdout.write(dim(`  Found ${items.length} references.\n\n`));
  const result = await quickCheck(items, { onProgress: prog.onProgress });
  prog.done();
  return result.citations;
}

function printSummary(citations: CitationCheckResult[], filePath: string): void {
  const s = count(citations);
  const review = s.partial + s.suspicious;
  process.stdout.write(bold(`  Results for ${basename(filePath)}\n`));
  process.stdout.write(`  ${green(String(s.verified) + " verified")}   ${amber(String(review) + " to review")}   ${red(String(s.notFound) + " not found")}`);
  if (s.retracted) process.stdout.write(`   ${red(bold(String(s.retracted) + " RETRACTED"))}`);
  process.stdout.write("\n");
  if (s.openAccess) process.stdout.write(dim(`  ${s.openAccess} open-access · `));
  else process.stdout.write("  ");
  process.stdout.write(dim(`${s.total} references checked\n`));
}

function printIssues(citations: CitationCheckResult[]): void {
  const flagged = citations.filter((r) => r.status !== "verified" || r.retracted);
  if (!flagged.length) {
    process.stdout.write("\n" + green("  Everything checked out. No problems found.\n"));
    return;
  }
  process.stdout.write("\n" + bold(`  ${flagged.length} to look at:\n`));
  const sym: Record<string, string> = { partial_match: amber("~"), suspicious: amber("?"), not_found: red("✗"), check_failed: dim("…"), verified: green("✓") };
  for (const r of flagged.slice(0, 40)) {
    const flag = r.retracted ? " " + red(bold("⚠ RETRACTED")) : "";
    const title = (r.title || r.sourceRef || r.key || "").slice(0, 68);
    process.stdout.write(`   ${sym[r.status] ?? "?"}  ${title}${flag}\n`);
    if (r.warnings[0]) process.stdout.write(dim(`       ${r.warnings[0]}\n`));
  }
  if (flagged.length > 40) process.stdout.write(dim(`   … and ${flagged.length - 40} more (choose the spreadsheet option to see them all).\n`));
}
