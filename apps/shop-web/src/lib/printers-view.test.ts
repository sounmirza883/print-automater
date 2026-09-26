import type { PrinterResponse } from "@print-automated/api-client";
import type { DashboardPrinter } from "@print-automated/types";
import {
  effectiveStatus,
  mergePrinters,
  parsePageLimit,
  supportedCapabilities,
  usageStanding,
} from "./printers-view";

function printer(over: Partial<PrinterResponse> = {}): PrinterResponse {
  return {
    id: "p1",
    shopId: "s1",
    name: "Front A4",
    capabilities: { color: true, duplex: false, a4: true, a3: false },
    status: "ONLINE",
    createdAt: "2026-01-01T00:00:00Z",
    pageLimit: null,
    pageLimitEnabled: false,
    pageLimitPeriod: "DAILY",
    pagesUsedInPeriod: 0,
    remainingAllowance: null,
    ...over,
  };
}

describe("mergePrinters / effectiveStatus", () => {
  it("attaches live data by id and works without it (roles that cannot see the dashboard)", () => {
    const rows = mergePrinters(
      [printer(), printer({ id: "p2" })],
      [{ id: "p2", offline: true } as DashboardPrinter],
    );
    expect(rows[0]?.live).toBeNull();
    expect(rows[1]?.live?.offline).toBe(true);
    expect(mergePrinters([printer()], null)[0]?.live).toBeNull();
  });

  it("shows OFFLINE when the agent went silent even if the stored status still says ONLINE", () => {
    const [row] = mergePrinters([printer()], [{ id: "p1", offline: true } as DashboardPrinter]);
    expect(effectiveStatus(row!)).toEqual({ label: "OFFLINE", offline: true });
    expect(effectiveStatus({ printer: printer(), live: null })).toEqual({
      label: "ONLINE",
      offline: false,
    });
  });
});

describe("usageStanding", () => {
  const limited = (used: number, enabled = true) =>
    printer({ pageLimit: 100, pageLimitEnabled: enabled, pagesUsedInPeriod: used });

  it("is off unless enforcement is enabled and a limit is set", () => {
    expect(usageStanding(printer()).standing).toBe("off");
    expect(usageStanding(limited(500, false)).standing).toBe("off");
  });

  it("grades ok / low / reached and caps the bar at full (a soft cap can overshoot)", () => {
    expect(usageStanding(limited(10)).standing).toBe("ok");
    expect(usageStanding(limited(90)).standing).toBe("low");
    expect(usageStanding(limited(140))).toEqual({ standing: "reached", fraction: 1 });
  });
});

describe("parsePageLimit", () => {
  it("blank clears, whole numbers in range pass, everything else is invalid", () => {
    expect(parsePageLimit("")).toBeNull();
    expect(parsePageLimit(" 250 ")).toBe(250);
    for (const bad of ["0", "-5", "1.5", "abc", "10000001", "1e3", "999999999"]) {
      expect(parsePageLimit(bad)).toBeUndefined();
    }
  });
});

describe("supportedCapabilities", () => {
  it("lists what the printer can do", () => {
    expect(supportedCapabilities({ color: true, duplex: false, a4: true, a3: false })).toEqual([
      "Colour",
      "A4",
    ]);
    expect(supportedCapabilities(null)).toEqual([]);
  });
});
