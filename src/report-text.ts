import type { Analysis } from "./analysis.js";

/** Render the analysis as a colored terminal block: headline, what it means,
 * what to do, and the short list of items that actually need attention. */
export function renderAnalysisText(a: Analysis, color: boolean): string {
  const p = (code: string, s: string) => (color ? `${code}${s}\x1b[0m` : s);
  const bold = (s: string) => p("\x1b[1m", s);
  const dim = (s: string) => p("\x1b[2m", s);
  const teal = (s: string) => p("\x1b[38;2;20;160;146m", s);
  const green = (s: string) => p("\x1b[32m", s);
  const red = (s: string) => p("\x1b[31m", s);

  // Hanging-indent bullet: `marker` is the plain marker (for width), rendered
  // with `paint`; continuation lines align under the text.
  const bullet = (marker: string, text: string, paint: (s: string) => string): string => {
    const prefixLen = 3 + marker.length + 1; // "   " + marker + " "
    const indent = " ".repeat(prefixLen);
    const max = Math.max(30, 92 - prefixLen);
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur.length + 1 + w.length > max && cur) { lines.push(cur); cur = w; }
      else cur = cur ? cur + " " + w : w;
    }
    if (cur) lines.push(cur);
    return lines.map((l, i) => (i === 0 ? "   " + paint(marker) + " " : indent) + l).join("\n");
  };

  const out: string[] = [];
  out.push("");
  out.push("  " + teal("─".repeat(60)));
  out.push("  " + bold("What this means"));
  out.push("  " + bold(a.headline));
  out.push("");
  for (const m of a.meaning) out.push(bullet("•", m, teal));
  out.push("");
  out.push("  " + bold("What to do"));
  a.actions.forEach((act, i) => out.push(bullet(`${i + 1}.`, act, teal)));

  const attention = [...a.retracted, ...a.notFound];
  if (attention.length) {
    out.push("");
    out.push("  " + bold(`Needs a look  (${attention.length})`));
    for (const f of attention.slice(0, 25)) {
      const sym = f.retracted ? red("⚠") : red("✗");
      const tag = f.retracted ? red(bold(" RETRACTED")) : "";
      out.push(`   ${sym} ${f.title.slice(0, 66)}${tag}`);
    }
    if (attention.length > 25) out.push(dim(`   … and ${attention.length - 25} more (see the report or spreadsheet).`));
  } else {
    out.push("");
    out.push("  " + green("Nothing needs a look — every reference was located and none were retracted."));
  }
  const cosmetic = a.buckets.yearMismatch + a.buckets.titleMismatch + a.buckets.review;
  if (cosmetic) out.push(dim(`   (${cosmetic} more had minor metadata differences but were found — safe to ignore.)`));
  out.push("  " + teal("─".repeat(60)));
  out.push("");
  return out.join("\n");
}
