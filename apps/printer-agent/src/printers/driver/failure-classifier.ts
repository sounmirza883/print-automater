export type FailureSafety = "safe" | "unsafe";

interface ExecFileErrorLike {
  code?: string | number;
  signal?: string | null;
  killed?: boolean;
}

/** §110/10.2. Node's `child_process.execFile` (what sumatra-driver.ts
 * calls) throws differently depending on how far the attempt got:
 *
 * - A **spawn-level** failure (ENOENT, EACCES, ...) carries a *string*
 *   error code -- the OS never started SumatraPDF.exe at all, so
 *   nothing could possibly have reached a spooler. Safe to auto-retry.
 * - A **timeout** (this app's own `timeout` option firing) sets
 *   `killed: true` with a `signal` -- the process *was* running and
 *   was killed mid-flight, by which point it may already have handed
 *   the job to the spooler. Unsafe.
 * - A **non-zero exit** carries a *numeric* error code -- the process
 *   ran to completion and failed, but the exit code alone can't say
 *   whether that was before or after reaching the spooler (§17's own
 *   named risk: driver behavior is inconsistent across printers).
 *   Unsafe.
 *
 * Any other/unrecognized shape defaults to unsafe too -- the one
 * direction that can never itself cause a duplicate print, matching
 * 9.6's own "default to the safer-to-be-wrong-in direction" precedent. */
export function classifyPrintFailure(error: unknown): FailureSafety {
  if (typeof error !== "object" || error === null) {
    return "unsafe";
  }
  const err = error as ExecFileErrorLike;

  if (err.killed === true || Boolean(err.signal)) {
    return "unsafe";
  }
  if (typeof err.code === "string") {
    return "safe";
  }
  return "unsafe";
}
