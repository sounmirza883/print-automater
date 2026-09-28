import { ApiClientError } from "@print-automated/api-client";
import {
  FAILURE_REASONS,
  REPRINT_REASONS,
  UNKNOWN_RESOLUTIONS,
  errorMessage,
  needsLatePrintAck,
  optionalNote,
} from "./job-actions";

describe("job action helpers (23.34)", () => {
  it("offers every failure and reprint reason the API accepts, in plain words", () => {
    expect(FAILURE_REASONS.map((r) => r.value)).toContain("PAPER_JAM");
    expect(FAILURE_REASONS.find((r) => r.value === "INK_TONER")?.label).toBe("Ink toner");
    expect(REPRINT_REASONS.map((r) => r.value)).toEqual(
      expect.arrayContaining(["POOR_QUALITY", "CUSTOMER_REQUEST", "OTHER"]),
    );
  });

  it("puts 'print it again' last among the unknown-print resolutions", () => {
    expect(UNKNOWN_RESOLUTIONS.at(-1)?.value).toBe("RETRY");
  });

  it("recognises only the late-print refusal as needing an acknowledgement", () => {
    const late = new ApiClientError(409, {
      error_code: "LATE_PRINT_ACK_REQUIRED",
      message: "Check the output.",
    });
    expect(needsLatePrintAck(late)).toBe(true);
    expect(needsLatePrintAck(new ApiClientError(409, { error_code: "JOB_NOT_PAUSED" }))).toBe(
      false,
    );
    expect(needsLatePrintAck(new Error("offline"))).toBe(false);
  });

  it("uses the API's own message, and never sends a blank note", () => {
    expect(errorMessage(new ApiClientError(409, { message: "Already paused." }))).toBe(
      "Already paused.",
    );
    expect(errorMessage("weird")).toBe("That action failed.");
    expect(optionalNote("  ")).toBeUndefined();
    expect(optionalNote(" jammed twice ")).toBe("jammed twice");
  });
});
