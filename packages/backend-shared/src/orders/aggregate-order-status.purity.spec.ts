import { OrderStatus, PrintJobStatus } from "@prisma/client";
import { QualityCheckStatus } from "@print-automated/types";
import { aggregateOrderStatus } from "./aggregate-order-status.js";
import { jobTransitionEdges, PrintJobEvent } from "../print-jobs/print-job-state-machine.js";

const ALL_STATUSES = Object.values(PrintJobStatus);
const ALL_QC = Object.values(QualityCheckStatus);
const ALL_ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));

/** Derived FROM the real transition table (never hand-copied): a hand copy
 * silently ignored 19.4's QUEUED -> WAITING edge, so a new edge could escape
 * every property below. */
const EDGES = jobTransitionEdges();

const JOB_TRANSITION_TARGETS: Record<PrintJobStatus, PrintJobStatus[]> = Object.fromEntries(
  ALL_STATUSES.map((status) => [
    status,
    [...new Set(EDGES.filter((edge) => edge.from === status).map((edge) => edge.to))],
  ]),
) as Record<PrintJobStatus, PrintJobStatus[]>;

/** Events that may lower (or drop out of) an order's progress rank BY DESIGN.
 * Every one needs a justification; anything else must be rank-preserving. */
const RANK_LOWERING_BY_DESIGN: Partial<Record<PrintJobEvent, string>> = {
  SUPERSEDE:
    "staff/automatic reassignment: the old job leaves the live set and a fresh QUEUED successor joins, changing WHICH jobs count, not job progress",
  RESOLVE_RETRY:
    "staff retry of an UNKNOWN job supersedes it and dispatches a replacement (same as SUPERSEDE)",
  CANCEL: "a cancelled job leaves the live set",
  PAUSE: "a deliberate operator hold; escalates to PAUSED attention when all live jobs are paused",
  UNALLOCATE:
    "19.4 failover found no other printer: a QUEUED job returns to WAITING (blocked), so the order honestly drops from QUEUED_FOR_PRINT to PREPARING (nothing is queued for print any more)",
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

  /** 18.15: progress rank PREPARING < QUEUED_FOR_PRINT < ASSIGNED <
   * PRINTING. Property: for every multiset (<=3 jobs) x every QC state
   * x every legal job transition that neither removes the job from the
   * set (CANCELLED, REASSIGNED, PAUSED -- deliberate human/system actions that
   * change WHICH jobs count, not job progress), if the order is a
   * progress state both before AND after, its rank never decreases.
   * DOES cover: the reviewer's flap (PRINTING -> job A PRINTED ->
   * QUEUED_FOR_PRINT) and PRINTED siblings dragging the order back.
   * DOES NOT cover: transitions into/out of attention states (escalation
   * to PAUSED/PRINT_FAILED is legitimate, and PAUSED -> WAITING resume
   * is an attention exit, checked by the other cases), job-set changes
   * (cancel/reassign/retry adding a fresh job), or multi-step paths --
   * it is a one-step property, which composes into any path because each
   * step is checked from every reachable multiset. */
  it("progress-rank monotonicity: PREPARING < QUEUED_FOR_PRINT < ASSIGNED < PRINTING never decreases across a legal non-superseding job transition", () => {
    const RANK: Partial<Record<OrderStatus, number>> = {
      [OrderStatus.PREPARING]: 0,
      [OrderStatus.QUEUED_FOR_PRINT]: 1,
      [OrderStatus.ASSIGNED]: 2,
      [OrderStatus.PRINTING]: 3,
    };
    let checked = 0;
    for (const multiset of multisets) {
      for (const qc of ALL_QC) {
        const before = aggregateOrderStatus(toJobs(multiset), { qualityCheck: qc });
        const beforeRank = before ? RANK[before] : undefined;
        if (beforeRank === undefined) {
          continue;
        }
        for (let i = 0; i < multiset.length; i += 1) {
          for (const edge of EDGES.filter((e) => e.from === multiset[i])) {
            if (edge.event in RANK_LOWERING_BY_DESIGN) {
              continue;
            }
            const target = edge.to;
            const after = [...multiset];
            after[i] = target;
            const result = aggregateOrderStatus(toJobs(after), { qualityCheck: qc });
            const afterRank = result ? RANK[result] : undefined;
            if (afterRank === undefined) {
              continue;
            }
            checked += 1;
            if (afterRank < beforeRank) {
              throw new Error(
                `rank decreased: [${multiset.join(",")}] ${before} -> [${after.join(",")}] ${result}`,
              );
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every event in the real table is either rank-checked above or listed, with a reason, as lowering by design", () => {
    const eventsInTable = new Set(EDGES.map((edge) => edge.event));
    for (const event of Object.values(PrintJobEvent)) {
      // An event with no edge at all would be silently uncovered.
      expect({ event, hasEdge: eventsInTable.has(event) }).toEqual({ event, hasEdge: true });
    }
    for (const event of Object.keys(RANK_LOWERING_BY_DESIGN)) {
      expect(eventsInTable.has(event as PrintJobEvent)).toBe(true);
    }
  });

  it("19.4 UNALLOCATE is real and lowers a lone queued job's order from QUEUED_FOR_PRINT to PREPARING (pinned)", () => {
    expect(EDGES).toContainEqual({ from: "QUEUED", event: "UNALLOCATE", to: "WAITING" });
    const qc = { qualityCheck: QualityCheckStatus.NOT_REQUIRED };
    expect(aggregateOrderStatus(toJobs([PrintJobStatus.QUEUED]), qc)).toBe(
      OrderStatus.QUEUED_FOR_PRINT,
    );
    expect(aggregateOrderStatus(toJobs([PrintJobStatus.WAITING]), qc)).toBe(OrderStatus.PREPARING);
  });

  it("18.15: a PRINTED job among unfinished live jobs keeps the order PRINTING", () => {
    const qc = { qualityCheck: QualityCheckStatus.NOT_REQUIRED };
    for (const other of [PrintJobStatus.QUEUED, PrintJobStatus.CLAIMED, PrintJobStatus.WAITING]) {
      expect(aggregateOrderStatus(toJobs([PrintJobStatus.PRINTED, other]), qc)).toBe(
        OrderStatus.PRINTING,
      );
    }
  });
});
