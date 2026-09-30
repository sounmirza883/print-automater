import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HealthModule } from "../health/health.module.js";
import { ShopPlanModule } from "../shop-plan/shop-plan.module.js";
import { ShopStaffModule } from "../shop-staff/shop-staff.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminService } from "./admin.service.js";

@Module({
  // ShopStaffModule (fix wave 1): a new business's owner invitation.
  imports: [AuthModule, HealthModule, ShopPlanModule, ShopStaffModule],
  controllers: [AdminController],
  providers: [AdminService, AdminDashboardService],
})
export class AdminModule {}
