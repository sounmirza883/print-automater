import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import {
  ShopStaffController,
  ShopStaffInviteActivationController,
  ShopStaffInvitesController,
  ShopStaffMeController,
} from "./shop-staff.controller.js";
import { ShopStaffInvitesService } from "./shop-staff-invites.service.js";
import { ShopStaffInviteShopResolver } from "./shop-staff-invite-shop.resolver.js";
import { ShopStaffService } from "./shop-staff.service.js";
import { ShopStaffShopResolver } from "./shop-staff-shop.resolver.js";

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [
    ShopStaffMeController,
    ShopStaffController,
    ShopStaffInvitesController,
    ShopStaffInviteActivationController,
  ],
  providers: [
    ShopStaffService,
    ShopStaffShopResolver,
    ShopStaffInvitesService,
    ShopStaffInviteShopResolver,
  ],
  // Fix wave 1: AdminService issues the owner's invitation when it creates a business.
  exports: [ShopStaffInvitesService],
})
export class ShopStaffModule {}
