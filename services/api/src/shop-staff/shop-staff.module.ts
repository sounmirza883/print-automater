import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ShopStaffController } from "./shop-staff.controller.js";
import { ShopStaffService } from "./shop-staff.service.js";
import { ShopStaffShopResolver } from "./shop-staff-shop.resolver.js";

@Module({
  imports: [AuthModule],
  controllers: [ShopStaffController],
  providers: [ShopStaffService, ShopStaffShopResolver],
})
export class ShopStaffModule {}
