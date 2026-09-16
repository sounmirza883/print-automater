import { Module } from "@nestjs/common";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV, apiEnv } from "../config/config.module.js";
import { MockCheckoutController } from "./mock-checkout.controller.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";
import { OrderLockService } from "./order-lock.service.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface.js";
import { RefundService } from "./refund.service.js";

// Adding a second real provider later is: implement the class, add one
// entry to this array, done -- nothing that depends on PAYMENT_PROVIDER
// (the token, from 6.2) changes at all. Only "mock" exists so far.
const PROVIDER_CONTROLLERS = apiEnv.PAYMENT_PROVIDER === "mock" ? [MockCheckoutController] : [];

/** Split out from PaymentsModule in 11.3, when ShopOrdersService's own
 * rejectOrder() and OrdersService's own cancelOrder() both needed
 * RefundService for their automatic refund triggers. PaymentsModule
 * already imports OrdersModule (PaymentsService's checkout flow reuses
 * OrdersService.getOwnedOrder()) -- so anything PaymentsModule itself
 * depends on cannot be imported back into OrdersModule without a
 * circular module dependency. This module holds exactly the provider
 * infrastructure (the PAYMENT_PROVIDER token, OrderLockService,
 * RefundService, and the dev-only mock checkout controller) that has
 * no dependency on OrdersModule at all, so OrdersModule,
 * ShopOrdersModule, and PaymentsModule can all import it safely,
 * sitting below all three. */
@Module({
  controllers: [...PROVIDER_CONTROLLERS],
  providers: [
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
    RefundService,
  ],
  exports: [PAYMENT_PROVIDER, OrderLockService, RefundService],
})
export class PaymentProviderModule {}
