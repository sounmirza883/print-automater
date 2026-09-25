import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeNextPath("/orders?status=open")).toBe("/orders?status=open");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "orders",
    "/ok\r\nSet-Cookie: x=1",
    "",
  ])("falls back for %p", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("falls back when absent", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });
});
