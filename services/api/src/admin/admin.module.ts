import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HealthModule } from "../health/health.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminService } from "./admin.service.js";

@Module({
  imports: [AuthModule, HealthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminDashboardService],
})
export class AdminModule {}
