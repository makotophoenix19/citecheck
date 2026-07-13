import type { CvAnalysis } from "./analyze-cv.js";

/** Render a CV publications check as a grouped, colored terminal block. The
 * verdict reflects the journal articles only; books and presentations are
 * shown for information. */
export function renderCvText(a: CvAnalysis, color: boolean): string {
  const p = (code: string, s: string) => (color ? `${code}${s}\x1b[0m` : s);
  const bold = (s: string) => p("\x1b[1m", s);
  const dim = (s: string) => p("\x1b[2m", s);
  const teal = (s: string) => p("\x1b[38;2;20;160;146m", s);
  const green = (s: string) => p("\x1b[32m", s);
  const red = (s: string) => p("\x1b[31m", s);
  const amber = (s: string) => p("\x1b[33m", s);

  const stampColors: Record<string, string> = { pass: "\x1b[42;30m", review: "\x1b[41;97m", rerun: "\x1b[100;97m" };
  const stamp = color ? `${stampColors[a.verdict] ?? ""}  ${a.verdictLabel}  \x1b[0m` : `[ ${a.verdictLabel} ]`;

  const out: string[] = [];
  const rule = "  " + teal("─".repeat(64));
  out.push("");
  out.push("  " + stamp + "  " + bold(a.verdictDetail));
  out.push(rule);

  // Journal articles — the bucket the verdict is built from.
  const j = a.journal;
  out.push("  " + bold(`Peer-reviewed journal articles`) + dim(`  ·  ${j.total} checked`));
  const jline = `     ${green(j.verified + " verified")}` +
    (j.notFound.length ? `   ${red(j.notFound.length + " to confirm")}` : "") +
    (j.mismatch ? `   ${amber(j.mismatch + " minor mismatch")}` : "") +
    (j.unreachable ? `   ${dim(j.unreachable + " couldn't reach")}` : "");
  out.push(jline);
  for (const f of j.notFound.slice(0, 15)) {
    out.push(`       ${red("✗")} ${f.title.slice(0, 62)} ${dim("— confirm manually")}`);
  }
  if (j.notFound.length > 15) out.push(dim(`       … and ${j.notFound.length - 15} more`));

  // Retractions (any type) — always surfaced.
  if (a.retracted.length) {
    out.push("");
    out.push("  " + bold(red(`Retracted  ·  ${a.retracted.length}`)));
    for (const f of a.retracted.slice(0, 10)) out.push(`       ${red("⚠")} ${f.title.slice(0, 62)}`);
  }

  // Book chapters — informational.
  if (a.book.total) {
    out.push("");
    out.push("  " + bold("Book chapters") + dim(`  ·  ${a.book.total}`));
    out.push(dim(`     ${a.book.found} found · ${a.book.notIndexed} not indexed — normal for chapters (informational)`));
  }

  // Presentations — informational, never flagged.
  if (a.presentation.total) {
    out.push("");
    out.push("  " + bold("Conference presentations / abstracts") + dim(`  ·  ${a.presentation.total}`));
    out.push(dim("     not database-verifiable — conference items rarely are (informational)"));
  }

  // Publication profile.
  out.push("");
  out.push("  " + bold("Publication profile"));
  const span = a.profile.yearRange ? ` · span ${a.profile.yearRange[0]}–${a.profile.yearRange[1]}` : "";
  out.push(dim(`     ${a.profile.articles} journal articles · ${a.profile.bookChapters} book chapters · ${a.profile.presentations} presentations${span}`));
  if (a.openAccess) out.push(dim(`     ${a.openAccess} open-access`));

  out.push(rule);
  out.push("");
  return out.join("\n");
}
