import { Permission, UserRole } from "@print-automated/types";
import {
  availableJobActions,
  availableOrderActions,
  capabilityProblems,
  nextDeliveryStatuses,
  shouldSteerToReprint,
} from "./order-actions";
import { serverPermissionsFor } from "@/components/test-role-permissions";

const canAs = (role: UserRole) => {
  const permissions = new Set(serverPermissionsFor(role));
  return (permission: Permission) => permissions.has(permission);
};

const order = (orderStatus: string) => ({ orderStatus }) as never;
const job = (status: string) => ({ status, reprint: null });

describe("order actions by role and state", () => {
  it("lets counter staff accept and reject a waiting order but nothing production-side", () => {
    const actions = availableOrderActions(order("WAITING_FOR_SHOP"), canAs(UserRole.SHOP_COUNTER));
    expect(actions).toMatchObject({
      accept: true,
      reject: true,
      invoice: true,
      qualityCheck: false,
    });
  });

  it("gives an operator no accept/reject/payment/ready/complete (no EDIT_ORDERS) but quality checks", () => {
    const can = canAs(UserRole.OPERATOR);
    expect(availableOrderActions(order("WAITING_FOR_SHOP"), can).accept).toBe(false);
    expect(availableOrderActions(order("PAYMENT_PENDING"), can).recordPayment).toBe(false);
    expect(availableOrderActions(order("PRINTED"), can).markReady).toBe(false);
    expect(availableOrderActions(order("READY_FOR_COLLECTION"), can).complete).toBe(false);
    expect(availableOrderActions(order("QUALITY_CHECK"), can).qualityCheck).toBe(true);
  });

  it("offers each action only in the state where it applies", () => {
    const can = canAs(UserRole.SHOP_OWNER);
    expect(availableOrderActions(order("PRINT_FAILED"), can)).toMatchObject({
      retry: true,
      changePrinter: true,
      accept: false,
    });
    expect(availableOrderActions(order("PRINTED"), can).markReady).toBe(true);
    expect(availableOrderActions(order("READY_FOR_COLLECTION"), can).complete).toBe(true);
    expect(availableOrderActions(order("PAYMENT_PENDING"), can).recordPayment).toBe(true);
    expect(availableOrderActions(order("COMPLETED"), can)).toMatchObject({
      accept: false,
      retry: false,
      complete: false,
    });
  });
});

