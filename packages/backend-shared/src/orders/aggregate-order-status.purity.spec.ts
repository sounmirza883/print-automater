import { OrderStatus, PrintJobStatus } from "@prisma/client";
import { QualityCheckStatus } from "@print-automated/types";
import { aggregateOrderStatus } from "./aggregate-order-status.js";

const ALL_STATUSES = Object.values(PrintJobStatus);
const ALL_QC = Object.values(QualityCheckStatus);
const ALL_ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));

/** Independently hand-written here (not imported from
 * print-job-state-machine.ts) -- the same "don't check the
 * implementation against itself" reasoning order-state-machine.e2e-
 * spec.ts's own EXPECTED matrix already established. Every legal
 * TARGET a job of a given status could move to, per JOB_TRANSITIONS. */
const JOB_TRANSITION_TARGETS: Record<PrintJobStatus, PrintJobStatus[]> = {
  CREATED: [PrintJobStatus.QUEUED, PrintJobStatus.WAITING, PrintJobStatus.CANCELLED],
  WAITING: [
    PrintJobStatus.QUEUED,
    PrintJobStatus.WAITING,
    PrintJobStatus.PAUSED,
    PrintJobStatus.CANCELLED,
    PrintJobStatus.REASSIGNED,
  ],
  QUEUED: [
    PrintJobStatus.CLAIMED,
    PrintJobStatus.PRINTED,
    PrintJobStatus.FAILED,
    PrintJobStatus.UNKNOWN,
    PrintJobStatus.TIMEOUT,
    PrintJobStatus.PAUSED,
    PrintJobStatus.CANCELLED,
    PrintJobStatus.REASSIGNED,
  ],
  CLAIMED: [
    PrintJobStatus.PRINTING,
    PrintJobStatus.PRINTED,
    PrintJobStatus.FAILED,
    PrintJobStatus.UNKNOWN,
    PrintJobStatus.TIMEOUT,
    PrintJobStatus.REASSIGNED,
  ],
  PRINTING: [PrintJobStatus.PRINTED, PrintJobStatus.FAILED, PrintJobStatus.UNKNOWN],
  PRINTED: [],
  PAUSED: [PrintJobStatus.WAITING, PrintJobStatus.CANCELLED],
  FAILED: [],
  UNKNOWN: [PrintJobStatus.PRINTED, PrintJobStatus.FAILED],
  TIMEOUT: [],
  CANCELLED: [],
  REASSIGNED: [],
};

/** Every multiset of size 1..maxSize drawn (with repetition, order
 * irrelevant) from ALL_STATUSES -- generated combinatorially, not
 * hand-listed, so nothing is accidentally left out. */
function generateMultisets(maxSize: number): PrintJobStatus[][] {
  const results: PrintJobStatus[][] = [];
  function build(startIndex: number, current: PrintJobStatus[]): void {
    if (current.length > 0) {
      results.push([...current]);
    }
    if (current.length === maxSize) {
      return;
    }
    for (let i = startIndex; i < ALL_STATUSES.length; i += 1) {
      current.push(ALL_STATUSES[i]!);
      build(i, current);
      current.pop();
    }
  }
  build(0, []);
  return results;
}

function toJobs(statuses: PrintJobStatus[]): Array<{ status: PrintJobStatus; required: boolean }> {
  return statuses.map((status) => ({ status, required: true }));
}

/** 18.10's own phase-gate suite (item 2 of 3): the exhaustive purity
 * matrix over every multiset of <= 3 job statuses x every QC state.
 * Totality is what proves aggregateOrderStatus can never crash the
 * request path it's called from; monotonicity is the specific guard
 * against the flapping risk the plan doc names -- a real duplicate-
 * notification bug that would fire genuine customer emails while a
 * test asserting only a final status stays green. */
