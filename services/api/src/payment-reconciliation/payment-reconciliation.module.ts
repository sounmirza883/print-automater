import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@print-automated/backend-shared";
import { PaymentProviderModule } from "../payments/payment-provider.module.js";
import { PaymentReconciliationProcessor } from "./payment-reconciliation.processor.js";
import { PaymentReconciliationScheduler } from "./payment-reconciliation.scheduler.js";

// PaymentProviderModule for PAYMENT_PROVIDER -- see
// payment-reconciliation.processor.ts's own comment for why this sweep
// deliberately lives in services/api (sharing the exact same provider
// instance/ledger) rather than services/worker like every other sweep.
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.PAYMENT_RECONCILIATION }),
    PaymentProviderModule,
  ],
  providers: [PaymentReconciliationProcessor, PaymentReconciliationScheduler],
})
export class PaymentReconciliationModule {}
