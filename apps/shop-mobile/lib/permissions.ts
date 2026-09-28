import type { Can, MyShopMembership } from "@print-automated/api-client";
import type { Permission } from "@print-automated/types";

/** 23.32: what the signed-in person may do at their business, straight from the membership
 * `GET /v1/shop/staff/me` returns (the server's own role table, so this app keeps no copy of
 * it). Used only to decide which actions to show: the API authorises every request. A
 * membership without a list allows nothing (fail closed), so at worst an action the server
 * would allow is hidden, never the reverse. */
export function membershipCan(membership: Pick<MyShopMembership, "permissions"> | null): Can {
  const granted = new Set<Permission>(membership?.permissions ?? []);
  return (permission) => granted.has(permission);
}

/** Staff roles in plain words, for the profile. */
export function roleLabel(role: string | null): string {
  switch (role) {
    case "SHOP_OWNER":
      return "Owner";
    case "SHOP_MANAGER":
      return "Manager";
    case "SHOP_COUNTER":
      return "Counter staff";
    case "OPERATOR":
      return "Operator";
    case "PRINTER_MANAGER":
      return "Printer manager";
    default:
      return "Staff";
  }
}
