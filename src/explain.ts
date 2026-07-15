import Anthropic from "@anthropic-ai/sdk";
import type { ExplainInput, CvExplainInput } from "./explain-input.js";

/**
 * The Layer-2 narrative generator: turns the deterministic analysis into a short
 * plain-language briefing, via Claude. Called either directly (when
 * ANTHROPIC_API_KEY is set locally) or by the Tailscale service. Only the
 * aggregate payload (counts + flagged titles) ever reaches this function.
 */

const SYSTEM_MANUSCRIPT = `You are assisting a scientific writer in a hospital Department of Pathology & Genomic Medicine. You are given the computed results of an automated reference-integrity check — a manuscript or a publication catalog whose citations were checked for existence and retraction against Crossref, PubMed, OpenAlex, and DOAJ.

Your reader is department leadership: a department administrator and a physician chair, neither of them technical. Write a brief, plain-language briefing they can read in fifteen seconds.

You are also given an overall verdict — PASS (nothing to do), REVIEW NEEDED (real items to check), or RE-RUN (some references couldn't be reached). Make the briefing consistent with it.

Rules:
- 2 to 4 sentences. No greeting, no sign-off, no bullet points, no markdown, no headings — just the prose.
- On PASS, open with the clear all-clear ("Everything checks out — no action needed") and keep it short.
- On REVIEW NEEDED, lead with what needs attention and what to do about it.
- On RE-RUN, say the check was incomplete for network reasons and to run it again — not a reference problem.
- When there are genuine concerns — retracted papers, or references that could not be matched — name them plainly and say what to do, without alarmism.
- Distinguish real problems from cosmetic ones: publication-year and title-formatting mismatches mean the paper WAS found and are not concerns; do not present them as issues.
- A "not found" is a prompt to check that reference, NOT proof it is fabricated (preprints, books, and non-English work are under-represented in these databases). Phrase it that way.
- Never invent numbers, titles, or facts beyond those provided.
- Write in the calm, precise register of a scientific communications professional. Output only the briefing.`;

const SYSTEM_CV = `You are assisting a scientific writer in a hospital Department of Pathology & Genomic Medicine who edits faculty and trainee CVs. You are given the computed results of checking a CV's publication list: journal articles verified for existence and retraction against Crossref and PubMed, plus counts of book chapters and conference presentations (which are not existence-checked, because conference items are rarely indexed).

Your reader is the writer or the CV owner. Write a brief, plain-language summary they can read in fifteen seconds.

You are given an overall verdict — PASS (every journal article verified), REVIEW NEEDED (some journal articles couldn't be matched, or a retraction), or RE-RUN (network incomplete).

Rules:
- 2 to 4 sentences. No greeting, no sign-off, no bullet points, no markdown — just the prose.
- Open with the overall picture of the record: the number of peer-reviewed articles, and how many are first-author / corresponding-author when notable.
- On PASS, reassure that the journal articles all verify; keep it short.
- On REVIEW NEEDED, name what to confirm (the unmatched journal articles, any retraction) and that a "not found" is a prompt to check the entry, not proof it is fake (small or non-English journals are under-indexed).
- If duplicates are reported, mention that the same work appears in more than one place (often an abstract and its full article) and is worth confirming the counts aren't inflated — this is normal, not an error.
- Book chapters and conference presentations are informational; never describe a missing/unindexed one as a problem.
- Never invent numbers, titles, or facts beyond those provided.
- Write in the calm, precise register of a scientific communications professional. Output only the summary.`;

export async function explainFromInput(input: ExplainInput | CvExplainInput, opts: { model?: string } = {}): Promise<string> {
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from the environment
  const response = await client.messages.create({
    model: opts.model ?? "claude-opus-4-8",
    max_tokens: 1200,
    system: input.kind === "cv" ? SYSTEM_CV : SYSTEM_MANUSCRIPT,
    messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
  });
  let out = "";
  for (const block of response.content) {
    if (block.type === "text") out += block.text;
  }
  return out.trim();
}
