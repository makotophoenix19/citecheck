import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Tiny persisted config at ~/.config/citecheck/config.json.
 *   mailto   — polite-pool email, set once for better rate limits.
 *   startDir — the folder the file browser opens in, so it never auto-scans
 *              other locations and reopens where you last worked.
 */
interface Config { mailto?: string; startDir?: string }

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

function save(patch: Partial<Config>): void {
  try {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(file(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2) + "\n");
  } catch {
    /* non-fatal: a run without persistence still works */
  }
}

export function saveMailto(mailto: string): void {
  save({ mailto });
}

export function saveStartDir(startDir: string): void {
  save({ startDir });
}
