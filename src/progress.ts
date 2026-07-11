import type { CitationCheckResult } from "./quick-check.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const A = { green: "\x1b[32m", amber: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };

/** One line for the verbose "watch it work" stream: a running counter, a
 * colored status glyph, the title, and a retracted flag. */
export function verboseLine(r: CitationCheckResult, done: number, total: number, color: boolean): string {
  const p = (code: string, s: string) => (color ? code + s + A.reset : s);
  const sym = r.retracted
    ? p(A.red, "⚠")
    : r.status === "verified" ? p(A.green, "✓")
    : r.status === "not_found" ? p(A.red, "✗")
    : r.status === "partial_match" ? p(A.amber, "~")
    : r.status === "suspicious" ? p(A.amber, "?")
    : p(A.dim, "…"); // check_failed
  const counter = `[${String(done).padStart(String(total).length)}/${total}]`;
  const title = (r.title || r.sourceRef || r.key || "").replace(/\s+/g, " ").slice(0, 72);
  const flag = r.retracted ? p(A.red, " RETRACTED") : "";
  return `${p(A.dim, counter)} ${sym} ${title}${flag}`;
}

export interface Progress {
  onProgress: (done: number, total: number) => void;
  done: () => void;
}

/**
 * A live spinner + counter written to stderr, so a long run visibly moves and
 * never looks frozen. TTY-gated: a no-op when stderr is piped/redirected or
 * NO_COLOR is set, so it never leaks into `--json` / `--csv` or automated runs.
 */
export function makeProgress(label = "checking references"): Progress {
  if (!process.stderr.isTTY || process.env.NO_COLOR) {
    return { onProgress: () => {}, done: () => {} };
  }
  let frame = 0;
  const onProgress = (d: number, t: number) => {
    const f = SPIN[frame++ % SPIN.length];
    const pct = t ? Math.round((100 * d) / t) : 0;
    process.stderr.write(`\r  \x1b[38;2;20;160;146m${f}\x1b[0m ${label}… ${d}/${t}  (${pct}%)      `);
  };
  const done = () => process.stderr.write("\r" + " ".repeat(56) + "\r");
  return { onProgress, done };
}
