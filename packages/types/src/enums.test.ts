import {
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  UserRole,
  ShopStatus,
  PrinterStatus,
  PaperSize,
  PaperType,
  Finishing,
  ColorMode,
  Sides,
  Orientation,
} from "./enums/index.js";

const ALL_ENUMS: Record<string, Record<string, string>> = {
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  UserRole,
  ShopStatus,
  PrinterStatus,
  PaperSize,
  PaperType,
  Finishing,
  ColorMode,
  Sides,
  Orientation,
};

describe("shared enums", () => {
  it.each(Object.entries(ALL_ENUMS))(
    "%s has no duplicate values and every key matches its value",
    (_name, enumObject) => {
      const values = Object.values(enumObject);
      expect(new Set(values).size).toBe(values.length);
      for (const [key, value] of Object.entries(enumObject)) {
        expect(value).toBe(key);
      }
    },
  );

  it("OrderStatus and PaymentStatus never share a state name for different concepts", () => {
    // Both legitimately have PAID and CANCELLED — that's fine, they're
    // read from separate columns (§26). This documents the overlap is
    // intentional rather than a copy-paste leftover.
    const shared = Object.values(OrderStatus).filter((v) =>
      (Object.values(PaymentStatus) as string[]).includes(v),
    );
    expect(shared.sort()).toEqual(["CANCELLED", "PAID"]);
  });
});
