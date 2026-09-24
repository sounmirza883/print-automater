import { OrderStatus } from "@print-automated/types";
import { inFlightLabel, isInFlight } from "./order-status";

describe("order-status", () => {
  it("every OrderStatus has an in-flight decision and label consistent with it", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(typeof isInFlight(status)).toBe("boolean");
      expect(inFlightLabel(status) === null).toBe(!isInFlight(status));
    }
  });

  it("the Phase 18 job-derived statuses poll; QUALITY_CHECK waits for staff", () => {
    expect(isInFlight("PREPARING")).toBe(true);
    expect(isInFlight("ASSIGNED")).toBe(true);
    expect(isInFlight("PAUSED")).toBe(true);
    expect(isInFlight("QUALITY_CHECK")).toBe(false);
  });

  it("an unknown status is not in flight", () => {
    expect(isInFlight("SOMETHING_NEW")).toBe(false);
    expect(inFlightLabel("SOMETHING_NEW")).toBeNull();
  });
});
