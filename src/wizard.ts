import select from "@inquirer/select";
import input from "@inquirer/input";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { printBanner } from "./banner.js";
import { detectAndParse } from "./parse-bibliography.js";
import { quickCheck, type CitationCheckResult } from "./quick-check.js";
import { checkDocument } from "./document.js";
import { formatOf } from "./ingest/index.js";
import { toCsv, count } from "./report.js";
import { makeProgress, verboseLine } from "./progress.js";
import { loadConfig, saveMailto, saveStartDir } from "./config.js";
import type { CslItemData } from "./types.js";

// ── small color helpers (for the summary; the menus are styled by Inquirer) ──
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const cc = (code: string, s: string) => (useColor ? `${code}${s}\x1b[0m` : s);
const green = (s: string) => cc("\x1b[32m", s);
const amber = (s: string) => cc("\x1b[33m", s);
const red = (s: string) => cc("\x1b[31m", s);
const dim = (s: string) => cc("\x1b[2m", s);
const bold = (s: string) => cc("\x1b[1m", s);

const READABLE = new Set([".csv", ".bib", ".bibtex", ".ris", ".json", ".docx", ".txt", ".md"]);

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDate(ms: number): string {
  const d = new Date(ms);
  const md = d.toLocaleString("en-US", { month: "short", day: "2-digit" });
  const time = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${md}, ${d.getFullYear()} ${time}`;
}

interface Entry { name: string; path: string; mtime: number; size: number }

/** Directories (for navigation) and readable files in one folder. Dotfiles
 * hidden; folders A→Z; files newest first. Only ever reads the folder you're in. */
function listFolder(folder: string): { dirs: Entry[]; files: Entry[] } {
  const dirs: Entry[] = [];
  const files: Entry[] = [];
  let names: string[] = [];
  try { names = readdirSync(folder); } catch { return { dirs, files }; }
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const p = join(folder, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) dirs.push({ name: n, path: p, mtime: st.mtimeMs, size: 0 });
    else if (st.isFile() && READABLE.has(extname(n).toLowerCase())) files.push({ name: n, path: p, mtime: st.mtimeMs, size: st.size });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => b.mtime - a.mtime);
  return { dirs, files };
}

type Pick =
  | { t: "up" } | { t: "dir"; p: string } | { t: "file"; p: string }
  | { t: "type" } | { t: "home" } | { t: "cancel" };

/** Arrow-key file browser. Starts in `start` and only shows the folder you are
 * in — nothing is auto-scanned from elsewhere. */
async function browseForFile(start: string): Promise<string | null> {
  let folder = existsSync(start) ? start : homedir();
  for (;;) {
    const { dirs, files } = listFolder(folder);
    const parent = dirname(folder);
    const choices: { name: string; value: Pick }[] = [];
    if (parent !== folder) choices.push({ name: "⬆   .. (up a folder)", value: { t: "up" } });
    for (const d of dirs) choices.push({ name: `📁  ${d.name}/`, value: { t: "dir", p: d.path } });
    for (const f of files) choices.push({ name: `📄  ${f.name}   ${humanSize(f.size)} · ${humanDate(f.mtime)}`, value: { t: "file", p: f.path } });
    if (!dirs.length && !files.length) choices.push({ name: dim("(no folders or readable files here)"), value: { t: "up" } });
    choices.push({ name: "⌨   Type a full path instead…", value: { t: "type" } });
    choices.push({ name: "🏠  Go to my home folder", value: { t: "home" } });
    choices.push({ name: "✕   Cancel", value: { t: "cancel" } });

    const pick = await select<Pick>({
      message: `Browse to your file   ${dim(folder)}`,
      choices,
      pageSize: 14,
      loop: false,
    });

    if (pick.t === "up") folder = parent;
    else if (pick.t === "home") folder = homedir();
    else if (pick.t === "dir") folder = pick.p;
    else if (pick.t === "cancel") return null;
    else if (pick.t === "file") return pick.p;
    else if (pick.t === "type") {
      const typed = (await input({ message: "Full path to the file:" })).trim().replace(/^['"]|['"]$/g, "");
      const rp = resolve(typed.replace(/^~(?=\/)/, homedir()));
      if (existsSync(rp) && statSync(rp).isFile()) return rp;
      if (existsSync(rp) && statSync(rp).isDirectory()) folder = rp; // typed a folder → browse it
      // else: not found — fall through and re-show the current folder
    }
  }
}

/** Guided, talkative run: browse to a file, choose options, check with progress. */
export async function runWizard(): Promise<number> {
  printBanner();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("  The guided wizard needs an interactive terminal.\n  To check a file directly:  citecheck <file>\n");
    return 2;
  }

  try {
    // 0 ── polite-pool email (asked once, then remembered) --------------------
    if (!process.env.CITECHECK_MAILTO) {
      const saved = loadConfig().mailto;
      if (saved) process.env.CITECHECK_MAILTO = saved;
      else {
        const email = (await input({
          message: "Your email (optional — for faster rate limits from Crossref/PubMed; never shared, no mail sent):",
          default: "",
        })).trim();
        if (email.includes("@")) { process.env.CITECHECK_MAILTO = email; saveMailto(email); }
      }
    }

    // 1 ── browse to a file ---------------------------------------------------
    const start = loadConfig().startDir || homedir();
    const filePath = await browseForFile(start);
    if (!filePath) { process.stdout.write(dim("\n  Cancelled.\n")); return 0; }
    saveStartDir(dirname(filePath)); // reopen here next time
    process.stdout.write(`  ${green("✓")} ${basename(filePath)}\n`);

    // 2 ── output format ------------------------------------------------------
    const wantExcel = await select<boolean>({
      message: "How would you like the results?",
      choices: [
        { name: "An Excel spreadsheet (recommended)", value: true },
        { name: "On screen — just the problems", value: false },
      ],
    });

    // 3 ── year matching ------------------------------------------------------
    const strict = await select<boolean>({
      message: "Publication-year matching",
      choices: [
        { name: "Normal (recommended — tolerates the usual 1-year online-vs-issue gap)", value: false },
        { name: "Strict (exact year; re-flags many real papers)", value: true },
      ],
    });
    if (strict) process.env.CITECHECK_STRICT = "1";

    // 3b ── how to watch it run ----------------------------------------------
    const live = await select<boolean>({
      message: "While it checks:",
      choices: [
        { name: "Show each reference as it's checked (great for a demo)", value: true },
        { name: "A quiet progress bar", value: false },
      ],
    });

    // 4 ── run ----------------------------------------------------------------
    process.stdout.write("\n" + dim("  Checking against Crossref, PubMed, OpenAlex and DOAJ. Nothing leaves your machine except each reference string.\n\n"));
    const citations = await runCheck(filePath, live);
    if (citations === null) { process.stdout.write(red("  I couldn't find any references in that file.\n")); return 2; }

    // 5 ── report -------------------------------------------------------------
    printSummary(citations, filePath);
    if (wantExcel) {
      const out = join(dirname(filePath), basename(filePath, extname(filePath)) + ".citecheck.csv");
      writeFileSync(out, toCsv(citations));
      process.stdout.write(`\n  ${green("✓")} Spreadsheet saved: ${bold(out)}\n`);
      spawn("open", [out], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
      process.stdout.write(dim("  Opening it for you…\n"));
    } else {
      printIssues(citations);
    }
    process.stdout.write("\n");
    return 0;
  } catch (err) {
    // Ctrl-C / Esc from a prompt throws; treat as a clean cancel.
    if ((err as Error)?.name === "ExitPromptError") { process.stdout.write(dim("\n  Cancelled.\n")); return 0; }
    throw err;
  }
}

async function runCheck(filePath: string, live: boolean): Promise<CitationCheckResult[] | null> {
  // Verbose stream to stdout, or a quiet spinner on stderr.
  const prog = makeProgress();
  const opts = live
    ? { onResult: (r: CitationCheckResult, d: number, t: number) => process.stdout.write("  " + verboseLine(r, d, t, useColor) + "\n") }
    : { onProgress: prog.onProgress };
  const finish = live ? () => {} : prog.done;

  if (formatOf(filePath) !== null) {
    const doc = await checkDocument({ bytes: readFileSync(filePath), filename: filePath }, opts);
    finish();
    return doc.result.citations.length ? doc.result.citations : null;
  }
  const items: CslItemData[] = detectAndParse(filePath, readFileSync(filePath, "utf8"));
  if (!items.length) { finish(); return null; }
  process.stdout.write(dim(`  Found ${items.length} references.\n\n`));
  const result = await quickCheck(items, opts);
  finish();
  return result.citations;
}

function printSummary(citations: CitationCheckResult[], filePath: string): void {
  const s = count(citations);
  const review = s.partial + s.suspicious;
  process.stdout.write(bold(`  Results for ${basename(filePath)}\n`));
  process.stdout.write(`  ${green(s.verified + " verified")}   ${amber(review + " to review")}   ${red(s.notFound + " not found")}`);
  if (s.checkFailed) process.stdout.write(dim(`   ${s.checkFailed} couldn't reach (re-run)`));
  if (s.retracted) process.stdout.write(`   ${red(bold(s.retracted + " RETRACTED"))}`);
  process.stdout.write("\n");
  process.stdout.write(dim(`  ${s.openAccess} open-access · ${s.total} references checked\n`));
}

function printIssues(citations: CitationCheckResult[]): void {
  const flagged = citations.filter((r) => r.status !== "verified" || r.retracted);
  if (!flagged.length) { process.stdout.write("\n" + green("  Everything checked out. No problems found.\n")); return; }
  process.stdout.write("\n" + bold(`  ${flagged.length} to look at:\n`));
  const sym: Record<string, string> = { partial_match: amber("~"), suspicious: amber("?"), not_found: red("✗"), check_failed: dim("…"), verified: green("✓") };
  for (const r of flagged.slice(0, 40)) {
    const flag = r.retracted ? " " + red(bold("⚠ RETRACTED")) : "";
    process.stdout.write(`   ${sym[r.status] ?? "?"}  ${(r.title || r.sourceRef || r.key || "").slice(0, 66)}${flag}\n`);
    if (r.warnings[0]) process.stdout.write(dim(`       ${r.warnings[0]}\n`));
  }
  if (flagged.length > 40) process.stdout.write(dim(`   … and ${flagged.length - 40} more (choose the spreadsheet option to see them all).\n`));
}
