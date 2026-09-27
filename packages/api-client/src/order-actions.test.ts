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

  it("steers a failed quality check toward reprint until the order is completed", () => {
    expect(
      shouldSteerToReprint({ qualityCheckStatus: "FAILED", orderStatus: "PRINT_FAILED" }),
    ).toBe(true);
    expect(shouldSteerToReprint({ qualityCheckStatus: "FAILED", orderStatus: "COMPLETED" })).toBe(
      false,
    );
  });
});
