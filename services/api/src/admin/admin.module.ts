import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HealthModule } from "../health/health.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

@Module({
  imports: [AuthModule, HealthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
