import { PrinterStatus } from "@prisma/client";
import { BlockedReason } from "@print-automated/types";
import type { PrintConfiguration } from "@print-automated/types";
import {
  allocatePrinter,
  type AllocationRequest,
  type PrinterCandidate,
} from "./allocate-printer.js";

function config(overrides: Partial<PrintConfiguration> = {}): PrintConfiguration {
  return {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
    ...overrides,
  };
}

function request(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    printConfiguration: config(),
    pageCount: 5,
    allowUnknownCapabilities: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<PrinterCandidate> = {}): PrinterCandidate {
  return {
    id: "printer-1",
    status: PrinterStatus.ONLINE,
    hasAgent: true,
    capabilities: { color: true, duplex: true, a4: true, a3: true },
    supportedSizes: [],
    supportedPaperTypes: [],
    maxJobPages: null,
    queuedPages: 0,
    queuedJobs: 0,
    registeredAt: 0,
    ...overrides,
  };
}

describe("allocatePrinter (18.4)", () => {
  it("allocates the sole eligible candidate", () => {
    const result = allocatePrinter(request(), [candidate()]);
    expect(result).toEqual({ outcome: "ALLOCATED", printerId: "printer-1" });
  });

  describe("every BlockedReason", () => {
    it("PRINTER_OFFLINE: auto path excludes anything not ONLINE", () => {
      const result = allocatePrinter(request(), [candidate({ status: PrinterStatus.OFFLINE })]);
      expect(result).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.PRINTER_OFFLINE });
    });

    it("PRINTER_DISABLED: excluded on both auto and manual paths", () => {
      const auto = allocatePrinter(request(), [candidate({ status: PrinterStatus.DISABLED })]);
      expect(auto).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.PRINTER_DISABLED });

      const manual = allocatePrinter(
        request({ allowUnknownCapabilities: true, requestedPrinterId: "printer-1" }),
        [candidate({ status: PrinterStatus.DISABLED })],
      );
      expect(manual).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.PRINTER_DISABLED });
    });

    it("NO_COMPATIBLE_PRINTER: no agent attached (auto path only)", () => {
      const result = allocatePrinter(request(), [candidate({ hasAgent: false })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("NO_COMPATIBLE_PRINTER: capability mismatch (color requested, mono printer)", () => {
      const result = allocatePrinter(request({ printConfiguration: config({ color: "COLOR" }) }), [
        candidate({ capabilities: { color: false, duplex: true, a4: true, a3: true } }),
      ]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("NO_COMPATIBLE_PRINTER: unprobed (null) capabilities on the auto path", () => {
      const result = allocatePrinter(request(), [candidate({ capabilities: null })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("NO_COMPATIBLE_PRINTER: declared supportedSizes doesn't include the requested paper size", () => {
      const result = allocatePrinter(request(), [candidate({ supportedSizes: ["A3"] })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("NO_COMPATIBLE_PRINTER: job page count exceeds the printer's own maxJobPages", () => {
      const result = allocatePrinter(request({ pageCount: 100 }), [candidate({ maxJobPages: 50 })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("PAGE_LIMIT_REACHED: 19.x's own forward-compat flag", () => {
      const result = allocatePrinter(request(), [candidate({ pageLimitReached: true })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.PAGE_LIMIT_REACHED,
      });
    });

    it("NO_PAPER: 20.x's own forward-compat flag", () => {
      const result = allocatePrinter(request(), [candidate({ paperAvailable: false })]);
      expect(result).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.NO_PAPER });
    });

    it("OPERATOR_UNAVAILABLE: 18.9's own forward-compat flag", () => {
      const result = allocatePrinter(request(), [candidate({ operatorAvailable: false })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.OPERATOR_UNAVAILABLE,
      });
    });

    it("MANUAL_APPROVAL_REQUIRED: 22.x's own forward-compat flag", () => {
      const result = allocatePrinter(request(), [candidate({ requiresManualApproval: true })]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.MANUAL_APPROVAL_REQUIRED,
      });
    });

    it("NO_COMPATIBLE_PRINTER: no candidates at all", () => {
      const result = allocatePrinter(request(), []);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });

    it("NO_COMPATIBLE_PRINTER: requestedPrinterId names a printer not in the candidate set", () => {
      const result = allocatePrinter(request({ requestedPrinterId: "ghost" }), [candidate()]);
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });
  });

  describe("deterministic tie-break: fewest queued pages -> fewest queued jobs -> oldest registration -> id ascending", () => {
    it("fewest queued pages wins first", () => {
      const result = allocatePrinter(request(), [
        candidate({ id: "a", queuedPages: 100 }),
        candidate({ id: "b", queuedPages: 10 }),
        candidate({ id: "c", queuedPages: 50 }),
      ]);
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "b" });
    });

    it("queuedPages tied -> fewest queued jobs wins", () => {
      const result = allocatePrinter(request(), [
        candidate({ id: "a", queuedPages: 10, queuedJobs: 5 }),
        candidate({ id: "b", queuedPages: 10, queuedJobs: 1 }),
        candidate({ id: "c", queuedPages: 10, queuedJobs: 3 }),
      ]);
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "b" });
    });

    it("queuedPages and queuedJobs tied -> oldest registration wins", () => {
      const result = allocatePrinter(request(), [
        candidate({ id: "a", queuedPages: 10, queuedJobs: 1, registeredAt: 3000 }),
        candidate({ id: "b", queuedPages: 10, queuedJobs: 1, registeredAt: 1000 }),
        candidate({ id: "c", queuedPages: 10, queuedJobs: 1, registeredAt: 2000 }),
      ]);
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "b" });
    });

    it("everything tied -> id ascending wins", () => {
      const result = allocatePrinter(request(), [
        candidate({ id: "zebra", queuedPages: 10, queuedJobs: 1, registeredAt: 1000 }),
        candidate({ id: "alpha", queuedPages: 10, queuedJobs: 1, registeredAt: 1000 }),
        candidate({ id: "mango", queuedPages: 10, queuedJobs: 1, registeredAt: 1000 }),
      ]);
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "alpha" });
    });
  });

  describe("allowUnknownCapabilities: both branches proven separately", () => {
    it("false (auto): null capabilities are EXCLUDED", () => {
      const result = allocatePrinter(request({ allowUnknownCapabilities: false }), [
        candidate({ capabilities: null }),
      ]);
      expect(result.outcome).toBe("BLOCKED");
    });

    it("true (manual): null capabilities are TRUSTED", () => {
      const result = allocatePrinter(
        request({ allowUnknownCapabilities: true, requestedPrinterId: "printer-1" }),
        [candidate({ capabilities: null, hasAgent: false })],
      );
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "printer-1" });
    });

    it("true (manual): a KNOWN incompatible capability still refuses", () => {
      const result = allocatePrinter(
        request({
          allowUnknownCapabilities: true,
          requestedPrinterId: "printer-1",
          printConfiguration: config({ color: "COLOR" }),
        }),
        [candidate({ capabilities: { color: false, duplex: true, a4: true, a3: true } })],
      );
      expect(result).toEqual({
        outcome: "BLOCKED",
        blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER,
      });
    });
  });

  describe("18.25: blocked reason is order-independent (stated precedence)", () => {
    function permutations<T>(items: T[]): T[][] {
      if (items.length <= 1) return [items];
      return items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );
    }

    it("every permutation of [DISABLED, ONLINE-no-paper] reports the same reason: NO_PAPER (closer to eligible than a deliberate DISABLED)", () => {
      const set = [
        candidate({ id: "a", status: PrinterStatus.DISABLED }),
        candidate({ id: "b", paperAvailable: false }),
      ];
      const reasons = permutations(set).map((p) => allocatePrinter(request(), p));
      for (const result of reasons) {
        expect(result).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.NO_PAPER });
      }
    });

    it("a mixed set of every reason yields one reason across ALL permutations", () => {
      const set = [
        candidate({ id: "a", status: PrinterStatus.DISABLED }),
        candidate({ id: "b", status: PrinterStatus.OFFLINE }),
        candidate({ id: "c", capabilities: { color: false, duplex: false, a4: false, a3: false } }),
        candidate({ id: "d", pageLimitReached: true }),
        candidate({ id: "e", requiresManualApproval: true }),
      ];
      const seen = new Set(
        permutations(set).map((p) => {
          const result = allocatePrinter(request(), p);
          return result.outcome === "BLOCKED" ? result.blockedReason : "ALLOCATED";
        }),
      );
      expect([...seen]).toEqual([BlockedReason.MANUAL_APPROVAL_REQUIRED]);
    });
  });

  describe("18.25: excludePrinterIds", () => {
    it("skips an excluded printer even when it would otherwise win", () => {
      const result = allocatePrinter(request({ excludePrinterIds: ["a"] }), [
        candidate({ id: "a", queuedPages: 0 }),
        candidate({ id: "b", queuedPages: 50 }),
      ]);
      expect(result).toEqual({ outcome: "ALLOCATED", printerId: "b" });
    });

    it("blocks (NO_COMPATIBLE_PRINTER) when exclusion leaves nobody, and rejects an excluded requestedPrinterId", () => {
      expect(
        allocatePrinter(request({ excludePrinterIds: ["a"] }), [candidate({ id: "a" })]),
      ).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER });
      expect(
        allocatePrinter(request({ excludePrinterIds: ["a"], requestedPrinterId: "a" }), [
          candidate({ id: "a" }),
        ]),
      ).toEqual({ outcome: "BLOCKED", blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER });
    });

    it("default (absent/empty) changes nothing", () => {
      const set = [candidate({ id: "a" })];
      expect(allocatePrinter(request({ excludePrinterIds: [] }), set)).toEqual(
        allocatePrinter(request(), set),
      );
    });
  });
});

