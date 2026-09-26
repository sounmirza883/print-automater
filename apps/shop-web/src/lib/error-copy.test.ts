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
    ["INSUFFICIENT_STOCK", /not enough stock/],
    ["STOCK_OVERFLOW", /past the largest number/],
    ["INVENTORY_SKU_TAKEN", /already uses that SKU/],
    ["SUPPLIER_PRODUCT_EXISTS", /already supplies that item/],
    ["SUPPLIER_INACTIVE", /supplier is inactive/],
    ["INVENTORY_ITEM_INACTIVE", /stock item is inactive/],
    ["PURCHASE_ORDER_TOTAL_TOO_LARGE", /total is too large/],
    ["PURCHASE_ORDER_INVALID_STATE", /already received or cancelled/],
    ["SETTINGS_VERSION_CONFLICT", /Someone else changed these settings/],
    ["RULE_VERSION_CONFLICT", /changed this rule/],
    ["RULE_LIMIT_REACHED", /at most 50/],
    ["RULE_ORDER_MISMATCH", /reorder again/],
    ["RULE_PRINTER_INVALID", /does not belong/],
    ["CANNOT_REMOVE_LAST_OWNER", /must always have an owner/],
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

describe("403 wording", () => {
  it("keeps a service's own precise 403 message but not the generic guard one", () => {
    expect(
      errorMessageFor({
        status: 403,
        error_code: "FORBIDDEN",
        message: "Only an existing owner can grant the SHOP_OWNER role.",
      }),
    ).toBe("Only an existing owner can grant the SHOP_OWNER role.");
    expect(
      errorMessageFor({
        status: 403,
        error_code: "FORBIDDEN",
        message: "Insufficient permission for this resource.",
      }),
    ).toMatch(/role at this business/);
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
    // A version conflict means the screen must reload the latest before the next try.
    for (const code of [
      "SETTINGS_VERSION_CONFLICT",
      "RULE_VERSION_CONFLICT",
      "RULE_ORDER_MISMATCH",
    ]) {
      expect(isStaleStateError(apiError(409, code))).toBe(true);
    }
  });
});
