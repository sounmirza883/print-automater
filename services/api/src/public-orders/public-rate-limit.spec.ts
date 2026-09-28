import type { Request } from "express";
import { ipAndShopBuckets, PUBLIC_RATE_LIMITS } from "./public-orders.controller.js";

const SHOP = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function req(shopId: string): Request {
  return { ip: "203.0.113.9", params: { shopId } } as unknown as Request;
}

describe("public QR rate-limit buckets (24.1)", () => {
  const buckets = ipAndShopBuckets(PUBLIC_RATE_LIMITS.createOrder);

  it("checks the per-IP bucket FIRST, so a request the IP budget refuses never creates a per-shop key", () => {
    expect(buckets.map((b) => b.keyGenerator(req(SHOP)))).toEqual([
      "ip:203.0.113.9",
      `ip-shop:203.0.113.9:${SHOP}`,
    ]);
    expect(buckets.map((b) => b.limit)).toEqual([
      PUBLIC_RATE_LIMITS.createOrder.perIp,
      PUBLIC_RATE_LIMITS.createOrder.perIpAndShop,
    ]);
  });

  it("normalises the shop id's case, so case variants of one id share one key", () => {
    expect(buckets[1]!.keyGenerator(req(SHOP.toUpperCase()))).toBe(`ip-shop:203.0.113.9:${SHOP}`);
  });

  it("collapses anything that is not UUID-shaped into ONE key, so garbage ids cannot multiply keys", () => {
    for (const garbage of ["not-a-uuid", "x".repeat(5000), `${SHOP}x`, "", "../../etc"]) {
      expect(buckets[1]!.keyGenerator(req(garbage))).toBe("ip-shop:203.0.113.9:invalid");
    }
  });
});
