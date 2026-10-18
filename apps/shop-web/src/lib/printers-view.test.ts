import type { PrinterResponse } from "@print-automated/api-client";
import type { DashboardPrinter } from "@print-automated/types";
import {
  effectiveStatus,
  mergePrinters,
  moveBranchOptions,
  pairingBranchOptions,
  parsePageLimit,
  printersOnSameComputer,
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

describe("pairingBranchOptions", () => {
  const branches = [
    { id: "a", name: "Main", archivedAt: null },
    { id: "b", name: "Gulberg", archivedAt: null },
    { id: "c", name: "Old Town", archivedAt: "2026-10-05T10:00:00.000Z" },
  ];

  it("offers someone who works at all branches every active branch, and never all branches", () => {
    // A computer sits at one place, so unlike a person it cannot belong to every branch.
    expect(pairingBranchOptions({ branchId: null }, branches)).toEqual([
      { value: "a", label: "Main" },
      { value: "b", label: "Gulberg" },
    ]);
  });

  it("offers a branch-bound person only their own branch", () => {
    expect(pairingBranchOptions({ branchId: "b" }, branches)).toEqual([
      { value: "b", label: "Gulberg" },
    ]);
  });

  it("never offers an archived branch", () => {
    expect(pairingBranchOptions({ branchId: "c" }, branches)).toEqual([]);
  });
});

describe("moveBranchOptions", () => {
  const branches = [
    { id: "a", name: "Main", archivedAt: null },
    { id: "b", name: "Gulberg", archivedAt: null },
    { id: "c", name: "Old Town", archivedAt: "2026-10-05T10:00:00.000Z" },
  ];

  it("offers the other active branches, not the one the computer is already at", () => {
    expect(moveBranchOptions("a", branches)).toEqual([{ value: "b", label: "Gulberg" }]);
  });

  it("offers nothing when the business has no other active branch", () => {
    expect(moveBranchOptions("a", [branches[0]!, branches[2]!])).toEqual([]);
  });

  it("offers every active branch when the printer's own branch is not known", () => {
    expect(moveBranchOptions(undefined, branches).map((option) => option.value)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("printersOnSameComputer", () => {
  const agentRow = (id: string, agentId: string | null) => ({
    printer: printer({ id }),
    live: {
      id,
      agent: agentId === null ? null : { id: agentId, status: "ACTIVE", lastSeenAt: null },
    } as DashboardPrinter,
  });

  it("counts the other printers paired through the same agent", () => {
    const rows = [agentRow("p1", "ag1"), agentRow("p2", "ag1"), agentRow("p3", "ag2")];
    expect(printersOnSameComputer(rows, rows[0]!)).toBe(1);
    expect(printersOnSameComputer(rows, rows[2]!)).toBe(0);
  });

  it("is unknown (null) without live data or a paired agent, so the screen speaks generally", () => {
    const rows = [agentRow("p1", null), { printer: printer({ id: "p2" }), live: null }];
    expect(printersOnSameComputer(rows, rows[0]!)).toBeNull();
    expect(printersOnSameComputer(rows, rows[1]!)).toBeNull();
  });
});
