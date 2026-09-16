import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopStaffService, type MyShopMembership } from "./shop-staff.service.js";

@Controller("shop/staff")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_COUNTER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)
export class ShopStaffController {
  constructor(private readonly shopStaffService: ShopStaffService) {}

  @Get("me")
  myShops(@Req() req: RequestWithUser): Promise<{ shops: MyShopMembership[] }> {
    return this.shopStaffService.myShops(req.user!.id).then((shops) => ({ shops }));
  }
}