describe("aggregateOrderStatus exhaustive purity matrix (18.10)", () => {
  const multisets = generateMultisets(3);

  it(`totality over every multiset (n=${multisets.length}) x every QC state (n=${ALL_QC.length}): always a valid OrderStatus or null, never throws/undefined`, () => {
    let casesRun = 0;
    for (const multiset of multisets) {
      for (const qc of ALL_QC) {
        casesRun += 1;
        let result: OrderStatus | null | undefined;
        expect(() => {
          result = aggregateOrderStatus(toJobs(multiset), { qualityCheck: qc });
        }).not.toThrow();
        expect(result === null || ALL_ORDER_STATUSES.has(result as string)).toBe(true);
      }
    }
    // The matrix itself actually ran every cell, not a subset.
    expect(casesRun).toBe(multisets.length * ALL_QC.length);
  });

  it("monotonicity: a FAILED/TIMEOUT-caused PRINT_FAILED verdict survives ANY legal transition of every OTHER job in the multiset (FAILED/TIMEOUT themselves have no legal exit at all -- JOB_TRANSITION_TARGETS is empty for both)", () => {
    let transitionsChecked = 0;
    for (const multiset of multisets) {
      if (!multiset.some((s) => s === PrintJobStatus.FAILED || s === PrintJobStatus.TIMEOUT)) {
        continue;
      }
      for (const qc of ALL_QC) {
        const before = aggregateOrderStatus(toJobs(multiset), { qualityCheck: qc });
        expect(before).toBe(OrderStatus.PRINT_FAILED);

        for (let i = 0; i < multiset.length; i += 1) {
          const current = multiset[i]!;
          if (current === PrintJobStatus.FAILED || current === PrintJobStatus.TIMEOUT) {
            continue;
          }
          for (const target of JOB_TRANSITION_TARGETS[current]) {
            transitionsChecked += 1;
            const after = [...multiset];
            after[i] = target;
            const result = aggregateOrderStatus(toJobs(after), { qualityCheck: qc });
            expect(result).toBe(OrderStatus.PRINT_FAILED);
          }
        }
      }
    }
    expect(transitionsChecked).toBeGreaterThan(0);
  });

  it("monotonicity: an UNKNOWN-caused attention verdict never falls back to a progress/completion status when another job transitions -- it may only ESCALATE (to PRINT_FAILED, if that other job's own transition legally lands it on FAILED/TIMEOUT) or stay PRINT_STATUS_UNKNOWN, never regress. The UNKNOWN job's own RESOLVE_PRINTED/RESOLVE_FAILED is a deliberate, legitimate exit, not flapping, and is intentionally excluded here.", () => {
    const ATTENTION_STATUSES = new Set<OrderStatus>([
      OrderStatus.PRINT_STATUS_UNKNOWN,
      OrderStatus.PRINT_FAILED,
    ]);
    let transitionsChecked = 0;
    for (const multiset of multisets) {
      if (multiset.some((s) => s === PrintJobStatus.FAILED || s === PrintJobStatus.TIMEOUT)) {
        continue; // failure outranks unknown; covered by the case above
      }
      if (!multiset.includes(PrintJobStatus.UNKNOWN)) {
        continue;
      }
      for (const qc of ALL_QC) {
        const before = aggregateOrderStatus(toJobs(multiset), { qualityCheck: qc });
        expect(before).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);

        for (let i = 0; i < multiset.length; i += 1) {
          const current = multiset[i]!;
          if (current === PrintJobStatus.UNKNOWN) {
            continue;
          }
          for (const target of JOB_TRANSITION_TARGETS[current]) {
            transitionsChecked += 1;
            const after = [...multiset];
            after[i] = target;
            const result = aggregateOrderStatus(toJobs(after), { qualityCheck: qc });
            // Still attention-level -- PRINT_FAILED is a legitimate
            // escalation (the transitioned job itself became FAILED/
            // TIMEOUT, a strictly MORE severe signal than UNKNOWN, not
            // a resurrection back to a progress state); anything
            // outside {PRINT_STATUS_UNKNOWN, PRINT_FAILED} would be the
            // real bug this test exists to catch.
            expect(ATTENTION_STATUSES.has(result as OrderStatus)).toBe(true);
          }
        }
      }
    }
    expect(transitionsChecked).toBeGreaterThan(0);
  });
});
