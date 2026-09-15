import { Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";

@Module({
  imports: [NotificationModule],
  controllers: [AuthController],
  providers: [PasswordService, TokenService, AuthService],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
