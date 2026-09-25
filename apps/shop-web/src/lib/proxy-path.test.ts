import { isSameOriginMutation, resolveBackendPath } from "./proxy-path";

describe("resolveBackendPath", () => {
  it("maps allowed areas onto /v1", () => {
    expect(resolveBackendPath(["shop", "dashboard", "owner"])).toEqual({
      ok: true,
      backendPath: "/v1/shop/dashboard/owner",
    });
    expect(resolveBackendPath(["notifications", "unread-count"])).toEqual({
      ok: true,
      backendPath: "/v1/notifications/unread-count",
    });
    expect(resolveBackendPath(["admin", "dashboard"])).toEqual({
      ok: true,
      backendPath: "/v1/admin/dashboard",
    });
  });

  it.each([
    [[]],
    [["auth", "login"]],
    [["payments", "webhook"]],
    [["documents", "abc"]],
    [["shop", "..", "auth", "login"]],
    [["shop", ".", "x"]],
    [["shop", "a/b"]],
    [["shop", "a\\b"]],
    [["shop", ""]],
    [["shop", "a?b"]],
    [["shop", "a#b"]],
  ])("refuses %j", (segments) => {
    expect(resolveBackendPath(segments)).toEqual({ ok: false });
  });

  it("encodes segments so an id cannot smuggle structure", () => {
    expect(resolveBackendPath(["shop", "orders", "a b%"])).toEqual({
      ok: true,
      backendPath: "/v1/shop/orders/a%20b%25",
    });
  });
});

describe("isSameOriginMutation", () => {
  it("lets reads through regardless of origin", () => {
    expect(isSameOriginMutation("GET", "https://evil.example", "shop.example")).toBe(true);
  });

  it("requires a mutation's Origin to be this host", () => {
    expect(isSameOriginMutation("POST", "https://shop.example", "shop.example")).toBe(true);
    expect(isSameOriginMutation("POST", "http://localhost:3001", "localhost:3002")).toBe(false);
    expect(isSameOriginMutation("DELETE", "null", "shop.example")).toBe(false);
  });

  it("allows a mutation with no Origin (non-browser callers have no cookies to abuse)", () => {
    expect(isSameOriginMutation("PATCH", null, "shop.example")).toBe(true);
  });
});
