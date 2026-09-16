import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type pino from "pino";
import { TMP_DIR } from "../config/paths.js";

/** §68/9.8/11.6. `withJobDocument`'s own `finally` block already
 * deletes a temp file on every *normal* completion of a job -- this
 * function exists for the one case that skips a `finally` entirely: a
 * hard process kill mid-print. Two calling contexts, two different
 * safety rules for the same sweep:
 *
 *   - Startup (`minAgeMs` omitted/0): every file already sitting in
 *     TMP_DIR predates this fresh process -- nothing it has done could
 *     possibly still be using one, the same reasoning
 *     `markUnresolvedAsUnknown` already applies to ledger rows found
 *     at startup. Safe to delete unconditionally, regardless of how
 *     recently it was written (the agent could have been killed and
 *     restarted seconds apart).
 *   - Periodic (`minAgeMs` a real threshold): this process IS actively
 *     writing and deleting files in TMP_DIR as jobs come and go, so an
 *     age floor is what keeps the sweep from racing a job that's
 *     genuinely still mid-print in this very process -- a real print
 *     job's own file lifetime is seconds to a few minutes at most, so
 *     anything older than the threshold is unambiguously orphaned, not
 *     a false positive. */
export async function sweepTempFiles(
  logger: pino.Logger,
  minAgeMs = 0,
  tmpDir: string = TMP_DIR,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(tmpDir);
  } catch (err) {
    logger.warn({ err }, "could not read temp directory for sweep");
    return 0;
  }

  const cutoff = Date.now() - minAgeMs;
  let removed = 0;
  for (const entry of entries) {
    const filePath = join(tmpDir, entry);
    try {
      if (minAgeMs > 0) {
        const stats = await stat(filePath);
        if (stats.mtimeMs > cutoff) {
          continue;
        }
      }
      await rm(filePath, { force: true });
      removed += 1;
      logger.warn({ filePath }, "removed orphaned temp document file");
    } catch (err) {
      logger.warn({ err, filePath }, "failed to remove orphaned temp document file");
    }
  }
  return removed;
}
