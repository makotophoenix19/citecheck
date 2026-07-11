import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Tiny persisted config at ~/.config/citecheck/config.json. Currently just the
 * polite-pool email, so a user sets it once and every later run automatically
 * gets Crossref/PubMed's faster, kinder rate limits.
 */
interface Config { mailto?: string }

function dir(): string {
  return join(homedir(), ".config", "citecheck");
}
function file(): string {
  return join(dir(), "config.json");
}

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Config;
  } catch {
    return {};
  }
}

export function saveMailto(mailto: string): void {
  try {
    mkdirSync(dir(), { recursive: true });
    const cfg = loadConfig();
    cfg.mailto = mailto;
    writeFileSync(file(), JSON.stringify(cfg, null, 2) + "\n");
  } catch {
    /* non-fatal: a run without persistence still works */
  }
}
