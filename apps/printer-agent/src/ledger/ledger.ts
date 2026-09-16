import { DatabaseSync } from "node:sqlite";
import { LEDGER_FILE } from "../config/paths.js";

/** §46/9.5/9.10. `job_id` is `PRIMARY KEY` (SQLite's own implicit
 * UNIQUE) -- a second claim attempt for the same job_id is a
 * constraint violation, not a silent duplicate row. `result` stays
 * NULL from the moment a job is claimed until the print outcome is
 * known; 9.10's own Done-when ("killing the agent between ledger-
 * write and submission... produces PRINT_STATUS_UNKNOWN, not a second
 * sheet of paper") depends on this row existing, synchronously
 * committed, *before* the print command is ever issued -- a NULL
 * `result` found on the next startup is exactly what tells 9.11's
 * sweeper "this job's outcome is unknown, do not resubmit."
 *
 * `node:sqlite` (Node's own built-in module, stable in this app's
 * target Node 22+), not `better-sqlite3` -- this dev machine has no
 * Visual Studio C++ toolchain for `better-sqlite3`'s native build, and
 * the built-in module is synchronous (matching the "insert and commit
 * before issuing the print command" requirement) without needing a
 * prebuilt binary bundled per platform/ABI at all, which is strictly
 * better for 13.3's eventual installer besides. */
export type JobResult = "PRINTED" | "FAILED" | "UNKNOWN";

export interface LedgerRow {
  jobId: string;
  orderId: string;
  printerName: string;
  claimedAt: string;
  result: JobResult | null;
  resultAt: string | null;
}

export class JobLedger {
  private readonly db: DatabaseSync;

  constructor(path: string = LEDGER_FILE) {
    this.db = new DatabaseSync(path);
    // WAL + FULL synchronous: every write in this ledger must survive
    // a hard power-off, not just a clean process exit -- that's the
    // entire reason it exists (9.10).
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_ledger (
        job_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        printer_name TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        result TEXT,
        result_at TEXT
      )
    `);
  }

  /** Must complete (this call returning IS the fsync, given the
   * PRAGMAs above) before the caller ever issues the actual print
   * command -- see 9.9/9.10's own SumatraPDF submission step. */
  claim(jobId: string, orderId: string, printerName: string): void {
    const stmt = this.db.prepare(
      "INSERT INTO job_ledger (job_id, order_id, printer_name, claimed_at) VALUES (?, ?, ?, ?)",
    );
    stmt.run(jobId, orderId, printerName, new Date().toISOString());
  }

  recordResult(jobId: string, result: JobResult): void {
    const stmt = this.db.prepare(
      "UPDATE job_ledger SET result = ?, result_at = ? WHERE job_id = ?",
    );
    stmt.run(result, new Date().toISOString(), jobId);
  }

  getByJobId(jobId: string): LedgerRow | null {
    const stmt = this.db.prepare(
      "SELECT job_id, order_id, printer_name, claimed_at, result, result_at FROM job_ledger WHERE job_id = ?",
    );
    const row = stmt.get(jobId) as
      | {
          job_id: string;
          order_id: string;
          printer_name: string;
          claimed_at: string;
          result: JobResult | null;
          result_at: string | null;
        }
      | undefined;
    return row ? toLedgerRow(row) : null;
  }

  /** 9.11's own sweeper reads this on startup -- every claimed job
   * with no recorded result yet is one whose outcome is unknown, the
   * set that must never be silently resubmitted. */
  getUnresolved(): LedgerRow[] {
    const stmt = this.db.prepare(
      "SELECT job_id, order_id, printer_name, claimed_at, result, result_at FROM job_ledger WHERE result IS NULL",
    );
    const rows = stmt.all() as Array<{
      job_id: string;
      order_id: string;
      printer_name: string;
      claimed_at: string;
      result: JobResult | null;
      result_at: string | null;
    }>;
    return rows.map(toLedgerRow);
  }

  /** 11.6: deletes only rows that are genuinely done and definitive
   * (PRINTED or FAILED) with `result_at` older than `retentionMs` --
   * deliberately excludes both NULL (still in-flight, or will become
   * UNKNOWN on the next startup sweep) and UNKNOWN itself. An UNKNOWN
   * row means "we told the backend the outcome was unresolved," and
   * this process has no way to learn afterward whether a human at the
   * shop ever actually resolved it (§47/10.3's own resolution flow
   * lives entirely server-side) -- so an UNKNOWN row is the one piece
   * of local evidence this agent can offer if that print is ever
   * disputed later, and it is never pruned by age alone. Returns the
   * number of rows removed. */
  pruneOldResolved(retentionMs: number): number {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    const stmt = this.db.prepare(
      "DELETE FROM job_ledger WHERE result IN ('PRINTED', 'FAILED') AND result_at < ?",
    );
    const result = stmt.run(cutoff);
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }
}

function toLedgerRow(row: {
  job_id: string;
  order_id: string;
  printer_name: string;
  claimed_at: string;
  result: JobResult | null;
  result_at: string | null;
}): LedgerRow {
  return {
    jobId: row.job_id,
    orderId: row.order_id,
    printerName: row.printer_name,
    claimedAt: row.claimed_at,
    result: row.result,
    resultAt: row.result_at,
  };
}
