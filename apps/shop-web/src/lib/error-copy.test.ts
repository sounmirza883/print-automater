import {
  errorCodeOf,
  errorMessageFor,
  interpretActionFailure,
  isStaleStateError,
} from "./error-copy";

const apiError = (status: number, error_code: string, message = "server text") => ({
  status,
  error_code,
  message,
});

describe("errorMessageFor", () => {
  it.each([
    ["RATE_LIMITED", /too quickly/],
    ["PRINTER_CAPABILITY_MISMATCH", /cannot do this job/],
    ["PRINTER_NOT_AVAILABLE", /not available/],
    ["JOB_NOT_FAILED", /failed or timed-out/],
    ["QUALITY_CHECK_REQUIRED", /quality check first/],
    ["REPRINT_ALREADY_EXISTS", /already exists/],
    ["REPRINT_ITEM_IN_PROGRESS", /still has a job in progress/],
    ["REPRINT_IN_PROGRESS", /reprint of this order is still in progress/],
    ["DELIVERY_COURIER_REQUIRED", /courier/],
    ["RESUME_TARGET_STALE", /Choose a printer/],
    ["PRINTER_HAS_ACTIVE_JOB", /disable the printer instead/],
  ])("gives %s its own precise copy", (code, pattern) => {
    expect(errorMessageFor(apiError(409, code))).toMatch(pattern);
  });

  it("falls back to the server message for an unknown code", () => {
    expect(errorMessageFor(apiError(400, "VALIDATION_FAILED", "address is too short"))).toBe(
      "address is too short",
    );
  });

  it("maps bare statuses when the code is unknown", () => {
    expect(errorMessageFor({ status: 429, error_code: "X", message: "" })).toMatch(/too quickly/);
    expect(errorMessageFor({ status: 403, error_code: "X", message: "" })).toMatch(/role/);
    expect(errorMessageFor({ status: 503, error_code: "X", message: "" })).toMatch(/unreachable/);
  });

  it("describes a failure with no response at all as connectivity", () => {
    expect(errorMessageFor(new TypeError("fetch failed"))).toMatch(/connection/);
  });
});

describe("interpretActionFailure", () => {
  it("turns LATE_PRINT_ACK_REQUIRED into a confirmation, not an error", () => {
    expect(interpretActionFailure(apiError(409, "LATE_PRINT_ACK_REQUIRED"))).toEqual({
      kind: "confirm-late-print",
    });
  });

  it("asks for a refresh when the failure means the screen is stale", () => {
    expect(interpretActionFailure(apiError(409, "ILLEGAL_JOB_TRANSITION"))).toMatchObject({
      kind: "message",
      refresh: true,
    });
    expect(interpretActionFailure(apiError(409, "PRINTER_NOT_AVAILABLE"))).toMatchObject({
      kind: "message",
      refresh: false,
    });
  });

  it("exposes the code and the stale check", () => {
    expect(errorCodeOf(apiError(409, "JOB_NOT_FAILED"))).toBe("JOB_NOT_FAILED");
    expect(isStaleStateError(apiError(409, "JOB_NOT_FAILED"))).toBe(true);
    expect(isStaleStateError(null)).toBe(false);
  });
});
