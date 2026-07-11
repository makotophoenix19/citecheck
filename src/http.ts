import { readFileSync } from "node:fs";

/**
 * Single source of truth for the version. Read from `package.json` (always
 * shipped in the npm tarball, one level up from `dist/`) so the CLI
 * `--version`, the `--help` banner, and the API User-Agent can never drift
 * from the published package version. Falls back to "0.0.0" if it can't be
 * read (e.g. an unusual bundling setup) rather than crashing.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
const REPO = "https://github.com/tobiasosDev/citecheck";

/**
 * Contact address for the CrossRef / OpenAlex "polite pool" (faster, more
 * reliable rate limits). Opt-in via `CITECHECK_MAILTO` or the CLI `--mailto`
 * flag. Never defaults to a hardcoded address — your traffic is yours.
 */
export function politeMailto(): string | undefined {
  const m = process.env.CITECHECK_MAILTO?.trim();
  return m && m.includes("@") ? m : undefined;
}

/**
 * Optional NCBI E-utilities API key (`CITECHECK_NCBI_API_KEY`). PubMed works
 * without one at 3 requests/second; a key raises that to 10/second. Never
 * required — absent, PubMed calls are simply throttled harder.
 */
export function ncbiApiKey(): string | undefined {
  const k = process.env.CITECHECK_NCBI_API_KEY?.trim();
  return k || undefined;
}

/**
 * Strict-year mode (`CITECHECK_STRICT` / CLI `--strict`). Off by default: a
 * reference whose DOI resolves and whose title and authors match is verified
 * even when its year is off by one, because online-ahead-of-print and issue
 * dates routinely differ by a year. Strict mode requires an exact year — more
 * control, but it re-flags many perfectly real references, so it is not the
 * recommended default.
 */
export function strictMode(): boolean {
  const v = process.env.CITECHECK_STRICT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function userAgent(): string {
  const mailto = politeMailto();
  return `citecheck/${VERSION} (+${REPO}${mailto ? `; mailto:${mailto}` : ""})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

/** Exponential backoff with jitter, capped, for transient (429/5xx) retries. */
function backoffMs(attempt: number): number {
  return Math.min(3000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

/**
 * `fetch` with retry on *transient* failures (HTTP 429, 5xx, network errors,
 * timeouts). Rate-limit responses (429/503) honor a `Retry-After` header when
 * present, else back off exponentially. After the retries are exhausted it
 * THROWS, so callers can tell "couldn't reach the API" apart from a definitive
 * answer. A clean response — including a definitive 4xx like 404 — is returned
 * as-is for the caller to interpret.
 */
export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { headers, timeoutMs = 10_000, retries = 3 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`transient HTTP ${res.status}`);
        if (attempt < retries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15_000)
            : backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}
