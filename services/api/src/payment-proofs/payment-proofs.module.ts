import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { NotificationModule } from "../notifications/notification.module.js";
import { ShopPlanModule } from "../shop-plan/shop-plan.module.js";
import {
  AdminPaymentProofsController,
  AdminPaymentReportsController,
  PaymentInstructionsController,
  PaymentProofsController,
} from "./payment-proofs.controller.js";
import { PaymentProofsService } from "./payment-proofs.service.js";
import { PaymentReportsService } from "./payment-reports.service.js";

@Module({
  imports: [AuthModule, ShopPlanModule, NotificationModule],
  controllers: [
    PaymentProofsController,
    PaymentInstructionsController,
    AdminPaymentProofsController,
    AdminPaymentReportsController,
  ],
  providers: [PaymentProofsService, PaymentReportsService],
})
export class PaymentProofsModule {}
