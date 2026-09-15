import { Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { ShopScopeGuard } from "./shop-scope.guard.js";

@Module({
  imports: [NotificationModule],
  controllers: [AuthController],
  providers: [PasswordService, TokenService, AuthService, JwtAuthGuard, RolesGuard, ShopScopeGuard],
  exports: [PasswordService, TokenService, JwtAuthGuard, RolesGuard, ShopScopeGuard],
})
export class AuthModule {}
