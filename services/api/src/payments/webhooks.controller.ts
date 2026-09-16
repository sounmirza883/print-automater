import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { AppException } from "@print-automated/backend-shared";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface.js";
import { WebhooksService } from "./webhooks.service.js";

/** Which request header carries a given provider's signature -- a
 * real PSP has its own header name (e.g. Stripe's `Stripe-Signature`),
 * so this grows one entry per provider added, same shape as 6.2's own
 * by-name provider registry. Only "mock" (6.3's `x-mock-signature`)
 * exists so far. */
const SIGNATURE_HEADERS: Record<string, string> = {
  mock: "x-mock-signature",
};

/** §76. No auth guard -- a webhook comes from the payment provider,
 * not a logged-in user; `verifyWebhook()`'s HMAC check is this
 * endpoint's actual authentication. */
@Controller("webhooks/payment")
export class WebhooksController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param("provider") providerName: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    if (providerName !== this.provider.name) {
      throw new NotFoundException(`Unknown payment provider: ${providerName}`);
    }

    const headerName = SIGNATURE_HEADERS[providerName];
    const signature = headerName ? req.headers[headerName] : undefined;
    if (!req.rawBody || typeof signature !== "string") {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_WEBHOOK_SIGNATURE",
        "Missing webhook signature.",
        false,
      );
    }

    const verification = this.provider.verifyWebhook(req.rawBody, signature);
    if (!verification.valid) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_WEBHOOK_SIGNATURE",
        "Invalid webhook signature.",
        false,
      );
    }

    await this.webhooksService.process(verification.event);
    return { received: true };
  }
}
