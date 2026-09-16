import { Module } from "@nestjs/common";
import type { ApiEnv } from "@print-automated/config";
import { AuthModule } from "../auth/auth.module.js";
import { API_ENV, apiEnv } from "../config/config.module.js";
import { OrdersModule } from "../orders/orders.module.js";
import { MockCheckoutController } from "./mock-checkout.controller.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";
import { OrderLockService } from "./order-lock.service.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

// Adding a second real provider later is: implement the class, add one
// entry to this array, done -- nothing that depends on PAYMENT_PROVIDER
// (the token, from 6.2) changes at all. Only "mock" exists so far.
const PROVIDER_CONTROLLERS = apiEnv.PAYMENT_PROVIDER === "mock" ? [MockCheckoutController] : [];

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [PaymentsController, WebhooksController, ...PROVIDER_CONTROLLERS],
  providers: [
    PaymentsService,
    WebhooksService,
    OrderLockService,
    MockPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [API_ENV, MockPaymentProvider],
      useFactory: (env: ApiEnv, mock: MockPaymentProvider): PaymentProvider => {
        switch (env.PAYMENT_PROVIDER) {
          case "mock":
            return mock;
          default:
            // apiEnvSchema's own z.enum(["mock"]) already makes this
            // unreachable at startup -- a genuinely new provider name
            // fails Zod validation before this factory ever runs. This
            // is the exhaustiveness backstop, not the primary guard.
            throw new Error(`Unknown PAYMENT_PROVIDER: ${String(env.PAYMENT_PROVIDER)}`);
        }
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
