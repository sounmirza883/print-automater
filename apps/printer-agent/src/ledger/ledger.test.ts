import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TMP_DIR } from "../config/paths.js";
import { JobLedger } from "./ledger.js";

/** 11.6's own Done-when, the ledger half: "ledger rows pruned after a
 * retention window while preserving unresolved unknown-state
 * entries." */
describe("JobLedger.pruneOldResolved (11.6)", () => {
  const ledgerPaths: string[] = [];

  afterAll(() => {
    for (const path of ledgerPaths) {
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  });

  const paths = new Map<JobLedger, string>();

  function newLedger(): JobLedger {
    const path = join(TMP_DIR, `ledger-prune-test-${randomUUID()}.sqlite`);
    ledgerPaths.push(path);
    const ledger = new JobLedger(path);
    paths.set(ledger, path);
    return ledger;
  }

  // Backdates result_at via a second, short-lived raw connection to the
  // same file -- JobLedger's own public API always stamps "now," so a
  // test proving age-based pruning has to reach past it, the same way
  // 5.6/10.5/11.4/11.5's own e2e specs backdate updated_at to simulate
  // elapsed time without an actual wait.
  function backdateResult(ledger: JobLedger, jobId: string, daysAgo: number): void {
    const path = paths.get(ledger)!;
    const raw = new DatabaseSync(path);
    const iso = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    raw.prepare("UPDATE job_ledger SET result_at = ? WHERE job_id = ?").run(iso, jobId);
    raw.close();
  }

  const DAY_MS = 86_400_000;

  it("prunes a PRINTED row older than the retention window", () => {
    const ledger = newLedger();
    const jobId = randomUUID();
    ledger.claim(jobId, "order-1", "Printer A");
    ledger.recordResult(jobId, "PRINTED");
    backdateResult(ledger, jobId, 999);

    const removed = ledger.pruneOldResolved(30 * DAY_MS);

    expect(removed).toBe(1);
    expect(ledger.getByJobId(jobId)).toBeNull();
    ledger.close();
  });

  it("prunes a FAILED row older than the retention window", () => {
    const ledger = newLedger();
    const jobId = randomUUID();
    ledger.claim(jobId, "order-1", "Printer A");
    ledger.recordResult(jobId, "FAILED");
    backdateResult(ledger, jobId, 999);

    const removed = ledger.pruneOldResolved(30 * DAY_MS);

    expect(removed).toBe(1);
    expect(ledger.getByJobId(jobId)).toBeNull();
    ledger.close();
  });

  it("leaves a resolved row inside the retention window untouched", () => {
    const ledger = newLedger();
    const jobId = randomUUID();
    ledger.claim(jobId, "order-1", "Printer A");
    ledger.recordResult(jobId, "PRINTED");
    backdateResult(ledger, jobId, 1);

    const removed = ledger.pruneOldResolved(30 * DAY_MS);

    expect(removed).toBe(0);
    expect(ledger.getByJobId(jobId)).not.toBeNull();
    ledger.close();
  });

  it("11.6's own Done-when: an UNKNOWN row survives pruning no matter how old", () => {
    const ledger = newLedger();
    const jobId = randomUUID();
    ledger.claim(jobId, "order-1", "Printer A");
    ledger.recordResult(jobId, "UNKNOWN");
    backdateResult(ledger, jobId, 999);

    const removed = ledger.pruneOldResolved(30 * DAY_MS);

    expect(removed).toBe(0);
    expect(ledger.getByJobId(jobId)?.result).toBe("UNKNOWN");
    ledger.close();
  });

  it("a still-unresolved (NULL result) row is never touched by pruning, even if claimed long ago", () => {
    const ledger = newLedger();
    const jobId = randomUUID();
    ledger.claim(jobId, "order-1", "Printer A");

    const removed = ledger.pruneOldResolved(0);

    expect(removed).toBe(0);
    expect(ledger.getByJobId(jobId)?.result).toBeNull();
    ledger.close();
  });
});
