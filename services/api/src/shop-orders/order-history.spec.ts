import { HISTORY_TEXT_HIDDEN, sanitizeHistoryMetadata } from "./order-history.js";

const staff = { includeFreeText: true };
const operator = { includeFreeText: false };

describe("sanitizeHistoryMetadata (23.19 allowlist)", () => {
  it("keeps allowlisted structural fields and drops every key it does not know", () => {
    const out = sanitizeHistoryMetadata(
      {
        from: "CREATED",
        to: "QUEUED",
        orderId: "8c9a3f2e-0000-4000-8000-000000000001",
        attempt: 2,
        held: true,
        shortfallSheets: 3,
        jobIds: ["job-a", "job-b"],
        token: "secret-token-value",
        deliveryAddress: "12 Secret Lane",
        checkoutUrl: "https://pay.example/checkout",
        mobile: "0300-7654321",
        street: "9 Hidden St",
        nested: { phone: "1" },
        error: "boom",
      },
      staff,
    );
    expect(out).toEqual({
      from: "CREATED",
      to: "QUEUED",
      orderId: "8c9a3f2e-0000-4000-8000-000000000001",
      attempt: 2,
      held: true,
      shortfallSheets: 3,
      jobIds: ["job-a", "job-b"],
    });
  });

  it("drops free text or contact data hidden under a structural key", () => {
    const out = sanitizeHistoryMetadata(
      {
        printerId: "call me on 0300 1111111",
        orderId: "someone@example.com",
        blockedReason: "NO_PAPER",
        jobIds: ["ok-id", "5 Garden Rd"],
        status: { nested: "object" },
      },
      staff,
    );
    expect(out).toEqual({ blockedReason: "NO_PAPER" });
  });

  it("shows free text only to roles that may see customer contact; enum codes to everyone", () => {
    const row = {
      reason: "PAPER_JAM",
      note: "Customer asked to call 0300-1234567, 5 Garden Rd",
      comment: "manual",
    };
    expect(sanitizeHistoryMetadata(row, staff)).toEqual(row);
    expect(sanitizeHistoryMetadata(row, operator)).toEqual({
      reason: "PAPER_JAM",
      note: HISTORY_TEXT_HIDDEN,
      comment: HISTORY_TEXT_HIDDEN,
    });
  });

  it("keeps business labels for every role, stripped of control characters and capped", () => {
    const out = sanitizeHistoryMetadata(
      { printerName: "Front\r\nDesk HP", courier: "x".repeat(300) },
      operator,
    );
    expect(out).toEqual({ printerName: "Front  Desk HP", courier: "x".repeat(100) });
  });

  it("caps free text for the roles that see it", () => {
    const out = sanitizeHistoryMetadata({ note: "n".repeat(900) }, staff);
    expect(out).toEqual({ note: "n".repeat(500) });
  });

  it("returns null for metadata that is not an object", () => {
    expect(sanitizeHistoryMetadata(null, staff)).toBeNull();
    expect(sanitizeHistoryMetadata("x", staff)).toBeNull();
    expect(sanitizeHistoryMetadata(["a"], staff)).toBeNull();
  });
});
