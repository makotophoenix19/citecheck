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
import { makeProgress, verboseLine } from "./progress.js";
import { loadConfig, saveMailto, saveStartDir } from "./config.js";
import { analyze } from "./analysis.js";
import { renderAnalysisText } from "./report-text.js";
import { renderAnalysisHtml } from "./report-html.js";
import { writeXlsx } from "./report-xlsx.js";
import { getNarrative, explainRouteConfigured, explainRouteLabel } from "./explain-client.js";
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
    const output = await select<"all" | "excel" | "report" | "screen">({
      message: "How would you like the results?",
      choices: [
        { name: "Everything — one-page report + Excel + on-screen (recommended)", value: "all" },
        { name: "Excel workbook (Summary + filterable data + a flagged tab)", value: "excel" },
        { name: "One-page report (opens in your browser; print to PDF)", value: "report" },
        { name: "On screen only", value: "screen" },
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

    // 3a ── optional AI leadership summary (only if a route is configured) ----
    let wantSummary = false;
    if (explainRouteConfigured()) {
      wantSummary = await select<boolean>({
        message: `Add a plain-language leadership summary? (written by ${explainRouteLabel()})`,
        choices: [
          { name: "Yes — add the AI-written summary", value: true },
          { name: "No, just the analysis", value: false },
        ],
      });
    }

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
    const checked = await runCheck(filePath, live);
    if (!checked) { process.stdout.write(red("  I couldn't find any references in that file.\n")); return 2; }

    // 5 ── analysis + (optional) narrative + report ---------------------------
    const analysis = analyze(checked.citations, checked.items);

    let narrative: string | undefined;
    if (wantSummary) {
      process.stdout.write(dim("  Writing the plain-language summary…\n"));
      const r = await getNarrative(analysis);
      if (r && "narrative" in r) narrative = r.narrative;
      else if (r && "error" in r) process.stdout.write(dim(`  (Skipped the AI summary — ${r.error})\n`));
    }

    process.stdout.write(renderAnalysisText(analysis, useColor, narrative)); // the "what it means" always shows

    const base = join(dirname(filePath), basename(filePath, extname(filePath)) + ".citecheck");
    const openFile = (p: string) => spawn("open", [p], { stdio: "ignore", detached: true }).on("error", () => {}).unref();

    if (output === "excel" || output === "all") {
      const p = base + ".xlsx";
      await writeXlsx(checked.citations, analysis, basename(filePath), p, narrative);
      process.stdout.write(`  ${green("✓")} Excel workbook: ${bold(p)}\n`);
      openFile(p);
    }
    if (output === "report" || output === "all") {
      const p = base + ".html";
      writeFileSync(p, renderAnalysisHtml(analysis, basename(filePath), new Date(), narrative));
      process.stdout.write(`  ${green("✓")} One-page report: ${bold(p)}\n`);
      openFile(p);
    }
    if (output !== "screen") process.stdout.write(dim("  Opening it for you…\n"));
    process.stdout.write("\n");
    return 0;
  } catch (err) {
    // Ctrl-C / Esc from a prompt throws; treat as a clean cancel.
    if ((err as Error)?.name === "ExitPromptError") { process.stdout.write(dim("\n  Cancelled.\n")); return 0; }
    throw err;
  }
}

async function runCheck(filePath: string, live: boolean): Promise<{ citations: CitationCheckResult[]; items?: CslItemData[] } | null> {
  // Verbose stream to stdout, or a quiet spinner on stderr.
  const prog = makeProgress();
  const opts = live
    ? { onResult: (r: CitationCheckResult, d: number, t: number) => process.stdout.write("  " + verboseLine(r, d, t, useColor) + "\n") }
    : { onProgress: prog.onProgress };
  const finish = live ? () => {} : prog.done;

  if (formatOf(filePath) !== null) {
    const doc = await checkDocument({ bytes: readFileSync(filePath), filename: filePath }, opts);
    finish();
    return doc.result.citations.length ? { citations: doc.result.citations } : null;
  }
  const items: CslItemData[] = detectAndParse(filePath, readFileSync(filePath, "utf8"));
  if (!items.length) { finish(); return null; }
  process.stdout.write(dim(`  Found ${items.length} references.\n\n`));
  const result = await quickCheck(items, opts);
  finish();
  return { citations: result.citations, items };
}
