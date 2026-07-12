import Anthropic from "@anthropic-ai/sdk";
import type { ExplainInput } from "./explain-input.js";

/**
 * The Layer-2 narrative generator: turns the deterministic analysis into a short
 * plain-language briefing for department leadership, via Claude. Called either
 * directly (when ANTHROPIC_API_KEY is set locally) or by the Tailscale service.
 * Only the aggregate ExplainInput ever reaches this function.
 */

const SYSTEM = `You are assisting a scientific writer in a hospital Department of Pathology & Genomic Medicine. You are given the computed results of an automated reference-integrity check — a manuscript or a publication catalog whose citations were checked for existence and retraction against Crossref, PubMed, OpenAlex, and DOAJ.

Your reader is department leadership: a department administrator and a physician chair, neither of them technical. Write a brief, plain-language briefing they can read in fifteen seconds.

Rules:
- 2 to 4 sentences. No greeting, no sign-off, no bullet points, no markdown, no headings — just the prose.
- Lead with the reassuring bottom line when the results are clean.
- When there are genuine concerns — retracted papers, or references that could not be matched — name them plainly and say what to do, without alarmism.
- Distinguish real problems from cosmetic ones: publication-year and title-formatting mismatches mean the paper WAS found and are not concerns; do not present them as issues.
- A "not found" is a prompt to check that reference, NOT proof it is fabricated (preprints, books, and non-English work are under-represented in these databases). Phrase it that way.
- Never invent numbers, titles, or facts beyond those provided.
- Write in the calm, precise register of a scientific communications professional. Output only the briefing.`;

export async function explainFromInput(input: ExplainInput, opts: { model?: string } = {}): Promise<string> {
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from the environment
  const response = await client.messages.create({
    model: opts.model ?? "claude-opus-4-8",
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
  });
  let out = "";
  for (const block of response.content) {
    if (block.type === "text") out += block.text;
  }
  return out.trim();
}
