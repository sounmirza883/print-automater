import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationCenterController } from "./notification-center.controller.js";
import { NotificationCenterService } from "./notification-center.service.js";

@Module({
  imports: [AuthModule],
  controllers: [NotificationCenterController],
  providers: [NotificationCenterService],
})
export class NotificationCenterModule {}