describe("job actions by role and state", () => {
  const ownerCan = canAs(UserRole.SHOP_OWNER);

  it("offers Assign operator (ASSIGN_JOBS) while a job is being worked on, never once it is done", () => {
    for (const status of ["CREATED", "WAITING", "QUEUED", "CLAIMED", "PRINTING", "PAUSED"]) {
      expect(availableJobActions(job(status), order("PRINTING"), ownerCan).assignOperator).toBe(
        true,
      );
    }
    for (const status of ["PRINTED", "FAILED", "TIMEOUT", "CANCELLED", "UNKNOWN"]) {
      expect(availableJobActions(job(status), order("PRINTING"), ownerCan).assignOperator).toBe(
        false,
      );
    }
    const counterCan = canAs(UserRole.SHOP_COUNTER);
    expect(availableJobActions(job("QUEUED"), order("PRINTING"), counterCan).assignOperator).toBe(
      false,
    );
  });

  it("pauses only queued/waiting jobs and resumes only paused ones", () => {
    expect(availableJobActions(job("QUEUED"), order("PREPARING"), ownerCan)).toMatchObject({
      pause: true,
      resume: false,
    });
    expect(availableJobActions(job("PAUSED"), order("PAUSED"), ownerCan)).toMatchObject({
      pause: false,
      resume: true,
    });
    expect(availableJobActions(job("PRINTING"), order("PRINTING"), ownerCan).pause).toBe(false);
  });

  it("offers the failure-reason picker only on a failed or timed-out job", () => {
    expect(availableJobActions(job("FAILED"), order("PRINT_FAILED"), ownerCan).recordFailure).toBe(
      true,
    );
    expect(availableJobActions(job("TIMEOUT"), order("PRINT_FAILED"), ownerCan).recordFailure).toBe(
      true,
    );
    expect(availableJobActions(job("PRINTED"), order("PRINTED"), ownerCan).recordFailure).toBe(
      false,
    );
  });

  it("keeps reprint to roles holding REPRINT_JOBS: not operators, not the counter", () => {
    const printed = job("PRINTED");
    expect(
      availableJobActions(printed, order("PRINTED"), canAs(UserRole.SHOP_MANAGER)).reprint,
    ).toBe(true);
    expect(
      availableJobActions(printed, order("PRINTED"), canAs(UserRole.PRINTER_MANAGER)).reprint,
    ).toBe(true);
    expect(availableJobActions(printed, order("PRINTED"), canAs(UserRole.OPERATOR)).reprint).toBe(
      false,
    );
    expect(
      availableJobActions(printed, order("PRINTED"), canAs(UserRole.SHOP_COUNTER)).reprint,
    ).toBe(false);
    expect(availableJobActions(printed, order("COMPLETED"), ownerCan).reprint).toBe(false);
  });

  it("gives counter staff no job actions at all, and lets an operator pause but not reprint", () => {
    const counter = canAs(UserRole.SHOP_COUNTER);
    for (const status of ["QUEUED", "PAUSED", "FAILED", "PRINTED"]) {
      expect(
        Object.values(availableJobActions(job(status), order("PAUSED"), counter)),
      ).not.toContain(true);
    }
    expect(
      availableJobActions(job("QUEUED"), order("PREPARING"), canAs(UserRole.OPERATOR)).pause,
    ).toBe(true);
  });

  it("offers resolution of an UNKNOWN job to EDIT_ORDERS roles", () => {
    expect(
      availableJobActions(job("UNKNOWN"), order("PRINT_STATUS_UNKNOWN"), ownerCan).resolveUnknown,
    ).toBe(true);
    expect(
      availableJobActions(job("UNKNOWN"), order("PRINT_STATUS_UNKNOWN"), canAs(UserRole.OPERATOR))
        .resolveUnknown,
    ).toBe(false);
  });
});

describe("shouldSteerToReprint", () => {
  it("steers a failed quality check toward reprint, not retry", () => {
    expect(
      shouldSteerToReprint({ qualityCheckStatus: "FAILED", orderStatus: "PRINT_FAILED" }),
    ).toBe(true);
    expect(shouldSteerToReprint({ qualityCheckStatus: "PASSED", orderStatus: "PRINTED" })).toBe(
      false,
    );
    expect(shouldSteerToReprint({ qualityCheckStatus: null, orderStatus: "PRINT_FAILED" })).toBe(
      false,
    );
  });
});

describe("nextDeliveryStatuses", () => {
  it("offers only forward moves and none once closed", () => {
    expect(nextDeliveryStatuses("PENDING")).toEqual(["OUT_FOR_DELIVERY", "CANCELLED"]);
    expect(nextDeliveryStatuses("OUT_FOR_DELIVERY")).toEqual(["DELIVERED", "FAILED", "CANCELLED"]);
    expect(nextDeliveryStatuses("DELIVERED")).toEqual([]);
  });
});

describe("capabilityProblems", () => {
  const config = {
    pages: { mode: "all" as const },
    copies: 1,
    paperSize: "A3",
    color: "COLOR",
    sides: "DOUBLE",
    orientation: "PORTRAIT",
  };

  it("lists what a printer lacks for this job", () => {
    expect(
      capabilityProblems({ color: false, duplex: false, a4: true, a3: false }, config),
    ).toEqual(["no colour", "no double-sided", "no A3"]);
    expect(capabilityProblems({ color: true, duplex: true, a4: true, a3: true }, config)).toEqual(
      [],
    );
  });

  it("gives no opinion when capabilities are unknown", () => {
    expect(capabilityProblems(null, config)).toEqual([]);
  });
});
