import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";

const execFileAsync = promisify(execFile);

export interface QueueSnapshot {
  jobId: number;
  status: string;
  jobStatus: string;
  pagesPrinted: number;
  totalPages: number | null;
}

interface RawQueueSnapshot {
  JobId: number;
  Status: string | null;
  JobStatus: string | null;
  PagesPrinted: number;
  TotalPages: number | null;
}

/** WQL's own escaping for a string literal inside a `LIKE` clause:
 * `'` doubles (standard SQL-family escaping), and `%`/`_` -- LIKE's
 * own wildcard characters -- are bracket-escaped so a printer name
 * that happens to contain either is matched literally, not as a
 * pattern. Printer names reach this from 9.6's own WMI discovery, not
 * untrusted user input, but building any WQL filter string by
 * concatenation without escaping it is the wrong habit to establish
 * even so. */
function escapeWqlLike(value: string): string {
  return value.replace(/'/g, "''").replace(/%/g, "[%]").replace(/_/g, "[_]");
}

/** §9.11. `Win32_PrintJob.Name` is `"<queue name>, <job id>"` --
 * `LIKE '<printer>%'` is the only way to scope the query to one
 * printer's own jobs, since JobId alone is only unique per queue, not
 * globally. Returns `null` (never `[]`) when the query itself fails --
 * `[]` must mean ONLY "confirmed: this printer has no active jobs
 * right now," since print-job-tracker.ts reads a tracked job's absence
 * from a snapshot as "it finished." Collapsing a transient PowerShell
 * hiccup into the same `[]` would make a monitoring blip
 * indistinguishable from a real completion -- a false PRINTED for a
 * job that's still sitting in the queue. */
export async function queryPrintJobs(
  printerName: string,
  logger: pino.Logger,
): Promise<QueueSnapshot[] | null> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$jobs = Get-CimInstance Win32_PrintJob -Filter "Name LIKE '${escapeWqlLike(printerName)}%'" | Select-Object JobId, Status, JobStatus, PagesPrinted, TotalPages
ConvertTo-Json -InputObject @($jobs) -Depth 5 -Compress
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const parsed: RawQueueSnapshot | RawQueueSnapshot[] = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      jobId: row.JobId,
      status: row.Status ?? "",
      jobStatus: row.JobStatus ?? "",
      pagesPrinted: row.PagesPrinted,
      totalPages: row.TotalPages,
    }));
  } catch (err) {
    logger.warn(
      { err, printerName },
      "print queue query failed -- this poll yields no information",
    );
    return null;
  }
}
