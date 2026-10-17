import { UserRole } from "@prisma/client";
import { PrintJobsController } from "../print-jobs/print-jobs.controller.js";
import { ShopAgentsController } from "../shop-agents/shop-agents.controller.js";
import { ROLES_KEY } from "./roles.decorator.js";

/** A controller that gates on role AND on a permission would make a ticked permission do
 * nothing for any role its `@Roles` list leaves out. Both of these have a `@RequirePermission`
 * on every route, so the permission alone must decide: every shop staff role gets through
 * the role gate. */
const SHOP_STAFF_ROLES = [
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
];

describe("role gates that duplicate a permission check", () => {
  it.each([
    ["print jobs", PrintJobsController],
    ["shop agents", ShopAgentsController],
  ])("%s lets every shop staff role reach the permission check", (_name, controller) => {
    const roles = Reflect.getMetadata(ROLES_KEY, controller) as UserRole[];
    expect([...roles].sort()).toEqual([...SHOP_STAFF_ROLES].sort());
  });
});
