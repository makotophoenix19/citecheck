const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
