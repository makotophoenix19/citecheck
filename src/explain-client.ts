import type { Analysis } from "./analysis.js";
import type { CvAnalysis } from "./analyze-cv.js";
import { toExplainInput, toCvExplainInput, type ExplainInput, type CvExplainInput } from "./explain-input.js";

/**
 * Endpoint-agnostic narrative fetcher. Same behavior, two routes:
 *   1. CITECHECK_EXPLAIN_URL set → POST the payload to that service (e.g. the
 *      NAS over Tailscale). The API key lives on the service, never here.
 *   2. else ANTHROPIC_API_KEY set → call Claude directly (fast local iteration).
 *   3. neither → return null; the caller keeps the deterministic analysis.
 *
 * Only the aggregate ExplainInput (counts + flagged titles) is ever sent.
 */

export type NarrativeResult = { narrative: string } | { error: string } | null;

export function explainRouteConfigured(): boolean {
  return Boolean(process.env.CITECHECK_EXPLAIN_URL?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}

/** Human-readable description of which route is active (for the wizard prompt). */
export function explainRouteLabel(): string {
  if (process.env.CITECHECK_EXPLAIN_URL?.trim()) return "your explain service";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "Claude (direct)";
  return "";
}

export async function getNarrative(analysis: Analysis): Promise<NarrativeResult> {
  return runExplain(toExplainInput(analysis));
}

/** CV publication-record narrative (same routing, CV-shaped payload + prompt). */
export async function getCvNarrative(analysis: CvAnalysis): Promise<NarrativeResult> {
  return runExplain(toCvExplainInput(analysis));
}

async function runExplain(input: ExplainInput | CvExplainInput): Promise<NarrativeResult> {
  const url = process.env.CITECHECK_EXPLAIN_URL?.trim();
  if (url) {
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const token = process.env.CITECHECK_EXPLAIN_TOKEN?.trim();
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) return { error: `explain service returned HTTP ${res.status}` };
      const data = (await res.json()) as { narrative?: string; error?: string };
      if (data.error) return { error: data.error };
      return data.narrative ? { narrative: data.narrative } : { error: "explain service returned no narrative" };
    } catch (e) {
      return { error: `couldn't reach the explain service — ${(e as Error).message}` };
    }
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    try {
      const { explainFromInput } = await import("./explain.js"); // load the SDK only on this path
      return { narrative: await explainFromInput(input) };
    } catch (e) {
      return { error: `Claude call failed — ${(e as Error).message}` };
    }
  }

  return null;
}
