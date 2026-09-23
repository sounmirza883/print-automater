import { OrderStatus, PrintJobStatus } from "@prisma/client";
import { QualityCheckStatus } from "@print-automated/types";
import { aggregateOrderStatus } from "./aggregate-order-status.js";

const NOT_REQUIRED = { qualityCheck: QualityCheckStatus.NOT_REQUIRED };

function job(status: PrintJobStatus, required = true) {
  return { status, required };
}

/** 18.2's own Done-when: the three named cases plus the "equal target"
 * no-op case (asserted here at the pure-function level as "the target
 * this function computes given `current`'s own job set is exactly
 * `current`" -- the state-machine-level "therefore no write happens"
 * half of that guarantee is order-state-machine.e2e-spec.ts's job,
 * since it needs a real row to prove no write occurred against). The
 * exhaustive purity/monotonicity matrix over every ≤3-job multiset x
 * 4 QC state is 18.10's own, separate suite -- this file is 18.2's
 * narrower, direct unit coverage. */
describe("aggregateOrderStatus (18.2)", () => {
  it("3 jobs, 1 FAILED => PRINT_FAILED (attention beats everything)", () => {
    const jobs = [
      job(PrintJobStatus.PRINTED),
      job(PrintJobStatus.PRINTING),
      job(PrintJobStatus.FAILED),
    ];
    expect(aggregateOrderStatus(jobs, NOT_REQUIRED)).toBe(OrderStatus.PRINT_FAILED);
  });

  it("2 PRINTED + 1 PRINTING => PRINTING (progress beats completion)", () => {
    const jobs = [
      job(PrintJobStatus.PRINTED),
      job(PrintJobStatus.PRINTED),
      job(PrintJobStatus.PRINTING),
    ];
    expect(aggregateOrderStatus(jobs, NOT_REQUIRED)).toBe(OrderStatus.PRINTING);
  });

  it("all jobs PAUSED => PAUSED", () => {
    const jobs = [job(PrintJobStatus.PAUSED), job(PrintJobStatus.PAUSED)];
    expect(aggregateOrderStatus(jobs, NOT_REQUIRED)).toBe(OrderStatus.PAUSED);
  });

  it("a single job's own status maps 1:1 for the plain single-item case (equivalence with the pre-Phase-18 single-job order)", () => {
    expect(aggregateOrderStatus([job(PrintJobStatus.QUEUED)], NOT_REQUIRED)).toBe(
      OrderStatus.QUEUED_FOR_PRINT,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.CLAIMED)], NOT_REQUIRED)).toBe(
      OrderStatus.ASSIGNED,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.PRINTING)], NOT_REQUIRED)).toBe(
      OrderStatus.PRINTING,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.PRINTED)], NOT_REQUIRED)).toBe(
      OrderStatus.PRINTED,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.FAILED)], NOT_REQUIRED)).toBe(
      OrderStatus.PRINT_FAILED,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.UNKNOWN)], NOT_REQUIRED)).toBe(
      OrderStatus.PRINT_STATUS_UNKNOWN,
    );
  });

  it("calling it again with the SAME job set produces the SAME target every time (the state machine, not this function, is what turns 'target === current' into a no-op)", () => {
    const jobs = [job(PrintJobStatus.PRINTED), job(PrintJobStatus.PRINTED)];
    const first = aggregateOrderStatus(jobs, NOT_REQUIRED);
    const second = aggregateOrderStatus(jobs, NOT_REQUIRED);
    expect(first).toBe(second);
    expect(first).toBe(OrderStatus.PRINTED);
  });

  it("totality: an empty job set (everything superseded/cancelled away) returns null, never throws", () => {
    expect(aggregateOrderStatus([], NOT_REQUIRED)).toBeNull();
    expect(aggregateOrderStatus([job(PrintJobStatus.CANCELLED)], NOT_REQUIRED)).toBeNull();
  });

  it("QC gating: all required jobs printed and QC PENDING => QUALITY_CHECK, not PRINTED", () => {
    expect(
      aggregateOrderStatus([job(PrintJobStatus.PRINTED)], {
        qualityCheck: QualityCheckStatus.PENDING,
      }),
    ).toBe(OrderStatus.QUALITY_CHECK);
  });

  it("QC gating: QC FAILED on an otherwise-fully-printed order => PRINT_FAILED (needs a reprint)", () => {
    expect(
      aggregateOrderStatus([job(PrintJobStatus.PRINTED)], {
        qualityCheck: QualityCheckStatus.FAILED,
      }),
    ).toBe(OrderStatus.PRINT_FAILED);
  });

  it("QC gating: QC PASSED or NOT_REQUIRED both reach PRINTED", () => {
    expect(
      aggregateOrderStatus([job(PrintJobStatus.PRINTED)], {
        qualityCheck: QualityCheckStatus.PASSED,
      }),
    ).toBe(OrderStatus.PRINTED);
    expect(aggregateOrderStatus([job(PrintJobStatus.PRINTED)], NOT_REQUIRED)).toBe(
      OrderStatus.PRINTED,
    );
  });

  it("an optional (non-required) unfinished item does not block completion of the required items", () => {
    const jobs = [job(PrintJobStatus.PRINTED, true), job(PrintJobStatus.PRINTED, false)];
    expect(aggregateOrderStatus(jobs, NOT_REQUIRED)).toBe(OrderStatus.PRINTED);
  });

  it("a single stuck WAITING job (nothing allocated yet) => PREPARING", () => {
    expect(aggregateOrderStatus([job(PrintJobStatus.WAITING)], NOT_REQUIRED)).toBe(
      OrderStatus.PREPARING,
    );
    expect(aggregateOrderStatus([job(PrintJobStatus.CREATED)], NOT_REQUIRED)).toBe(
      OrderStatus.PREPARING,
    );
  });

  it("monotonicity guard: a job progressing elsewhere never displaces an existing FAILED/UNKNOWN job's attention-level verdict", () => {
    const withFailure = [job(PrintJobStatus.FAILED), job(PrintJobStatus.QUEUED)];
    expect(aggregateOrderStatus(withFailure, NOT_REQUIRED)).toBe(OrderStatus.PRINT_FAILED);
    const progressed = [job(PrintJobStatus.FAILED), job(PrintJobStatus.PRINTED)];
    expect(aggregateOrderStatus(progressed, NOT_REQUIRED)).toBe(OrderStatus.PRINT_FAILED);

    const withUnknown = [job(PrintJobStatus.UNKNOWN), job(PrintJobStatus.QUEUED)];
    expect(aggregateOrderStatus(withUnknown, NOT_REQUIRED)).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
    const progressedUnknown = [job(PrintJobStatus.UNKNOWN), job(PrintJobStatus.PRINTED)];
    expect(aggregateOrderStatus(progressedUnknown, NOT_REQUIRED)).toBe(
      OrderStatus.PRINT_STATUS_UNKNOWN,
    );
  });
});
