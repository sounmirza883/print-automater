import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

/** §41/9.5: config store under `%LOCALAPPDATA%\PrintAutomated` --
 * identity, logs, and the job ledger all live under here, so the
 * whole agent's state is exactly one directory to back up, inspect,
 * or wipe. Falls back to the OS temp dir on non-Windows (this app is
 * Windows-targeted per the plan; the fallback only exists so
 * `pnpm --filter printer-agent typecheck/test` doesn't require a
 * Windows-shaped environment variable to even resolve a path). */
function baseDir(): string {
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData ? join(localAppData, "PrintAutomated") : join(tmpdir(), "PrintAutomated");
}

export const CONFIG_DIR = baseDir();
export const IDENTITY_FILE = join(CONFIG_DIR, "identity.json");
export const LEDGER_FILE = join(CONFIG_DIR, "ledger.sqlite");
export const LOG_DIR = join(CONFIG_DIR, "logs");
export const TMP_DIR = join(CONFIG_DIR, "tmp");

/** Idempotent -- safe to call on every startup, not just first pairing. */
export function ensureConfigDirs(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
}
