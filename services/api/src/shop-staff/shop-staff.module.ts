import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ShopStaffController } from "./shop-staff.controller.js";
import { ShopStaffService } from "./shop-staff.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ShopStaffController],
  providers: [ShopStaffService],
})
export class ShopStaffModule {}
