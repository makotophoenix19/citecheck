import { extractQueryTitle } from "./references/match.js";

/**
 * CV mode, Phase 2: a richer publication profile. A CV editor wants more than a
 * count — who's the CV owner, how often they're first/corresponding author, and
 * whether the same paper is listed twice (very common: an abstract AND the full
 * article). All heuristic and local; no network.
 */

// A "Surname Initials" author token — capitalized surname followed by 1–3 initials.
const AUTHOR_TOKEN = /\b([A-Z][A-Za-zÀ-ÿ'’-]{1,})\s+(?:[A-Z]\.?){1,3}\b/g;

/** The author region of a citation: everything up to the first ". " that begins
 * the title (or a capped prefix). Keeps title words out of surname extraction. */
function authorRegion(text: string): string {
  const m = text.match(/^(.*?[A-Z])\.\s+(?=[A-Z])/);
  return m ? m[1]! : text.slice(0, 180);
}

/** First-author-first surnames (lowercased) from a citation's author list. */
export function extractSurnames(text: string): string[] {
  const out: string[] = [];
  for (const m of authorRegion(text).matchAll(AUTHOR_TOKEN)) out.push(m[1]!.toLowerCase());
  return out;
}

/** Detect the CV owner: the surname appearing in the most references (a person is
 * an author on all of their own papers). Returns undefined if none is dominant. */
export function detectOwner(refTexts: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of refTexts) {
    for (const s of new Set(extractSurnames(t))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [s, n] of counts) if (n > bestN) { bestN = n; best = s; }
  return best && bestN >= Math.max(3, refTexts.length * 0.3) ? best : undefined;
}

export function isFirstAuthor(text: string, owner: string): boolean {
  const s = extractSurnames(text);
  return s.length > 0 && s[0] === owner;
}

export function isCorresponding(text: string): boolean {
  return /corresponding author/i.test(text);
}

/** Group references by a normalized title key and return titles that appear more
 * than once — likely duplicates (e.g. an abstract and its full article). */
export function findDuplicates(titles: string[]): { title: string; count: number }[] {
  const groups = new Map<string, { title: string; count: number }>();
  for (const raw of titles) {
    const title = raw.trim();
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 10).join(" ");
    if (key.length < 12) continue; // too short to trust as a match key
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { title, count: 1 });
  }
  return [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count);
}

/** Best-available title for one reference (matched title, else parsed from text). */
export function refTitle(matchedTitle: string, sourceRef: string): string {
  return (matchedTitle || extractQueryTitle(sourceRef || "")).trim();
}
