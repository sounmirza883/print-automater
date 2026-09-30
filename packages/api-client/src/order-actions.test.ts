import { Permission } from "@print-automated/types";
import {
  availableJobActions,
  availableOrderActions,
  shouldSteerToReprint,
} from "./order-actions.js";

const holding =
  (...granted: Permission[]) =>
  (permission: Permission) =>
    granted.includes(permission);

describe("shared order/job action rules (23.30)", () => {
  it("offers order actions only with the permission AND in the state where they apply", () => {
    const editor = holding(Permission.EDIT_ORDERS, Permission.VIEW_ORDERS);
    expect(availableOrderActions({ orderStatus: "WAITING_FOR_SHOP" }, editor)).toMatchObject({
      accept: true,
      reject: true,
      markReady: false,
    });
    expect(availableOrderActions({ orderStatus: "WAITING_FOR_SHOP" }, holding()).accept).toBe(
      false,
    );
    expect(
      availableOrderActions({ orderStatus: "QUALITY_CHECK" }, holding(Permission.QUALITY_CHECK))
        .qualityCheck,
    ).toBe(true);
  });

  it("offers record-payment on a QR order resting in UPLOADED (its only way forward), and nowhere else it didn't already apply", () => {
    const editor = holding(Permission.EDIT_ORDERS, Permission.VIEW_ORDERS);
    // A guest's QR order has no payment step of its own: staff take payment at the counter.
    expect(
      availableOrderActions({ orderStatus: "UPLOADED", creationSource: "QR" }, editor)
        .recordPayment,
    ).toBe(true);
    // Still needs EDIT_ORDERS.
    expect(
      availableOrderActions({ orderStatus: "UPLOADED", creationSource: "QR" }, holding())
        .recordPayment,
    ).toBe(false);
    // Exactly as restrictive as before for every non-QR order in UPLOADED (a web order
    // mid-checkout, a counter order) and for an order with no creationSource at all.
    for (const creationSource of ["CUSTOMER_WEB", "COUNTER", undefined] as const) {
      expect([
        creationSource,
        availableOrderActions({ orderStatus: "UPLOADED", creationSource }, editor).recordPayment,
      ]).toEqual([creationSource, false]);
    }
    // PAYMENT_PENDING still offers it whatever the source.
    for (const creationSource of ["CUSTOMER_WEB", "COUNTER", "QR", undefined] as const) {
      expect(
        availableOrderActions({ orderStatus: "PAYMENT_PENDING", creationSource }, editor)
          .recordPayment,
      ).toBe(true);
    }
    // A QR order past UPLOADED is not offered it again (e.g. already paid, or expired).
    for (const orderStatus of ["WAITING_FOR_SHOP", "EXPIRED", "COMPLETED"] as const) {
      expect(
        availableOrderActions({ orderStatus, creationSource: "QR" }, editor).recordPayment,
      ).toBe(false);
    }
  });

  it("offers job actions by status and permission", () => {
    const operator = holding(
      Permission.PAUSE_JOBS,
      Permission.RECORD_JOB_FAILURE,
      Permission.ASSIGN_JOBS,
    );
    const job = (status: string) => ({ status, reprint: null });
    const order = { orderStatus: "PRINTING" as const };
    expect(availableJobActions(job("QUEUED"), order, operator)).toMatchObject({
      pause: true,
      resume: false,
      reassign: true,
    });
    expect(availableJobActions(job("PAUSED"), order, operator).resume).toBe(true);
    expect(availableJobActions(job("FAILED"), order, operator).recordFailure).toBe(true);
    expect(availableJobActions(job("PRINTED"), order, operator).reprint).toBe(false);
  });

  it("offers moving a job only where the API can move it (WAITING, QUEUED), never a claimed one", () => {
    const assigner = holding(Permission.ASSIGN_JOBS);
    const order = { orderStatus: "PRINTING" as const };
    const movable = (status: string) =>
      availableJobActions({ status, reprint: null }, order, assigner).reassign;
    expect(movable("WAITING")).toBe(true);
    expect(movable("QUEUED")).toBe(true);
    for (const status of [
      "CREATED",
      "CLAIMED",
      "PRINTING",
      "PAUSED",
      "FAILED",
      "TIMEOUT",
      "PRINTED",
      "UNKNOWN",
      "REASSIGNED",
    ]) {
      expect([status, movable(status)]).toEqual([status, false]);
    }
  });

  it("steers a failed quality check toward reprint until the order is completed", () => {
    expect(
      shouldSteerToReprint({ qualityCheckStatus: "FAILED", orderStatus: "PRINT_FAILED" }),
    ).toBe(true);
    expect(shouldSteerToReprint({ qualityCheckStatus: "FAILED", orderStatus: "COMPLETED" })).toBe(
      false,
    );
  });
});