describe("allocatePrinter page allowance (19.2)", () => {
  it("excludes a printer whose remaining allowance is below the job's pages", () => {
    const result = allocatePrinter(request({ pageCount: 5 }), [
      candidate({ id: "a", pageLimitRemaining: 4 }),
      candidate({ id: "b", queuedPages: 100 }),
    ]);
    expect(result).toEqual({ outcome: "ALLOCATED", printerId: "b" });
  });

  it("allows a job that exactly consumes the remaining allowance", () => {
    const result = allocatePrinter(request({ pageCount: 5 }), [
      candidate({ id: "a", pageLimitRemaining: 5 }),
    ]);
    expect(result).toEqual({ outcome: "ALLOCATED", printerId: "a" });
  });

  it("null/undefined remaining never blocks (enforcement disabled)", () => {
    expect(allocatePrinter(request(), [candidate({ pageLimitRemaining: null })]).outcome).toBe(
      "ALLOCATED",
    );
  });

  it("reports PAGE_LIMIT_REACHED when the limit is the only exclusion", () => {
    const result = allocatePrinter(request(), [
      candidate({ id: "a", pageLimitRemaining: 0 }),
      candidate({ id: "b", pageLimitRemaining: 1 }),
    ]);
    expect(result).toEqual({
      outcome: "BLOCKED",
      blockedReason: BlockedReason.PAGE_LIMIT_REACHED,
    });
  });

  it("manual assignment ignores the limit (PRD 20)", () => {
    const result = allocatePrinter(
      request({ requestedPrinterId: "a", allowUnknownCapabilities: true }),
      [candidate({ id: "a", pageLimitRemaining: 0 })],
    );
    expect(result).toEqual({ outcome: "ALLOCATED", printerId: "a" });
  });
});
