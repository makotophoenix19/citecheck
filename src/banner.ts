import { VERSION } from "./http.js";

// ── Retro boot banner ────────────────────────────────────────────────────────
// A wordmark in the ANSI-Shadow block style, assembled from a per-letter glyph
// map so the six rows stay perfectly aligned no matter the letters. Printed to
// stderr on an interactive run, so it never contaminates --json / --csv on
// stdout, and skipped entirely when piped or when NO_COLOR is set.

/** 6-row glyphs, pre-aligned; each letter's rows are equal width. */
const GLYPHS: Record<string, string[]> = {
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  H: ["██╗  ██╗", "██║  ██║", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
};

const WORD = "CITECHECK";
const TEAL = "\x1b[38;2;20;160;146m";
const TEAL_DIM = "\x1b[38;2;15;110;101m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Build the 6-row block wordmark (no color). */
function wordmark(): string[] {
  const rows = ["", "", "", "", "", ""];
  for (let i = 0; i < WORD.length; i++) {
    const g = GLYPHS[WORD[i]!]!;
    const gap = i === 0 ? "" : " ";
    for (let r = 0; r < 6; r++) rows[r] += gap + g[r];
  }
  return rows;
}

/** Width of the block wordmark in columns. */
function wordmarkWidth(): number {
  return wordmark()[0]!.length;
}

const TAGLINE = "reference integrity for scholarly manuscripts";
const SOURCES = "crossref · pubmed · openalex · doaj";
const PRIVACY = "no API key · nothing leaves your machine";

/**
 * Render the banner. `color` false strips ANSI (for NO_COLOR); `cols` selects
 * the full block wordmark or a compact boxed fallback on narrow terminals.
 */
export function banner(color: boolean, cols: number): string {
  const c = (code: string, s: string) => (color ? code + s + RESET : s);
  const ver = `v${VERSION}`;

  // Compact fallback for narrow terminals.
  if (cols < wordmarkWidth() + 4) {
    const inner = ` ${c(BOLD + TEAL, "citecheck")} ${c(DIM, "· " + TAGLINE + " · " + ver)} `;
    const line = c(TEAL_DIM, "─".repeat(Math.min(cols - 2, 60)));
    return `\n ${line}\n${inner}\n ${c(DIM, SOURCES)}\n ${line}\n`;
  }

  const pad = "  ";
  const art = wordmark()
    .map((row) => pad + c(TEAL, row))
    .join("\n");
  const w = wordmarkWidth();
  const rule = pad + c(TEAL_DIM, "─".repeat(w));
  // Tagline left, version right, filled to the wordmark width.
  const gap = Math.max(1, w - TAGLINE.length - ver.length);
  const line1 = pad + c(DIM, TAGLINE) + " ".repeat(gap) + c(TEAL, ver);
  const line2 = pad + c(DIM, `${SOURCES}   ·   ${PRIVACY}`);
  return `\n${art}\n${rule}\n${line1}\n${line2}\n`;
}

/** Print the banner to stderr when the session is interactive. No-op when
 * stderr is not a TTY (piped/cron) so automated output stays clean. */
export function printBanner(): void {
  if (!process.stderr.isTTY) return;
  const color = !process.env.NO_COLOR;
  const cols = process.stderr.columns || 80;
  process.stderr.write(banner(color, cols) + "\n");
}
