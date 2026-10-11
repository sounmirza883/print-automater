import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { ShopPlanModule } from "../shop-plan/shop-plan.module.js";
import {
  AdminPaymentProofsController,
  PaymentInstructionsController,
  PaymentProofsController,
} from "./payment-proofs.controller.js";
import { PaymentProofsService } from "./payment-proofs.service.js";

@Module({
  imports: [AuthModule, ShopPlanModule, NotificationModule],
  controllers: [
    PaymentProofsController,
    PaymentInstructionsController,
    AdminPaymentProofsController,
  ],
  providers: [PaymentProofsService],
})
export class PaymentProofsModule {}
