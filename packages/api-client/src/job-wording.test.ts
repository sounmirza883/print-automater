import { BlockedReason } from "@print-automated/types";
import {
  describeBlockedReason,
  humanizeEnum,
  instructionSummary,
  isHeldByLatePrint,
  jobStatusTone,
  priorityLabel,
} from "./job-wording.js";

describe("shared job wording (23.31)", () => {
  it("words every blocked reason, with the plan's exact copy for the two that need it", () => {
    for (const reason of Object.values(BlockedReason)) {
      const view = describeBlockedReason(reason);
      expect(view?.label).toBeTruthy();
      expect(view?.hint).toBeTruthy();
    }
    expect(describeBlockedReason("AUTOMATION_DISABLED")?.label).toBe(
      "Waiting for manual printer assignment",
    );
    expect(describeBlockedReason("NO_PAPER")).toMatchObject({ fix: "inventory", tone: "danger" });
  });

  it("names where each fix lives without naming a route", () => {
    expect(describeBlockedReason("NO_COMPATIBLE_PRINTER")?.fix).toBe("printers");
    expect(describeBlockedReason("PRINTER_OFFLINE")?.fix).toBe("printer-status");
    expect(describeBlockedReason("OPERATOR_UNAVAILABLE")?.fix).toBeUndefined();
  });

  it("has no view for an unblocked job and degrades gracefully for an unknown reason", () => {
    expect(describeBlockedReason(null)).toBeNull();
    expect(describeBlockedReason("SOMETHING_NEW")?.label).toBe("Something new");
  });

  it("marks only a late-print hold as held", () => {
    expect(isHeldByLatePrint("MANUAL_APPROVAL_REQUIRED")).toBe(true);
    expect(isHeldByLatePrint("NO_PAPER")).toBe(false);
    expect(isHeldByLatePrint(null)).toBe(false);
  });

  it("gives job statuses a tone and priorities a label", () => {
    expect(jobStatusTone("PRINTING")).toBe("accent");
    expect(jobStatusTone("UNKNOWN")).toBe("danger");
    expect(jobStatusTone("PAUSED")).toBe("caution");
    expect(jobStatusTone("QUEUED")).toBe("neutral");
    expect(priorityLabel(0)).toBe("Normal");
    expect(priorityLabel(15)).toBe("High");
    expect(priorityLabel(20)).toBe("Urgent");
    expect(humanizeEnum("PAPER_JAM")).toBe("Paper jam");
  });

  it("summarises what to load and print on one line", () => {
    const base = {
      paperSize: "A4",
      paperType: "STANDARD",
      color: "COLOR",
      sides: "DOUBLE",
      orientation: null,
      copies: 2,
      pagesPerCopy: 12,
      totalPages: 24,
      finishing: ["STAPLING"],
    };
    expect(instructionSummary(base)).toBe(
      "A4 · Standard · Color · Double · Stapling · 2 copies × 12 pp = 24 pp",
    );
    expect(instructionSummary({ ...base, copies: 1, totalPages: 12, finishing: [] })).toBe(
      "A4 · Standard · Color · Double · 12 pp",
    );
  });
});
